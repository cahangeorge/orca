import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprint } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import { describe, expect, it, vi } from 'vitest'
import type { DecisionShadowDispatch } from '../../shared/decision-shadow-types'
import { CodexStructuredSessionAdapter } from './codex-structured-session-adapter'
import {
  fakeCodex,
  identityFor,
  USER_MESSAGE,
  answerWithOpenedTurn
} from './codex-structured-session-adapter-fixture'

describe('Codex shadow dispatch boundary', () => {
  it('preserves exact turn requests and completes dispatch while observation hangs', async () => {
    const run = async (shadow: boolean) => {
      const codex = fakeCodex()
      const observe = vi.fn(
        (_input: Omit<DecisionShadowDispatch, 'ownerId'>) => new Promise<void>(() => {})
      )
      const cancel = vi.fn()
      const adapter = new CodexStructuredSessionAdapter({
        resolveLaunch: async () => ({
          command: 'codex',
          args: ['app-server'],
          cwd: '/repo',
          codexHome: null,
          resumeThreadId: null
        }),
        openConnection: codex.openConnection,
        readProcessStartTime: async () => 1,
        mintAcquisitionGeneration: () => 'opaque-generation',
        ...(shadow ? { decisionShadow: { observe, cancel } } : {})
      })
      await adapter.acquire({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn' })
      codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-1')
      await adapter.dispatch({
        sessionId: 'session-1',
        clientMessageId: 'message-1',
        body: USER_MESSAGE,
        fence: 7
      })
      await adapter.dispatch({
        sessionId: 'session-1',
        clientMessageId: 'message-2',
        body: USER_MESSAGE,
        fence: 7
      })
      await adapter.closeSession('session-1')
      return { calls: codex.connections[0].calls, observe, cancel }
    }
    const off = await run(false)
    const shadow = await run(true)
    expect(shadow.calls).toEqual(off.calls)
    expect(shadow.observe).toHaveBeenCalledTimes(2)
    expect(shadow.observe.mock.calls[0][0]).toMatchObject({
      generation: 'opaque-generation',
      fence: 7,
      clientMessageId: 'message-1',
      activeTurn: false
    })
    expect(shadow.observe.mock.calls[1][0]).toMatchObject({
      clientMessageId: 'message-2',
      activeTurn: true
    })
    expect(shadow.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 'opaque-generation', fence: 7 }),
      'close'
    )
  })

  it('offers only supported pilot lanes and keeps absent reported options unknown', async () => {
    const catalog = new AgentModelCatalogStore()
    const fingerprint = agentModelCatalogFingerprint({
      agent: 'codex',
      accountHomeVariable: 'CODEX_HOME',
      accountHomePath: '/account',
      wslDistro: null
    })
    catalog.recordSuccess(fingerprint, 'codex', {
      origin: 'live-session',
      fastModeTierByModel: new Map(),
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'Sol',
          isDefault: true,
          efforts: [{ value: 'medium', label: 'Medium' }]
        },
        {
          id: 'gpt-6-luna',
          label: 'Luna',
          isDefault: false,
          efforts: [{ value: 'low', label: 'Low' }]
        },
        {
          id: 'unrelated',
          label: 'Other',
          isDefault: false,
          efforts: [{ value: 'high', label: 'High' }]
        }
      ]
    })
    const codex = fakeCodex()
    const observe = vi.fn((_input: Omit<DecisionShadowDispatch, 'ownerId'>) => {})
    const update = vi.fn()
    const adapter = new CodexStructuredSessionAdapter({
      resolveLaunch: async () => ({
        command: 'codex',
        args: [],
        cwd: '/repo',
        codexHome: '/account',
        resumeThreadId: null
      }),
      openConnection: codex.openConnection,
      readProcessStartTime: async () => 1,
      modelCatalog: catalog,
      decisionShadow: { observe, update, cancel: () => {} }
    })
    await adapter.acquire({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn' })
    await adapter.setOption({
      sessionId: 'session-1',
      fence: 7,
      key: 'model',
      value: 'gpt-6.1-sol'
    })
    await adapter.setOption({ sessionId: 'session-1', fence: 7, key: 'effort', value: 'medium' })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-1')
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'message',
      body: USER_MESSAGE,
      fence: 7
    })
    expect(observe.mock.calls[0][0].availableLanes).toEqual([
      { model: 'gpt-6.1-sol', effort: 'medium' }
    ])
    expect(observe.mock.calls[0][0].requested).toEqual({ model: 'gpt-6.1-sol', effort: 'medium' })
    expect(observe.mock.calls[0][0].reported).toBeUndefined()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ fence: 7 }), 'message', {
      deliveryState: 'admitted',
      turnId: 'turn-1'
    })
    await adapter.closeAll()
  })

  it('contains observer exceptions and cancels before awaiting Stop', async () => {
    const codex = fakeCodex()
    const cancel = vi.fn()
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
      decisionShadow: {
        observe: () => {
          throw new Error('observer unavailable')
        },
        cancel
      }
    })
    await adapter.acquire({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn' })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-1')
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'message',
      body: USER_MESSAGE,
      fence: 7
    })
    const stop = adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })
    expect(cancel).toHaveBeenCalledWith(expect.anything(), 'stop')
    await stop
    await adapter.closeAll()
  })
})
