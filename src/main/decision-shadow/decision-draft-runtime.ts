import type {
  DecisionPreflightDraft,
  DecisionPreflightScope,
  DecisionPreflightSkipReason
} from '../../shared/decision-preflight-types'
import { evaluateDecisionPreflightRules } from '../../shared/decision-preflight-rules'
import {
  parseDecisionPreflightDraft,
  validateDecisionPreflightSuggestion
} from '../../shared/decision-preflight-validation'
import {
  DECISION_SHADOW_CATEGORIES,
  decisionShadowLaneChoice,
  type DecisionShadowAnswers,
  type DecisionShadowLane
} from '../../shared/decision-shadow-types'
import {
  DecisionDraftAnalyzeParams,
  DecisionDraftCancelParams
} from '../../shared/rpc-contract/decision-draft-params'
import { sanitizeDecisionShadowText } from './decision-shadow-input'
import type { DecisionShadowProvider } from './decision-shadow-provider'

export type DecisionDraftHostContext = Pick<
  DecisionPreflightDraft,
  'target' | 'agent' | 'conversation' | 'availableLanes'
> & {
  ownerKey: string
  workspaceId: string
  catalogRef: string
  choicesVersion: string
}
type FailureReason =
  | 'invalid_input'
  | 'stale_revision'
  | 'duplicate'
  | 'queue_full'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'deadline'
  | 'disposed'
  | 'cancelled'
export type DecisionDraftResult = { scope?: DecisionPreflightScope; calibrated: false } & (
  | { state: 'skipped'; reason: DecisionPreflightSkipReason }
  | { state: 'selected'; selection: DecisionShadowLane }
  | { state: 'available' | 'needs_context'; answers: DecisionShadowAnswers }
  | { state: 'unavailable' | 'cancelled'; reason: FailureReason }
)
type DraftEntry = { revision: number; signature: string; cancel?: () => void }
function failure(reason: FailureReason, scope?: DecisionPreflightScope): DecisionDraftResult {
  return {
    state: reason === 'cancelled' ? 'cancelled' : 'unavailable',
    reason,
    scope,
    calibrated: false
  }
}
function keyFor(host: DecisionDraftHostContext, draftId: string): string {
  return JSON.stringify([host.ownerKey, host.workspaceId, draftId])
}

export class DecisionDraftRuntime {
  private readonly drafts = new Map<string, DraftEntry>()
  private running = 0
  private disposed = false
  constructor(private readonly provider: DecisionShadowProvider) {}

  analyze(
    host: DecisionDraftHostContext,
    value: unknown,
    signal?: AbortSignal
  ): Promise<DecisionDraftResult> {
    const parsed = DecisionDraftAnalyzeParams.safeParse(value)
    if (
      !parsed.success ||
      !host.ownerKey ||
      host.ownerKey.length > 256 ||
      !/^\S+$/u.test(host.ownerKey)
    ) {
      return Promise.resolve(failure('invalid_input'))
    }
    const input = parsed.data
    if (
      input.workspaceId !== host.workspaceId ||
      input.catalogRef !== host.catalogRef ||
      input.choicesVersion !== host.choicesVersion
    ) {
      return Promise.resolve(failure('invalid_input'))
    }
    const scope: DecisionPreflightScope = {
      workspaceId: host.workspaceId,
      draftId: input.draftId,
      revision: input.revision,
      choicesVersion: host.choicesVersion
    }
    if (this.disposed) {
      return Promise.resolve(failure('disposed', scope))
    }
    if (signal?.aborted) {
      return Promise.resolve(failure('cancelled', scope))
    }
    const draft = parseDecisionPreflightDraft({
      scope,
      target: host.target,
      agent: host.agent,
      conversation: host.conversation,
      availableLanes: host.availableLanes,
      text: input.text,
      attachmentCount: input.attachmentCount,
      selfContained: input.selfContained,
      inputTruncated: input.inputTruncated,
      explicitSelection: input.explicitSelection
    })
    if (!draft) {
      return Promise.resolve(failure('invalid_input', scope))
    }
    const key = keyFor(host, input.draftId)
    const signature = JSON.stringify([input, draft])
    const previous = this.drafts.get(key)
    if (previous && input.revision <= previous.revision) {
      return Promise.resolve(
        failure(
          input.revision < previous.revision
            ? 'stale_revision'
            : signature === previous.signature
              ? 'duplicate'
              : 'invalid_input',
          scope
        )
      )
    }
    if (!previous && this.drafts.size >= 256) {
      return Promise.resolve(failure('queue_full', scope))
    }
    const entry: DraftEntry = { revision: input.revision, signature }
    this.drafts.set(key, entry)
    previous?.cancel?.()
    // Abort listeners can synchronously submit a newer revision or dispose the runtime.
    if (this.disposed || this.drafts.get(key) !== entry) {
      return Promise.resolve(failure('cancelled', scope))
    }
    const rules = evaluateDecisionPreflightRules(draft)
    if (rules.state !== 'needs_context') {
      return Promise.resolve({ ...rules, calibrated: false })
    }
    if (this.running >= 4) {
      return Promise.resolve(failure('queue_full', scope))
    }
    return this.evaluate(draft, entry, signal)
  }

  cancel(host: DecisionDraftHostContext, value: unknown): boolean {
    const parsed = DecisionDraftCancelParams.safeParse(value)
    if (!parsed.success || parsed.data.workspaceId !== host.workspaceId) {
      return false
    }
    const entry = this.drafts.get(keyFor(host, parsed.data.draftId))
    if (!entry?.cancel || entry.revision !== parsed.data.revision) {
      return false
    }
    entry.cancel()
    return true
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.drafts.values()) {
      entry.cancel?.()
    }
    this.drafts.clear()
  }

  private evaluate(
    draft: DecisionPreflightDraft,
    entry: DraftEntry,
    signal?: AbortSignal
  ): Promise<DecisionDraftResult> {
    const controller = new AbortController()
    const executionLaneChoices = [
      ...draft.availableLanes.map(decisionShadowLaneChoice),
      'needs_context'
    ]
    this.running++
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
        finish(failure('cancelled', draft.scope))
        controller.abort()
      }
      const timer = setTimeout(() => {
        finish(failure('deadline', draft.scope))
        controller.abort()
      }, 5000)
      entry.cancel = cancel
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) {
        cancel()
        this.running--
        return
      }
      let evaluation: Promise<unknown>
      try {
        evaluation = this.provider.evaluate(
          {
            text: sanitizeDecisionShadowText(draft.text),
            taskCategoryChoices: DECISION_SHADOW_CATEGORIES,
            executionLaneChoices,
            choicesVersion: draft.scope.choicesVersion
          },
          controller.signal
        )
      } catch {
        this.running--
        finish(failure('provider_unavailable', draft.scope))
        return
      }
      void evaluation
        .then(
          (value) => {
            if (settled) {
              return
            }
            const suggestion = validateDecisionPreflightSuggestion(
              { scope: draft.scope, answers: value },
              draft
            )
            finish(
              suggestion
                ? {
                    state:
                      suggestion.answers.execution_lane.choice === 'needs_context' ||
                      suggestion.answers.task_category.choice === 'needs_context'
                        ? 'needs_context'
                        : 'available',
                    scope: draft.scope,
                    answers: suggestion.answers,
                    calibrated: false
                  }
                : failure('invalid_response', draft.scope)
            )
          },
          () => finish(failure('provider_unavailable', draft.scope))
        )
        .finally(() => {
          this.running--
        })
    })
  }
}
