import { z } from 'zod'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  DecisionDraftAnalyzeParams,
  DecisionDraftCancelParams,
  type DecisionDraftAnalyzeInput
} from '../../shared/rpc-contract/decision-draft-params'
import type {
  createInitialSelectionCatalogEvidence,
  InitialSelectionCatalogContext
} from '../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'
import { DecisionDraftRuntime, type DecisionDraftResult } from './decision-draft-runtime'
import type { DecisionShadowProvider } from './decision-shadow-provider'

const identifier = z.string().min(1).max(256).regex(/^\S+$/u)
const path = z.string().refine((value) => value.trim().length > 0)
const callerSchema = z.object({ ownerKey: identifier, connectionId: identifier }).strict()
const contextSchema = z
  .object({
    ownerKey: identifier,
    executionHostId: z.literal(LOCAL_EXECUTION_HOST_ID),
    workspaceId: identifier,
    workspacePath: path,
    policyVersion: identifier,
    account: z
      .object({
        agent: z.literal('codex'),
        accountHomeVariable: z.literal('CODEX_HOME'),
        accountHomePath: path,
        wslDistro: z.null()
      })
      .strict()
  })
  .strict()
export type DecisionDraftCaller = Readonly<z.infer<typeof callerSchema>>
type Entry = { revision: number; signature: string; cancel?: () => void }
type Reason = Extract<DecisionDraftResult, { state: 'unavailable' | 'cancelled' }>['reason']
function failure(reason: Reason): DecisionDraftResult {
  return { state: reason === 'cancelled' ? 'cancelled' : 'unavailable', reason, calibrated: false }
}
function keyFor(caller: DecisionDraftCaller, workspaceId: string, draftId: string): string {
  return JSON.stringify([caller.ownerKey, caller.connectionId, workspaceId, draftId])
}
function policyLane(model: string, effort: string): boolean {
  return (
    (model === 'gpt-6-luna' && effort === 'high') ||
    (model === 'gpt-6.1-sol' && ['medium', 'high'].includes(effort)) ||
    (model === 'gpt-6-astra' && effort === 'low')
  )
}

/** Internal only: dependencies can observe scope and evaluate, never create or send. */
export class DecisionDraftService {
  private readonly drafts = new Map<string, Entry>()
  private running = 0
  private disposed = false
  constructor(
    private readonly deps: {
      evidence: Pick<ReturnType<typeof createInitialSelectionCatalogEvidence>, 'readForDraft'>
      readCaller: () => unknown
      resolveScope: (
        caller: DecisionDraftCaller,
        workspaceId: string,
        signal: AbortSignal
      ) => Promise<unknown>
      provider: DecisionShadowProvider
    }
  ) {}

  analyze(value: unknown, signal?: AbortSignal): Promise<DecisionDraftResult> {
    try {
      const deadline = performance.now() + 5000
      const parsed = DecisionDraftAnalyzeParams.safeParse(value)
      const caller = this.caller()
      if (!parsed.success || !caller) {
        return Promise.resolve(failure('invalid_input'))
      }
      const input = parsed.data
      Object.freeze(input.explicitSelection)
      Object.freeze(input)
      if (this.disposed) {
        return Promise.resolve(failure('disposed'))
      }
      if (performance.now() >= deadline) {
        return Promise.resolve(failure('deadline'))
      }
      if (signal?.aborted) {
        return Promise.resolve(failure('cancelled'))
      }
      const key = keyFor(caller, input.workspaceId, input.draftId)
      const signature = JSON.stringify(input)
      const previous = this.drafts.get(key)
      if (previous && input.revision <= previous.revision) {
        const reason =
          input.revision < previous.revision
            ? 'stale_revision'
            : signature === previous.signature
              ? 'duplicate'
              : 'invalid_input'
        return Promise.resolve(failure(reason))
      }
      if (!previous && this.drafts.size >= 256) {
        return Promise.resolve(failure('queue_full'))
      }
      const entry: Entry = { revision: input.revision, signature }
      this.drafts.set(key, entry)
      previous?.cancel?.()
      if (this.disposed || this.drafts.get(key) !== entry) {
        return Promise.resolve(failure('cancelled'))
      }
      if (this.running >= 4) {
        return Promise.resolve(failure('queue_full'))
      }
      return this.start(caller, input, key, entry, deadline, signal)
    } catch {
      return Promise.resolve(failure('invalid_input'))
    }
  }

