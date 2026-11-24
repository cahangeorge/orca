import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionDraftRuntime, type DecisionDraftHostContext } from './decision-draft-runtime'
import type { DecisionShadowProvider } from './decision-shadow-provider'
import { decisionShadowLaneChoice } from '../../shared/decision-shadow-types'
const lane = { model: 'gpt-6.1-sol', effort: 'medium' }
const host: DecisionDraftHostContext = {
  ownerKey: 'owner',
  workspaceId: 'w',
  catalogRef: 'catalog',
  choicesVersion: 'v1',
  availableLanes: [lane],
  target: 'local',
  agent: 'codex',
  conversation: 'new'
}
const input = {
  workspaceId: 'w',
  draftId: 'd',
  revision: 1,
  catalogRef: 'catalog',
  choicesVersion: 'v1',
  text: 'Implement one focused test',
  attachmentCount: 0,
  selfContained: true,
  inputTruncated: false
}
const answer = {
  task_category: { choice: 'implementation', confidence: 0.5 },
  execution_lane: { choice: decisionShadowLaneChoice(lane), confidence: 0.4 }
}
function rig(evaluate = vi.fn<DecisionShadowProvider['evaluate']>(async () => answer)) {
  return {
    evaluate,
    runtime: new DecisionDraftRuntime({ id: 'fixture', modelRevision: 'test', evaluate })
  }
}
function deferred() {
  let resolve: (value: unknown) => void = () => {}
  const promise = new Promise<unknown>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.useRealTimers())
