import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionShadowObserver } from './decision-shadow-observer'
import {
  createSimulatedDecisionShadowProvider,
  type DecisionShadowProvider
} from './decision-shadow-provider'
import type {
  DecisionShadowDispatch,
  DecisionShadowScope
} from '../../shared/decision-shadow-types'

const scope: DecisionShadowScope = {
  sessionId: 'session',
  ownerId: 'owner',
  generation: 'generation-1',
  fence: 1
}
const dispatch: DecisionShadowDispatch = {
  ...scope,
  clientMessageId: 'message',
  text: 'Implement a bounded observer with cancellation tests',
  availableLanes: [{ model: 'gpt-6.1-sol', effort: 'medium' }],
  choicesVersion: 'catalog-1',
  requested: { model: 'gpt-6.1-sol', effort: 'medium' },
  deliveryState: 'dispatched',
  activeTurn: false,
  autonomous: true
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
afterEach(() => vi.useRealTimers())

describe('decision shadow lifecycle', () => {
  it('defaults Off, deduplicates correlation and returns independent simulated answers', async () => {
    const observer = new DecisionShadowObserver(createSimulatedDecisionShadowProvider())
    expect(observer.observe(dispatch)).toBe(false)
    expect(observer.read(scope)).toEqual([])
    observer.configure(scope, true)
    expect(observer.observe(dispatch)).toBe(true)
    expect(observer.observe(dispatch)).toBe(false)
    await flush()
    const result = observer.read(scope)[0]
    expect(result.state).toBe('available')
    expect(result.provider).toBe('simulated-fixture')
    expect(result.answers?.task_category.confidence).not.toBe(
      result.answers?.execution_lane.confidence
    )
    expect(result.calibration).toBe('uncalibrated')
    expect(JSON.stringify(result)).not.toContain(dispatch.text)
  })

  it.each(['off', 'stop', 'close', 'replacement'] as const)(
    'ignores late results after %s',
    async (reason) => {
      let resolve: ((value: unknown) => void) | undefined
      let signal: AbortSignal | undefined
      const provider: DecisionShadowProvider = {
        id: 'simulated-fixture',
        modelRevision: 'test',
        evaluate: (_input, abort) => {
          signal = abort
          return new Promise((done) => {
            resolve = done
          })
        }
      }
      const observer = new DecisionShadowObserver(provider)
      observer.configure(scope, true)
      expect(observer.observe(dispatch)).toBe(true)
      await flush()
      if (reason === 'off') {
        observer.configure(scope, false)
      } else if (reason === 'replacement') {
        observer.configure({ ...scope, generation: 'generation-2', fence: 1 }, true)
      } else {
        observer.cancel(scope, reason)
      }
      expect(signal?.aborted).toBe(true)
      resolve?.({ task_category: { choice: 'docs' }, execution_lane: { choice: 'needs_context' } })
      await flush()
      expect(observer.read(scope).every((item) => item.state !== 'available')).toBe(true)
      expect(observer.observe(dispatch)).toBe(false)
    }
  )

  it('bounds a noncooperative provider, expires pending work and never dispatches concurrently', async () => {
    vi.useFakeTimers()
    const evaluate = vi.fn(() => new Promise<unknown>(() => {}))
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate
    })
    observer.configure(scope, true)
    for (let i = 0; i < 6; i++) {
      observer.observe({ ...dispatch, clientMessageId: `message-${i}` })
    }
    await flush()
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(observer.read(scope).filter((item) => item.reason === 'queue_full')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(observer.read(scope).filter((item) => item.state === 'expired')).toHaveLength(5)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it.each([
    { text: '/goal do work', reason: 'command' },
    { text: 'continuă', reason: 'needs_context' },
    { text: 'continuă implementarea precedentă de unde am rămas', reason: 'needs_context' },
    { autonomous: false, reason: 'needs_context' },
    { text: 'Continue the previous task from where we stopped', reason: 'needs_context' },
    { activeTurn: true, reason: 'active_turn' },
    { inputTruncated: true, reason: 'truncated' },
    { text: 'x'.repeat(4097), reason: 'truncated' },
    { availableLanes: [], reason: 'no_available_lane' }
  ])('skips ineligible dispatches: $reason', async ({ reason, ...changes }) => {
    const evaluate = vi.fn()
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate
    })
    observer.configure(scope, true)
    observer.observe({ ...dispatch, ...changes })
    await flush()
    expect(evaluate).not.toHaveBeenCalled()
    expect(observer.read(scope)[0].reason).toBe(reason)
  })

  it('redacts transient input, retains no error body and rejects unavailable choices', async () => {
    let inputText = ''
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate: async (input) => {
        inputText = input.text
        return { task_category: { choice: 'docs' }, execution_lane: { choice: 'unavailable' } }
      }
    })
    observer.configure(scope, true)
    observer.observe({
      ...dispatch,
      text: 'Review token=secret123 at /home/private/project and person@example.com https://host/private'
    })
    await flush()
    expect(inputText).not.toMatch(/secret123|home\/private|person@example|host\/private/)
    expect(observer.read(scope)[0].reason).toBe('invalid_response')
    expect(observer.read({ ...scope, ownerId: 'intruder' })).toEqual([])
    expect(observer.configure({ ...scope, ownerId: 'intruder' }, false)).toBe(false)
  })

  it.each([
    'Review JSON {"api_key": "SYNTHETIC_PRIVATE_VALUE with spaces"}',
    'Review configuration\nAPI_KEY = "SYNTHETIC_PRIVATE_VALUE with spaces"'
  ])('redacts quoted credentials before inference', async (text) => {
    let snapshot = ''
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate: async (input) => {
        snapshot = JSON.stringify(input)
        return {}
      }
    })
    observer.configure(scope, true)
    observer.observe({ ...dispatch, text })
    await flush()
    expect(snapshot).not.toContain('SYNTHETIC_PRIVATE_VALUE')
    expect(snapshot).not.toContain('with spaces')
    expect(JSON.stringify(observer.read(scope))).not.toContain('SYNTHETIC_PRIVATE_VALUE')
  })

  it('captures failures without retaining raw error bodies and isolates read snapshots', async () => {
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate: async () => {
        throw new Error('token=private /home/private/path')
      }
    })
    observer.configure(scope, true)
    observer.observe(dispatch)
    await flush()
    const snapshot = observer.read(scope)
    expect(snapshot[0].reason).toBe('provider_unavailable')
    expect(JSON.stringify(snapshot)).not.toMatch(/private|token=/)
    snapshot[0].state = 'available'
    expect(observer.read(scope)[0].state).toBe('unavailable')
  })

  it('rejects stale enable and cancels old queued work before replacement can run', async () => {
    let resolve: ((value: unknown) => void) | undefined
    const evaluate = vi.fn(
      () =>
        new Promise<unknown>((done) => {
          resolve = done
        })
    )
    const observer = new DecisionShadowObserver({
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate
    })
    observer.configure(scope, true)
    observer.observe(dispatch)
    observer.observe({ ...dispatch, clientMessageId: 'queued' })
    await flush()
    const replacement = { ...scope, generation: 'generation-2', fence: 1 }
    observer.configure(replacement, true)
    expect(observer.configure(scope, true)).toBe(false)
    observer.observe({ ...dispatch, ...replacement })
    expect(evaluate).toHaveBeenCalledTimes(1)
    resolve?.({})
    await flush()
    expect(evaluate).toHaveBeenCalledTimes(2)
    observer.cancel(replacement, 'close')
    resolve?.({})
    await flush()
  })

  it('caps retained metadata at 200 and expires it after seven days', async () => {
    vi.useFakeTimers()
    const observer = new DecisionShadowObserver(createSimulatedDecisionShadowProvider())
    observer.configure(scope, true)
    for (let i = 0; i < 205; i++) {
      observer.observe({ ...dispatch, clientMessageId: `skip-${i}`, activeTurn: true })
    }
    expect(observer.read(scope)).toHaveLength(200)
    await vi.advanceTimersByTimeAsync(7 * 86400_000)
    expect(observer.read(scope)).toEqual([])
  })
})