  cancel(value: unknown): boolean {
    try {
      const parsed = DecisionDraftCancelParams.safeParse(value)
      const caller = this.caller()
      if (!parsed.success || !caller) {
        return false
      }
      const input = parsed.data
      const entry = this.drafts.get(keyFor(caller, input.workspaceId, input.draftId))
      if (this.disposed || !entry?.cancel || entry.revision !== input.revision) {
        return false
      }
      entry.cancel()
      return true
    } catch {
      return false
    }
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.drafts.values()) {
      entry.cancel?.()
    }
    this.drafts.clear()
  }

  private caller(): DecisionDraftCaller | undefined {
    const value = this.deps.readCaller()
    if (typeof value === 'object' && value !== null && 'then' in value) {
      void Promise.resolve(value).catch(() => {})
      return
    }
    const parsed = callerSchema.safeParse(value)
    return parsed.success ? Object.freeze(parsed.data) : undefined
  }

  private start(
    caller: DecisionDraftCaller,
    input: DecisionDraftAnalyzeInput,
    key: string,
    entry: Entry,
    deadline: number,
    signal?: AbortSignal
  ): Promise<DecisionDraftResult> {
    this.running++
    const controller = new AbortController()
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: DecisionDraftResult) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        entry.cancel = undefined
        resolve(result)
      }
      const cancel = () => {
        finish(failure('cancelled'))
        controller.abort()
      }
      const expire = () => {
        finish(failure('deadline'))
        controller.abort()
      }
      const timer = setTimeout(expire, Math.max(0, deadline - performance.now()))
      entry.cancel = cancel
      signal?.addEventListener('abort', cancel, { once: true })
      const active = () => {
        if (!settled && performance.now() >= deadline) {
          expire()
        }
        return !settled && this.drafts.get(key) === entry
      }
      const current = () => {
        const observed = active() ? this.caller() : undefined
        return active() && JSON.stringify(observed) === JSON.stringify(caller)
      }
      if (signal?.aborted) {
        cancel()
      }
      let providerSettled: Promise<unknown> = Promise.resolve()
      let boundContext: InitialSelectionCatalogContext | undefined
      const runtime = new DecisionDraftRuntime({
        id: 'internal-draft',
        modelRevision: 'internal-draft',
        evaluate: (request, providerSignal) => {
          const provider = this.deps.provider
          const evaluate = provider.evaluate
          if (
            !boundContext ||
            !current() ||
            choices(boundContext).status !== 'ready' ||
            !active()
          ) {
            throw new Error('unavailable')
          }
          const evaluation = Promise.resolve(evaluate.call(provider, request, providerSignal))
          providerSettled = evaluation.catch(() => undefined)
          return evaluation
        }
      })
      const readScope = async (): Promise<InitialSelectionCatalogContext | undefined> => {
        if (!current()) {
          return
        }
        const value = await this.deps.resolveScope(caller, input.workspaceId, controller.signal)
        if (!current()) {
          return
        }
        const parsed = contextSchema.safeParse(value)
        if (
          !parsed.success ||
          parsed.data.ownerKey !== caller.ownerKey ||
          parsed.data.workspaceId !== input.workspaceId
        ) {
          return
        }
        Object.freeze(parsed.data.account)
        return Object.freeze(parsed.data)
      }
      const choices = (context: InitialSelectionCatalogContext) =>
        this.deps.evidence.readForDraft({
          context,
          catalogRef: input.catalogRef,
          choicesVersion: input.choicesVersion
        })
      const reject = () => finish(failure('invalid_input'))
      const run = async () => {
        const context = (boundContext = await readScope())
        const catalog = context && current() ? choices(context) : undefined
        if (!context || catalog?.status !== 'ready' || !current()) {
          return reject()
        }
        const manual = input.explicitSelection
        if (
          manual &&
          !catalog.choices.some(
            (choice) => choice.model === manual.model && choice.efforts.includes(manual.effort)
          )
        ) {
          return reject()
        }
        const lanes = manual
          ? [{ ...manual }]
          : catalog.choices.flatMap((choice) =>
              choice.efforts
                .filter((effort) => policyLane(choice.model, effort))
                .map((effort) => ({ model: choice.model, effort }))
            )
        const result = await runtime.analyze(
          {
            ...input,
            ownerKey: caller.ownerKey,
            target: 'local',
            agent: 'codex',
            conversation: 'new',
            availableLanes: lanes
          },
          input,
          controller.signal
        )
        const observed = await readScope()
        if (
          !observed ||
          JSON.stringify(observed) !== JSON.stringify(context) ||
          !current() ||
          choices(observed).status !== 'ready' ||
          !active()
        ) {
          return reject()
        }
        finish(result)
      }
      void run()
        .catch(() => finish(failure('provider_unavailable')))
        .finally(async () => {
          runtime.dispose()
          // Cancelled clients release only after uncooperative physical work settles.
          await providerSettled
          this.running--
        })
    })
  }
}