describe('independent draft evaluator', () => {
  it('runs decisive rules and manual selection without provider calls', async () => {
    const { runtime, evaluate } = rig()
    expect((await runtime.analyze(host, { ...input, text: '/command' })).state).toBe('skipped')
    expect(
      (await runtime.analyze(host, { ...input, revision: 2, explicitSelection: lane })).state
    ).toBe('selected')
    expect(evaluate).not.toHaveBeenCalled()
  })
  it('uses sanitized draft and host choices and returns uncalibrated scope', async () => {
    const { runtime, evaluate } = rig()
    const result = await runtime.analyze(host, {
      ...input,
      text: 'Test /private/file and secret=hidden'
    })
    expect(result).toMatchObject({
      state: 'available',
      calibrated: false,
      scope: { workspaceId: 'w', draftId: 'd', revision: 1, choicesVersion: 'v1' }
    })
    expect(JSON.stringify(result)).not.toContain('owner')
    expect(evaluate.mock.calls[0][0]).toMatchObject({
      text: 'Test [path] and [credential]',
      executionLaneChoices: [decisionShadowLaneChoice(lane), 'needs_context']
    })
    expect(evaluate.mock.calls[0][0]).not.toHaveProperty('context')
  })
  it('rejects binding drift and malformed payload before provider work', async () => {
    const { runtime, evaluate } = rig()
    for (const change of [
      { workspaceId: 'other' },
      { catalogRef: 'stale' },
      { choicesVersion: 'stale' },
      { ownerKey: 'forged' },
      { text: 'x'.repeat(4097) }
    ]) {
      expect((await runtime.analyze(host, { ...input, ...change })).state).toBe('unavailable')
    }
    expect(evaluate).not.toHaveBeenCalled()
  })
  it('rejects equal revision mutation and rollback without leaking text', async () => {
    const { runtime, evaluate } = rig()
    await runtime.analyze(host, input)
    for (const change of [
      { text: 'secret=do-not-echo' },
      { revision: 0 },
      { catalogRef: 'other' },
      { choicesVersion: 'other' }
    ]) {
      const result = await runtime.analyze(
        {
          ...host,
          ...('catalogRef' in change ? { catalogRef: 'other' } : {}),
          ...('choicesVersion' in change ? { choicesVersion: 'other' } : {})
        },
        { ...input, ...change }
      )
      expect(result.state).toBe('unavailable')
      expect(JSON.stringify(result)).not.toContain('do-not-echo')
    }
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
  it('supersedes old work and refuses duplicate revisions, never applying late success', async () => {
    const old = deferred()
    const evaluate = vi
      .fn<DecisionShadowProvider['evaluate']>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(answer)
    const { runtime } = rig(evaluate)
    const first = runtime.analyze(host, input)
    expect((await runtime.analyze(host, input)).state).toBe('unavailable')
    const second = runtime.analyze(host, { ...input, revision: 2, text: 'A new task' })
    expect((await first).state).toBe('cancelled')
    expect(evaluate.mock.calls[0][1].aborted).toBe(true)
    expect((await second).state).toBe('available')
    old.resolve(answer)
    await Promise.resolve()
    expect((await runtime.analyze(host, input)).state).toBe('unavailable')
  })
  it('isolates owners and workspaces and permits only exact cancellation', async () => {
    const pending = deferred()
    const { runtime } = rig(vi.fn(async () => pending.promise))
    const first = runtime.analyze(host, input)
    expect(
      runtime.cancel(
        { ...host, ownerKey: 'other' },
        { workspaceId: 'w', draftId: 'd', revision: 1 }
      )
    ).toBe(false)
    expect(
      runtime.cancel(
        { ...host, workspaceId: 'other' },
        { workspaceId: 'other', draftId: 'd', revision: 1 }
      )
    ).toBe(false)
    expect(runtime.cancel(host, { workspaceId: 'w', draftId: 'd', revision: 0 })).toBe(false)
    expect(runtime.cancel(host, { workspaceId: 'w', draftId: 'd', revision: 1 })).toBe(true)
    expect((await first).state).toBe('cancelled')
    pending.resolve(answer)
  })
  it('preserves the newer revision submitted synchronously by an abort listener', async () => {
    const jobs = [deferred(), deferred()]
    let third: ReturnType<DecisionDraftRuntime['analyze']> | undefined
    let cancelOld: boolean | undefined
    const evaluate = vi.fn<DecisionShadowProvider['evaluate']>((_, signal) => {
      if (evaluate.mock.calls.length === 1) {
        signal.addEventListener(
          'abort',
          () => {
            cancelOld = runtime.cancel(host, { workspaceId: 'w', draftId: 'd', revision: 1 })
            third = runtime.analyze(host, { ...input, revision: 3, text: 'Third intent' })
          },
          { once: true }
        )
        return jobs[0].promise
      }
      return jobs[1].promise
    })
    const { runtime } = rig(evaluate)
    const first = runtime.analyze(host, input)
    const second = runtime.analyze(host, { ...input, revision: 2, text: 'Second intent' })
    expect(await first).toMatchObject({ state: 'cancelled' })
    expect(cancelOld).toBe(false)
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[1][0].text).toBe('Third intent')
    expect(await second).toMatchObject({ state: 'cancelled', scope: { revision: 2 } })
    expect(runtime.cancel(host, { workspaceId: 'w', draftId: 'd', revision: 2 })).toBe(false)
    expect(runtime.cancel(host, { workspaceId: 'w', draftId: 'd', revision: 3 })).toBe(true)
    expect(await third).toMatchObject({ state: 'cancelled', scope: { revision: 3 } })
    jobs.forEach((job) => job.resolve(answer))
    expect(await runtime.analyze(host, { ...input, revision: 2 })).toMatchObject({
      state: 'unavailable',
      reason: 'stale_revision'
    })
  })
  it('settles the deadline before notifying reentrant provider abort listeners', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    let cancelDuringAbort: boolean | undefined
    const { runtime } = rig(
      vi.fn<DecisionShadowProvider['evaluate']>((_, signal) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelDuringAbort = runtime.cancel(host, {
              workspaceId: 'w',
              draftId: 'd',
              revision: 1
            })
          },
          { once: true }
        )
        return pending.promise
      })
    )
    const request = runtime.analyze(host, input)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await request).toMatchObject({ state: 'unavailable', reason: 'deadline' })
    expect(cancelDuringAbort).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    pending.resolve(answer)
  })
  it('caller abort settles work, removes listeners and pre-abort calls nothing', async () => {
    const pending = deferred()
    const { runtime, evaluate } = rig(vi.fn(async () => pending.promise))
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const first = runtime.analyze(host, input, controller.signal)
    controller.abort()
    expect((await first).state).toBe('cancelled')
    expect(remove).toHaveBeenCalled()
    expect((await runtime.analyze(host, { ...input, revision: 2 }, controller.signal)).state).toBe(
      'cancelled'
    )
    expect(evaluate).toHaveBeenCalledTimes(1)
    pending.resolve(answer)
  })
  it('settles deadline with ignored abort while retaining four physical slots until completion', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    const { runtime, evaluate } = rig(vi.fn(async () => pending.promise))
    const requests = Array.from({ length: 4 }, (_, i) =>
      runtime.analyze(host, { ...input, draftId: `d${i}` })
    )
    expect(await runtime.analyze(host, { ...input, draftId: 'overflow' })).toMatchObject({
      state: 'unavailable',
      reason: 'queue_full'
    })
    await vi.advanceTimersByTimeAsync(5000)
    for (const result of await Promise.all(requests)) {
      expect(result).toMatchObject({ state: 'unavailable', reason: 'deadline' })
    }
    expect(evaluate.mock.calls.every((call) => call[1].aborted)).toBe(true)
    expect(await runtime.analyze(host, { ...input, draftId: 'still-full' })).toMatchObject({
      state: 'unavailable',
      reason: 'queue_full'
    })
    pending.resolve(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect((await runtime.analyze(host, { ...input, draftId: 'recovered' })).state).toBe(
      'available'
    )
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains only bounded tombstones and refuses overflow without eviction', async () => {
    const { runtime, evaluate } = rig()
    for (let i = 0; i < 256; i++) {
      await runtime.analyze(host, { ...input, draftId: `d${i}`, text: '/command' })
    }
    expect(await runtime.analyze(host, { ...input, draftId: 'overflow' })).toMatchObject({
      state: 'unavailable',
      reason: 'queue_full'
    })
    expect((await runtime.analyze(host, { ...input, draftId: 'd0', revision: 0 })).state).toBe(
      'unavailable'
    )
    expect(evaluate).not.toHaveBeenCalled()
  })
  it.each(['invalid', 'error', 'abstain'])(
    'handles %s provider responses without raw errors',
    async (kind) => {
      const { runtime } = rig(
        vi.fn(async () => {
          if (kind === 'error') {
            throw new Error('secret=private')
          }
          return kind === 'invalid'
            ? {}
            : { ...answer, execution_lane: { choice: 'needs_context' } }
        })
      )
      const result = await runtime.analyze(host, input)
      expect(result.state).toBe(kind === 'abstain' ? 'needs_context' : 'unavailable')
      expect(JSON.stringify(result)).not.toContain('private')
    }
  )
  it('dispose cancels requests and disallows future work', async () => {
    const pending = deferred()
    const { runtime, evaluate } = rig(vi.fn(async () => pending.promise))
    const request = runtime.analyze(host, input)
    runtime.dispose()
    expect((await request).state).toBe('cancelled')
    pending.resolve(answer)
    await Promise.resolve()
    expect((await runtime.analyze(host, { ...input, revision: 2 })).state).toBe('unavailable')
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
})
