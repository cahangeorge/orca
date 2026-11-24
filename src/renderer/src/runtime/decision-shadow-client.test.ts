import { afterEach, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from './runtime-rpc-client'
import { configureDecisionShadow, readDecisionShadow } from './decision-shadow-client'
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
afterEach(() => vi.resetAllMocks())
it('rejects remote use before any RPC and validates local responses', async () => {
  await expect(
    readDecisionShadow({ kind: 'environment', environmentId: 'remote' }, 'session')
  ).rejects.toThrow('local only')
  expect(callRuntimeRpc).not.toHaveBeenCalled()
  vi.mocked(callRuntimeRpc).mockResolvedValue({ mode: 'auto', observations: [] })
  await expect(readDecisionShadow({ kind: 'local' }, 'session')).rejects.toThrow('unavailable')
  vi.mocked(callRuntimeRpc).mockResolvedValue({ mode: 'shadow', observations: [] })
  expect(await configureDecisionShadow({ kind: 'local' }, 'session', true)).toEqual({
    mode: 'shadow',
    observations: []
  })
  expect(callRuntimeRpc).toHaveBeenLastCalledWith(
    { kind: 'local' },
    'agentSession.decisionShadowConfigure',
    { sessionId: 'session', enabled: true }
  )
})
