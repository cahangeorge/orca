import { describe, expect, it, vi } from 'vitest'
import { DecisionShadowObserver } from '../decision-shadow/decision-shadow-observer'
import { createSimulatedDecisionShadowProvider } from '../decision-shadow/decision-shadow-provider'
import type { DecisionShadowScope } from '../../shared/decision-shadow-types'
import { CodexStructuredSessionAdapter } from './codex-structured-session-adapter'
import {
  fakeCodex,
  identityFor,
  THREAD_ID,
  USER_MESSAGE,
  answerWithOpenedTurn
} from './codex-structured-session-adapter-fixture'

async function rig() {
  const scope: DecisionShadowScope = {
    sessionId: 'session-1',
    ownerId: 'desktop-renderer',
    generation: 'generation-1',
    fence: 7
  }
  const observer = new DecisionShadowObserver(createSimulatedDecisionShadowProvider())
  observer.configure(scope, true)
  const codex = fakeCodex()
  let generation = 0
  const adapter = new CodexStructuredSessionAdapter({
    resolveLaunch: async () => ({
      command: 'codex',
      args: [],
      cwd: '/repo',
      codexHome: null,
      resumeThreadId: null
    }),
    openConnection: codex.openConnection,
    readProcessStartTime: async () => 1,
    mintAcquisitionGeneration: () => `generation-${++generation}`,
    decisionShadow: {
      observe: (input) => {
        observer.observe({ ...input, ownerId: scope.ownerId })
      },
      update: (identity, clientMessageId, metadata) =>
        observer.update({ ...identity, ownerId: scope.ownerId }, clientMessageId, metadata),
      cancel: (identity, reason) => observer.cancel({ ...identity, ownerId: scope.ownerId }, reason)
    }
  })
  const acquire = () =>
    adapter.acquire({
      identity: identityFor(scope.sessionId),
      fence: 7,
      spawnToken: 'spawn',
      events: { appendItem: () => {}, appendTombstone: () => {}, publish: () => {} }
    })
  await acquire()
  const echo = () =>
    codex.connections[0].handlers.onNotification?.('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-1',
      item: {
        type: 'userMessage',
        id: 'user-1',
        clientId: 'message',
        content: [{ type: 'text', text: 'ship it' }]
      }
    })
  const dispatch = () =>
    adapter.dispatch({
      sessionId: scope.sessionId,
      clientMessageId: 'message',
      body: USER_MESSAGE,
      fence: 7
    })
  return { scope, observer, codex, adapter, acquire, echo, dispatch }
}

describe('shadow delivery correlation', () => {
  it('keeps a timed-out send unknown until its late echo proves delivery', async () => {
    const { scope, observer, codex, adapter, echo, dispatch } = await rig()
    codex.routes['turn/start'] = () => {
      throw new Error('transport timeout')
    }
    await expect(dispatch()).rejects.toThrow('transport timeout')
    expect(observer.read(scope)[0].deliveryState).toBe('unknown')
    echo()
    expect(observer.read(scope)[0]).toMatchObject({
      clientMessageId: 'message',
      deliveryState: 'acknowledged',
      turnId: 'turn-1'
    })
    await adapter.closeAll()
  })
  it('does not downgrade an early echo ACK when the turn/start reply arrives', async () => {
    const { scope, observer, codex, adapter, echo, dispatch } = await rig()
    let resolve: ((reply: unknown) => void) | undefined
    codex.routes['turn/start'] = () =>
      new Promise((done) => {
        resolve = done
      })
    const sending = dispatch()
    await vi.waitFor(() => expect(resolve).toBeDefined())
    echo()
    expect(observer.read(scope)[0].deliveryState).toBe('acknowledged')
    resolve?.({ turn: { id: 'provisional-answer-turn' } })
    await sending
    expect(observer.read(scope)[0]).toMatchObject({
      deliveryState: 'acknowledged',
      turnId: 'turn-1'
    })
    await adapter.closeAll()
  })
  it('replaces provisional admission identity with the later actual echo identity', async () => {
    const { scope, observer, codex, adapter, echo, dispatch } = await rig()
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'provisional-answer-turn')
    await dispatch()
    expect(observer.read(scope)[0]).toMatchObject({
      deliveryState: 'admitted',
      turnId: 'provisional-answer-turn'
    })
    echo()
    expect(observer.read(scope)[0]).toMatchObject({
      deliveryState: 'acknowledged',
      turnId: 'turn-1'
    })
    await adapter.closeAll()
  })

  it.each(['failed', 'interrupted'])(
    'records %s settlement separately from admission',
    async (status) => {
      const { scope, observer, codex, adapter, dispatch } = await rig()
      codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-1')
      await dispatch()
      expect(observer.read(scope)[0]).toMatchObject({ deliveryState: 'admitted', turnId: 'turn-1' })
      codex.connections[0].handlers.onNotification?.('turn/completed', {
        threadId: THREAD_ID,
        turn: { id: 'turn-1', status }
      })
      expect(observer.read(scope)[0].deliveryState).toBe('rejected')
      await adapter.closeAll()
    }
  )
  it('ignores an old acquisition reply after same-fence generation replacement', async () => {
    const { scope, observer, codex, adapter, acquire, dispatch } = await rig()
    let resolve: ((reply: unknown) => void) | undefined
    codex.routes['turn/start'] = () =>
      new Promise((done) => {
        resolve = done
      })
    const sending = dispatch()
    await vi.waitFor(() => expect(resolve).toBeDefined())
    const replacement = await acquire()
    const current = { ...scope, generation: replacement.acquisitionGeneration ?? '' }
    observer.configure(current, true)
    resolve?.({ turn: { id: 'turn-1' } })
    await sending
    expect(observer.read(current)).toEqual([])
    await adapter.closeAll()
  })
})
