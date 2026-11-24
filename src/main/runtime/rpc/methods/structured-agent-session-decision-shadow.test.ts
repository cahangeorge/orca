import { afterEach, describe, expect, it } from 'vitest'
import {
  call,
  clearStructuredHostStub,
  hostStub,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
const desktop = {
  ...STRUCTURED_CLIENT,
  clientId: 'desktop-renderer',
  connectionId: 'webcontents-generation'
}
afterEach(clearStructuredHostStub)
describe('local shadow RPC admission', () => {
  it('reads Off without creating a host, inference or dispatch', async () => {
    setStructuredAgentSessionHost(hostStub())
    const result = await call('agentSession.decisionShadowRead', { sessionId: 'session' }, desktop)
    expect(result).toMatchObject({ result: { mode: 'off', observations: [] } })
  })
  it.each([
    { ...desktop, clientId: 'paired-token' },
    { ...desktop, pairedDeviceId: 'device' },
    { ...desktop, clientKind: 'mobile' as const },
    { ...desktop, connectionId: undefined },
    { ...desktop, clientKind: undefined }
  ])('rejects untrusted transport identity %#', async (caller) => {
    setStructuredAgentSessionHost(hostStub())
    for (const method of [
      'agentSession.decisionShadowRead',
      'agentSession.decisionShadowConfigure'
    ]) {
      const result = await call(
        method,
        { sessionId: 'session', ...(method.endsWith('Configure') ? { enabled: true } : {}) },
        caller
      )
      expect(result).toHaveProperty('error')
    }
  })
  it('rejects forged local flags and absent host without installing it', async () => {
    const result = await call(
      'agentSession.decisionShadowConfigure',
      { sessionId: 'session', enabled: true, local: true },
      desktop
    )
    expect(result).toHaveProperty('error')
    const absent = await call('agentSession.decisionShadowRead', { sessionId: 'session' }, desktop)
    expect(absent).toHaveProperty('error')
  })
})
