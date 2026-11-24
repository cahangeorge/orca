import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginCodexModelCatalogProbeContext } from '../codex/codex-model-catalog-probe-context'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprint } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import {
  createInitialSelectionCatalogEvidence,
  type InitialSelectionCatalogContext
} from '../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'
import { DecisionDraftService } from './decision-draft-service'

function fixture(fullReader = true, model = 'gpt-6.1-sol') {
  let generation = 'current'
  const caller = { ownerKey: 'owner', connectionId: 'document-connection' }
  const context: InitialSelectionCatalogContext = {
    ownerKey: caller.ownerKey,
    executionHostId: 'local',
    workspaceId: 'workspace',
    workspacePath: '/synthetic/workspace',
    policyVersion: 'shadow-1',
    account: {
      agent: 'codex',
      accountHomeVariable: 'CODEX_HOME',
      accountHomePath: '/synthetic/account',
      wslDistro: null
    }
  }
  const store = new AgentModelCatalogStore()
  const success = {
    origin: 'probe' as const,
    fastModeTierByModel: new Map<string, string>(),
    models: [
      {
        id: model,
        label: 'Sol',
        isDefault: true,
        efforts: [
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' }
        ]
      },
      {
        id: 'manual-model',
        label: 'Manual',
        isDefault: false,
        efforts: [{ value: 'low', label: 'Low' }]
      }
    ]
  }
  beginCodexModelCatalogProbeContext(
    {
      command: '/synthetic/codex',
      cliPath: '/synthetic/codex',
      args: [],
      timeoutMs: 1,
      env: { CODEX_HOME: context.account.accountHomePath }
    },
    context.account.accountHomePath,
    fullReader ? () => ({ status: 'known', key: generation }) : undefined
  )(success)
  store.recordSuccess(agentModelCatalogFingerprint(context.account), 'codex', success)
  const evidence = createInitialSelectionCatalogEvidence({ store })
  const issued = evidence.issue(context)
  const input = {
    workspaceId: context.workspaceId,
    draftId: 'draft',
    revision: 1,
    catalogRef: issued.status === 'ready' ? issued.catalogRef : 'missing',
    choicesVersion: issued.status === 'ready' ? issued.choicesVersion : 'unknown',
    text: 'Implement a self contained function',
    attachmentCount: 0,
    selfContained: true,
    inputTruncated: false
  }
  const evaluate = vi.fn(async (value: { executionLaneChoices: readonly string[] }) => ({
    task_category: { choice: 'implementation' },
    execution_lane: { choice: value.executionLaneChoices[0] }
  }))
  const resolveScope = vi.fn(async () => context)
  const readCaller = vi.fn((): unknown => caller)
  const service = new DecisionDraftService({
    evidence,
    resolveScope,
    readCaller,
    provider: { id: 'synthetic', modelRevision: '1', evaluate }
  })
  return {
    service,
    input,
    caller,
    context,
    evidence,
    store,
    evaluate,
    resolveScope,
    readCaller,
    revoke: () => {
      generation = 'revoked'
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('internal checked draft service', () => {
  it('uses only entitled policy lanes without consuming its reference', async () => {
    const f = fixture()
    expect((await f.service.analyze(f.input)).state).toBe('available')
    expect(f.evaluate.mock.calls[0]![0].executionLaneChoices).toEqual([
      '["gpt-6.1-sol","high"]',
      '["gpt-6.1-sol","medium"]',
      'needs_context'
    ])
    expect(
      f.evidence.validateNewCreate({
        context: f.context,
        catalogRef: f.input.catalogRef,
        choicesVersion: f.input.choicesVersion,
        selection: { model: 'gpt-6.1-sol', effort: 'medium' }
      }).status
    ).toBe('validated')
  })
  it('allows full-catalog manual selection outside Nano policy with zero provider work', async () => {
    const f = fixture()
    expect(
      await f.service.analyze({
        ...f.input,
        explicitSelection: { model: 'manual-model', effort: 'low' }
      })
    ).toMatchObject({ state: 'selected', selection: { model: 'manual-model', effort: 'low' } })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('refuses production without a full reader', async () => {
    const f = fixture(false)
    expect(await f.service.analyze(f.input)).toMatchObject({
      state: 'unavailable',
      reason: 'invalid_input'
    })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function flush() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
  }
}

describe('draft service binding and lifecycle', () => {
  it.each(['ownerKey', 'connectionId'] as const)(
    'rejects %s replacement during scope resolution',
    async (field) => {
      const f = fixture()
      const pending = deferred<InitialSelectionCatalogContext>()
      f.resolveScope.mockImplementationOnce(() => pending.promise)
      const result = f.service.analyze(f.input)
      f.caller[field] = 'replacement'
      pending.resolve(f.context)
      expect(await result).toMatchObject({ state: 'unavailable' })
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  )
  it.each([
    'workspaceId',
    'workspacePath',
    'executionHostId',
    'policyVersion',
    'ownerKey'
  ] as const)('rejects resolved %s drift', async (field) => {
    const f = fixture()
    f.context[field] = 'changed'
    expect(await f.service.analyze(f.input)).toMatchObject({ state: 'unavailable' })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it.each(['accountHomePath', 'accountHomeVariable', 'wslDistro'] as const)(
    'rejects resolved account %s drift',
    async (field) => {
      const f = fixture()
      f.context.account[field] = 'changed'
      expect(await f.service.analyze(f.input)).toMatchObject({ state: 'unavailable' })
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  )
  it.each(['catalogRef', 'choicesVersion'] as const)('rejects unknown %s', async (field) => {
    const f = fixture()
    expect(await f.service.analyze({ ...f.input, [field]: 'foreign' })).toMatchObject({
      state: 'unavailable'
    })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('refuses revoked proof and catalog mutation before Nano', async () => {
    for (const mutate of [true, false]) {
      const f = fixture()
      if (mutate) {
        f.store.get(agentModelCatalogFingerprint(f.context.account))!.models[0]!.efforts[0]!.value =
          'low'
      } else {
        f.revoke()
      }
      expect((await f.service.analyze(f.input)).state).toBe('unavailable')
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  })
  it('rejects expiry, active failure and unentitled manual pairs', async () => {
    for (const mode of ['expiry', 'failure', 'manual']) {
      const f = fixture()
      if (mode === 'expiry') {
        f.store.get(agentModelCatalogFingerprint(f.context.account))!.fetchedAt = 0
      }
      if (mode === 'failure') {
        f.store.recordFailure(agentModelCatalogFingerprint(f.context.account), 'PRIVATE')
      }
      expect(
        (
          await f.service.analyze(
            mode === 'manual'
              ? { ...f.input, explicitSelection: { model: 'manual-model', effort: 'high' } }
              : f.input
          )
        ).state
      ).toBe('unavailable')
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  })
  it('snapshots client input before resolving scope', async () => {
    const f = fixture()
    const pending = deferred<InitialSelectionCatalogContext>()
    f.resolveScope.mockImplementationOnce(() => pending.promise)
    const result = f.service.analyze(f.input)
    f.input.text = 'changed'
    f.input.catalogRef = 'changed'
    f.input.revision = 99
    pending.resolve(f.context)
    expect(await result).toMatchObject({ state: 'available', scope: { revision: 1 } })
    expect(f.evaluate.mock.calls[0]![0]).toMatchObject({
      text: 'Implement a self contained function'
    })
  })
  it('refuses malformed and asynchronous synchronous caller observations privately', async () => {
    for (const caller of [
      null,
      { ownerKey: 'owner', connectionId: 'document-connection', forged: true },
      Promise.reject(new Error('PRIVATE-CALLER'))
    ]) {
      const f = fixture()
      f.readCaller.mockReturnValue(caller)
      expect(await f.service.analyze(f.input)).toMatchObject({ reason: 'invalid_input' })
      expect(f.resolveScope).not.toHaveBeenCalled()
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  })
  it('isolates a new document connection namespace from retained revisions', async () => {
    const f = fixture()
    await f.service.analyze({ ...f.input, revision: 9 })
    f.caller.connectionId = 'new-connection'
    expect((await f.service.analyze(f.input)).state).toBe('available')
  })
  it('refuses lower, equal changed and duplicate intent and retains cancelled revisions', async () => {
    const f = fixture()
    const pending = deferred<InitialSelectionCatalogContext>()
    f.resolveScope.mockImplementationOnce(() => pending.promise)
    const result = f.service.analyze({ ...f.input, revision: 3 })
    expect(await f.service.analyze(f.input)).toMatchObject({ reason: 'stale_revision' })
    expect(await f.service.analyze({ ...f.input, revision: 3 })).toMatchObject({
      reason: 'duplicate'
    })
    expect(
      await f.service.analyze({ ...f.input, revision: 3, text: 'Changed intent' })
    ).toMatchObject({ reason: 'invalid_input' })
    expect(
      f.service.cancel({ workspaceId: f.input.workspaceId, draftId: f.input.draftId, revision: 2 })
    ).toBe(false)
    expect(
      f.service.cancel({ workspaceId: f.input.workspaceId, draftId: f.input.draftId, revision: 3 })
    ).toBe(true)
    expect(await result).toMatchObject({ state: 'cancelled' })
    expect(await f.service.analyze(f.input)).toMatchObject({ reason: 'stale_revision' })
    pending.resolve(f.context)
    await flush()
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('higher revisions supersede pending scope without late provider work', async () => {
    const f = fixture()
    const pending = deferred<InitialSelectionCatalogContext>()
    f.resolveScope.mockImplementationOnce(() => pending.promise)
    const first = f.service.analyze(f.input)
    const second = f.service.analyze({ ...f.input, revision: 2 })
    expect(await first).toMatchObject({ state: 'cancelled' })
    expect((await second).state).toBe('available')
    pending.resolve(f.context)
    await flush()
    expect(f.evaluate).toHaveBeenCalledTimes(1)
  })
  it.each(['caller', 'scope', 'proof', 'choices'] as const)(
    'rechecks %s after Nano completes',
    async (mode) => {
      const f = fixture()
      const pending = deferred<{
        task_category: { choice: string }
        execution_lane: { choice: string }
      }>()
      f.evaluate.mockImplementationOnce(() => pending.promise)
      const result = f.service.analyze(f.input)
      await flush()
      expect(f.evaluate).toHaveBeenCalledTimes(1)
      if (mode === 'caller') {
        f.caller.connectionId = 'replacement'
      }
      if (mode === 'scope') {
        f.context.workspacePath = '/changed'
      }
      if (mode === 'proof') {
        f.revoke()
      }
      if (mode === 'choices') {
        f.store.get(agentModelCatalogFingerprint(f.context.account))!.models[0]!.id = 'changed'
      }
      pending.resolve({
        task_category: { choice: 'implementation' },
        execution_lane: { choice: '["gpt-6.1-sol","medium"]' }
      })
      expect((await result).state).toBe('unavailable')
    }
  )
  it.each(['signal', 'cancel', 'dispose'] as const)(
    'stops pending Nano on %s with late result suppressed',
    async (mode) => {
      const f = fixture()
      const pending = deferred<{
        task_category: { choice: string }
        execution_lane: { choice: string }
      }>()
      const controller = new AbortController()
      f.evaluate.mockImplementationOnce(() => pending.promise)
      const result = f.service.analyze(f.input, controller.signal)
      await flush()
      if (mode === 'signal') {
        controller.abort()
      }
      if (mode === 'cancel') {
        expect(
          f.service.cancel({
            workspaceId: f.input.workspaceId,
            draftId: f.input.draftId,
            revision: 1
          })
        ).toBe(true)
      }
      if (mode === 'dispose') {
        f.service.dispose()
      }
      expect(await result).toMatchObject({ state: 'cancelled' })
      pending.resolve({
        task_category: { choice: 'implementation' },
        execution_lane: { choice: '["gpt-6.1-sol","medium"]' }
      })
      await flush()
      expect(f.resolveScope).toHaveBeenCalledTimes(1)
      if (mode === 'dispose') {
        expect(await f.service.analyze({ ...f.input, revision: 2 })).toMatchObject({
          reason: 'disposed'
        })
      }
    }
  )
  it.each(['signal', 'dispose'] as const)(
    'stops uncooperative pending scope on %s',
    async (mode) => {
      const f = fixture()
      const pending = deferred<InitialSelectionCatalogContext>()
      f.resolveScope.mockImplementationOnce(() => pending.promise)
      const controller = new AbortController()
      const result = f.service.analyze(f.input, controller.signal)
      if (mode === 'signal') {
        controller.abort()
      } else {
        f.service.dispose()
      }
      expect(await result).toMatchObject({ state: 'cancelled' })
      pending.resolve(f.context)
      await flush()
      expect(f.evaluate).not.toHaveBeenCalled()
    }
  )
  it('never leaks resolver, caller, or provider errors', async () => {
    for (const mode of ['scope', 'caller', 'provider']) {
      const f = fixture()
      if (mode === 'scope') {
        f.resolveScope.mockRejectedValue(new Error('PRIVATE-ACCOUNT'))
      }
      if (mode === 'caller') {
        f.readCaller.mockImplementation(() => {
          throw new Error('PRIVATE-ACCOUNT')
        })
      }
      if (mode === 'provider') {
        f.evaluate.mockRejectedValue(new Error('PRIVATE-ACCOUNT'))
      }
      const result = await f.service.analyze(f.input)
      expect(JSON.stringify(result)).not.toContain('PRIVATE')
      expect(result.state).toBe('unavailable')
    }
  })
})

describe('draft service bounded physical work', () => {
  it.each(['scope', 'provider'] as const)(
    'retains four physical %s slots after timeout until settlement',
    async (mode) => {
      vi.useFakeTimers()
      const f = fixture()
      const scopeWork = deferred<InitialSelectionCatalogContext>()
      const providerWork = deferred<{
        task_category: { choice: string }
        execution_lane: { choice: string }
      }>()
      if (mode === 'scope') {
        f.resolveScope.mockImplementation(() => scopeWork.promise)
      } else {
        f.evaluate.mockImplementation(() => providerWork.promise)
      }
      const work = Array.from({ length: 4 }, (_, index) =>
        f.service.analyze({ ...f.input, draftId: `draft-${index}` })
      )
      await flush()
      expect(await f.service.analyze({ ...f.input, draftId: 'fifth' })).toMatchObject({
        reason: 'queue_full'
      })
      await vi.advanceTimersByTimeAsync(5000)
      for (const result of await Promise.all(work)) {
        expect(result).toMatchObject({ reason: 'deadline' })
      }
      expect(await f.service.analyze({ ...f.input, draftId: 'fifth', revision: 2 })).toMatchObject({
        reason: 'queue_full'
      })
      if (mode === 'scope') {
        expect(f.resolveScope).toHaveBeenCalledTimes(4)
        scopeWork.resolve(f.context)
      } else {
        expect(f.evaluate).toHaveBeenCalledTimes(4)
        providerWork.resolve({
          task_category: { choice: 'implementation' },
          execution_lane: { choice: '["gpt-6.1-sol","medium"]' }
        })
      }
      await flush()
      f.resolveScope.mockImplementation(async () => f.context)
      f.evaluate.mockImplementation(async (value) => ({
        task_category: { choice: 'implementation' },
        execution_lane: { choice: value.executionLaneChoices[0] }
      }))
      expect((await f.service.analyze({ ...f.input, draftId: 'fifth', revision: 3 })).state).toBe(
        'available'
      )
      expect(f.evaluate).toHaveBeenCalledTimes(mode === 'scope' ? 1 : 5)
    }
  )
  it('holds cancelled resolver slots and mixed scope/provider work without an abandoned queue', async () => {
    const f = fixture()
    const pendingScope = deferred<InitialSelectionCatalogContext>()
    const pendingProvider = deferred<{
      task_category: { choice: string }
      execution_lane: { choice: string }
    }>()
    f.resolveScope
      .mockImplementationOnce(() => pendingScope.promise)
      .mockImplementationOnce(() => pendingScope.promise)
    f.evaluate.mockImplementation(() => pendingProvider.promise)
    const work = Array.from({ length: 4 }, (_, index) =>
      f.service.analyze({ ...f.input, draftId: `draft-${index}` })
    )
    await flush()
    for (let index = 0; index < 4; index++) {
      expect(
        f.service.cancel({
          workspaceId: f.input.workspaceId,
          draftId: `draft-${index}`,
          revision: 1
        })
      ).toBe(true)
    }
    expect((await Promise.all(work)).every((result) => result.state === 'cancelled')).toBe(true)
    expect(await f.service.analyze({ ...f.input, draftId: 'fifth' })).toMatchObject({
      reason: 'queue_full'
    })
    expect(f.resolveScope).toHaveBeenCalledTimes(4)
    expect(f.evaluate).toHaveBeenCalledTimes(2)
    pendingScope.resolve(f.context)
    pendingProvider.resolve({
      task_category: { choice: 'implementation' },
      execution_lane: { choice: '["gpt-6.1-sol","medium"]' }
    })
    await flush()
    expect(f.evaluate).toHaveBeenCalledTimes(2)
  })
  it('refuses metadata overflow without forgetting old revisions on cancel', async () => {
    const f = fixture()
    for (let index = 0; index < 256; index++) {
      expect(
        (await f.service.analyze({ ...f.input, draftId: `draft-${index}`, selfContained: false }))
          .state
      ).toBe('skipped')
      await flush()
    }
    expect(await f.service.analyze({ ...f.input, draftId: 'overflow' })).toMatchObject({
      reason: 'queue_full'
    })
    expect(
      f.service.cancel({ workspaceId: f.input.workspaceId, draftId: 'draft-0', revision: 1 })
    ).toBe(false)
    expect(await f.service.analyze({ ...f.input, draftId: 'draft-0', revision: 0 })).toMatchObject({
      reason: 'stale_revision'
    })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('empty policy intersection performs zero Nano work', async () => {
    const f = fixture(true, 'outside-policy')
    expect(await f.service.analyze(f.input)).toMatchObject({
      state: 'skipped',
      reason: 'no_available_lane'
    })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('includes synchronous caller work in the total monotonic deadline', async () => {
    const f = fixture()
    let at = 0
    vi.spyOn(performance, 'now').mockImplementation(() => at)
    f.readCaller.mockImplementation(() => {
      if (f.readCaller.mock.calls.length >= 3) {
        at = 5000
      }
      return f.caller
    })
    expect(await f.service.analyze(f.input)).toMatchObject({ reason: 'deadline' })
    expect(f.evaluate).not.toHaveBeenCalled()
  })
  it('ignores unused provider metadata getters and handles throwing evaluate getters privately', async () => {
    const f = fixture()
    const provider = { id: 'unused', modelRevision: 'unused', evaluate: f.evaluate }
    Object.defineProperty(provider, 'id', {
      get: () => {
        throw new Error('PRIVATE-METADATA')
      }
    })
    const service = new DecisionDraftService({
      evidence: f.evidence,
      readCaller: f.readCaller,
      resolveScope: f.resolveScope,
      provider
    })
    expect((await service.analyze(f.input)).state).toBe('available')
    Object.defineProperty(provider, 'evaluate', {
      get: () => {
        throw new Error('PRIVATE-EVALUATE')
      }
    })
    expect(await service.analyze({ ...f.input, revision: 2 })).toMatchObject({
      reason: 'provider_unavailable'
    })
  })
  it('callback reentrancy cannot publish a superseded revision', async () => {
    const f = fixture()
    let replacement: Promise<unknown> | undefined
    let entered = false
    f.readCaller.mockImplementation(() => {
      if (!entered && f.evaluate.mock.calls.length === 1) {
        entered = true
        replacement = f.service.analyze({ ...f.input, revision: 2 })
      }
      return f.caller
    })
    expect(await f.service.analyze(f.input)).toMatchObject({ state: 'cancelled' })
    expect(await replacement).toMatchObject({ state: 'available', scope: { revision: 2 } })
  })
  it.each([6, 9])('rejects proof revoked by caller observation %s', async (observation) => {
    const f = fixture()
    f.readCaller.mockImplementation(() => {
      if (f.readCaller.mock.calls.length === observation) {
        f.revoke()
      }
      return f.caller
    })
    expect((await f.service.analyze(f.input)).state).toBe('unavailable')
    expect(f.evaluate).toHaveBeenCalledTimes(observation === 6 ? 0 : 1)
  })
  it('rejects document replacement by the provider method getter before invocation', async () => {
    const f = fixture()
    const provider = { id: 'unused', modelRevision: 'unused', evaluate: f.evaluate }
    Object.defineProperty(provider, 'evaluate', {
      get: () => {
        f.caller.connectionId = 'replaced-document'
        return f.evaluate
      }
    })
    const service = new DecisionDraftService({
      evidence: f.evidence,
      readCaller: f.readCaller,
      resolveScope: f.resolveScope,
      provider
    })
    expect((await service.analyze(f.input)).state).toBe('unavailable')
    expect(f.evaluate).not.toHaveBeenCalled()
  })
})
