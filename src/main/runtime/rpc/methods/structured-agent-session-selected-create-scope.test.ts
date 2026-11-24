import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { RpcContext } from '../core'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { structuredAgentSessionCreateParams } from '../../../../shared/structured-agent-session-create'
import {
  AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS,
  AGENT_SESSION_OPERATION_FUTURE_SKEW_MS
} from '../../../../shared/agent-session-host-authority'
import {
  resolveSelectedCreateHostScope,
  SELECTED_CREATE_LOCAL_POLICY_VERSION
} from './structured-agent-session-selected-create-scope'

const NOW = 1_800_000_000_000
const LOCATION = {
  executionHostId: 'local' as const,
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'folder' as const
}
class ScopeRuntime extends OrcaRuntimeService {
  location: {
    executionHostId: ExecutionHostId
    wslDistro: string | null
    workspaceId: string
    workspaceKind: 'folder' | 'git-worktree'
  } = { ...LOCATION }
  protected async resolveStructuredAgentSessionLocation(_selector: string) {
    return { ...this.location }
  }
}
function fixture() {
  const prepare = vi.fn(() => '/prepared/home')
  const account = vi.fn(() => '/selected/home')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fixture exercises only getSettings; all other runtime boundary reads are owned mocks below.
  const store = {
    getSettings: () =>
      createGlobalSettingsFixture({
        agentDefaultEnv: { codex: { CODEX_HOME: '/configured/home' } }
      })
  } as never
  const runtime = new ScopeRuntime(store, undefined, {
    prepareCodexStructuredLaunch: prepare,
    resolveCodexStructuredLaunchHome: account
  })
  const settings = vi
    .spyOn(runtime, 'getClientSettings')
    .mockReturnValue({ ...runtime.getClientSettings(), experimentalStructuredNativeChat: true })
  const path = vi
    .spyOn(runtime, 'resolveStructuredAgentSessionLocalWorkspacePath')
    .mockResolvedValue('/workspace')
  const intent = structuredAgentSessionCreateParams({
    sessionId: 'codex_11111111_2222_3333_4444_555555555555',
    worktree: 'id:workspace-1',
    agent: 'codex',
    initialOptions: { model: 'gpt-6.1-sol', effort: 'medium' },
    initialOptionsCatalogRef: 'catalog-ref',
    randomUuid: () => '00000000-0000-4000-8000-000000000001',
    now: NOW
  })
  const ctx: RpcContext = {
    runtime,
    clientKind: 'runtime',
    clientId: 'desktop-renderer',
    connectionId: 'connection-1',
    clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
  }
  return { runtime, account, prepare, settings, path, intent, ctx }
}
describe('selected-create host scope read-only preflight', () => {
  it.each(['folder', 'git-worktree'] as const)(
    'derives actual %s scope and preserves client intent/IDs without launch preparation',
    async (kind) => {
      const f = fixture()
      f.runtime.location.workspaceKind = kind
      const result = await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)
      expect(result).toEqual({
        decision: 'scoped',
        admission: 'unproven',
        request: f.intent,
        scope: {
          callerKey: 'desktop-renderer',
          location: { ...LOCATION, workspaceKind: kind },
          workspacePath: '/workspace',
          accountHome: { variable: 'CODEX_HOME', path: '/selected/home' },
          policyVersion: SELECTED_CREATE_LOCAL_POLICY_VERSION
        }
      })
      expect(f.account).toHaveBeenCalled()
      expect(f.prepare).not.toHaveBeenCalled()
      if (result.decision !== 'scoped') {
        throw new Error('missing scoped result')
      }
      expect(result.request).not.toBe(f.intent)
      f.intent.initialOptions = { model: 'edited', effort: 'high' }
      expect(result.request.initialOptions).toEqual({ model: 'gpt-6.1-sol', effort: 'medium' })
    }
  )
  it('uses the read-only account resolver directly and never prepares launch', async () => {
    const f = fixture()
    expect(await f.runtime.resolveStructuredAgentSessionSelectionScope('id:workspace-1')).toEqual({
      location: LOCATION,
      workspacePath: '/workspace',
      accountHome: { variable: 'CODEX_HOME', path: '/selected/home' }
    })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.account).toHaveBeenCalledWith({
      workspacePath: '',
      launchEnv: expect.objectContaining({ CODEX_HOME: '/configured/home' })
    })
  })
  it.each([{ executionHostId: 'ssh:remote-host' }, { wslDistro: 'Ubuntu' }])(
    'refuses unsupported scope before account reads: %j',
    async (change) => {
      const f = fixture()
      Object.assign(f.runtime.location, change)
      expect(
        await f.runtime.resolveStructuredAgentSessionSelectionScope('id:workspace-1')
      ).toBeNull()
      expect(f.account).not.toHaveBeenCalled()
      expect(f.prepare).not.toHaveBeenCalled()
      expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
        decision: 'unknown'
      })
    }
  )
  it.each([
    { clientId: 'paired-token' },
    { pairedDeviceId: 'device' },
    { clientKind: 'mobile' as const },
    { clientKind: undefined },
    { connectionId: undefined },
    { clientCapabilities: [] }
  ])('refuses untrusted transport/capability without resolving accounts: %j', async (change) => {
    const f = fixture()
    Object.assign(f.ctx, change)
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'unknown'
    })
    expect(f.account).not.toHaveBeenCalled()
  })
  it('refuses revoked host policy before resolution', async () => {
    const f = fixture()
    f.settings.mockReturnValue({
      ...f.runtime.getClientSettings(),
      experimentalStructuredNativeChat: false
    })
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'unknown'
    })
    expect(f.account).not.toHaveBeenCalled()
  })
  it.each([
    { callerKey: 'forged' },
    { accountHome: { variable: 'CODEX_HOME', path: '/forged' } },
    { policyVersion: 'forged' },
    { location: LOCATION },
    { agent: 'claude' },
    { resumeFrom: { providerSessionId: 'adopt' } }
  ])('refuses malformed or forged request fields before resolution: %j', async (change) => {
    const f = fixture()
    expect(
      await resolveSelectedCreateHostScope({ ...f.intent, ...change }, f.ctx, () => NOW)
    ).toMatchObject({ decision: 'conflict' })
    expect(f.account).not.toHaveBeenCalled()
  })
  it('refuses tampered selected pair/digest and nonnull fence', async () => {
    const f = fixture()
    for (const intent of [
      { ...f.intent, initialOptions: { model: 'edited', effort: 'high' } },
      { ...f.intent, envelope: { ...f.intent.envelope, expectedRuntimeFence: 1 } }
    ]) {
      expect(await resolveSelectedCreateHostScope(intent, f.ctx, () => NOW)).toMatchObject({
        decision: 'conflict'
      })
    }
    expect(f.account).not.toHaveBeenCalled()
  })
  it.each([
    'not-a-durable-id',
    `${NOW + AGENT_SESSION_OPERATION_FUTURE_SKEW_MS + 1}-00000000000040008000000000000001`,
    `${NOW - AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS - 1}-00000000000040008000000000000001`
  ])('refuses invalid/stale/future operation ID without minting replacement: %s', async (id) => {
    const f = fixture()
    f.intent.envelope.clientOperationId = id
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'unknown'
    })
    expect(f.account).not.toHaveBeenCalled()
  })
  it.each(['account', 'location', 'path', 'connection', 'caller', 'capability', 'policy', 'abort'])(
    'detects %s drift across awaits',
    async (drift) => {
      const f = fixture()
      const signal = new AbortController()
      f.ctx.signal = signal.signal
      f.account.mockImplementationOnce(() => {
        if (drift === 'account') {
          f.account.mockReturnValue('/other/home')
        }
        if (drift === 'location') {
          f.runtime.location.workspaceId = 'other-workspace'
        }
        if (drift === 'path') {
          f.path.mockResolvedValue('/other/path')
        }
        if (drift === 'connection') {
          f.ctx.connectionId = 'connection-2'
        }
        if (drift === 'caller') {
          f.ctx.clientId = 'other-client'
        }
        if (drift === 'capability') {
          f.ctx.clientCapabilities = []
        }
        if (drift === 'policy') {
          f.settings.mockReturnValue({
            ...f.runtime.getClientSettings(),
            experimentalStructuredNativeChat: false
          })
        }
        if (drift === 'abort') {
          signal.abort()
        }
        return '/selected/home'
      })
      expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
        decision: 'unknown'
      })
      expect(f.prepare).not.toHaveBeenCalled()
    }
  )
  it.each([Number.NaN, NOW - 1, NOW + AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS + 1])(
    'resamples clock after awaits and refuses invalid/rollback/expiry: %s',
    async (after) => {
      const f = fixture()
      const now = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(after)
      expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, now)).toMatchObject({
        decision: 'unknown'
      })
    }
  )
  it.each([null, '', ' '])('refuses missing or blank workspace path: %j', async (path) => {
    const f = fixture()
    f.path.mockResolvedValue(path)
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'unknown'
    })
  })
  it('does not rewrite the pinned intent when renderer input changes during resolution', async () => {
    const f = fixture()
    const original = structuredClone(f.intent)
    f.account.mockImplementationOnce(() => {
      f.intent.worktree = 'id:forged'
      f.intent.initialOptions = { model: 'edited', effort: 'high' }
      return '/selected/home'
    })
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'scoped',
      request: original
    })
    expect(f.path).toHaveBeenCalledWith(original.worktree)
  })
  it('sanitizes resolver failures and allows subsequent reads', async () => {
    const f = fixture()
    f.account.mockImplementationOnce(() => {
      throw new Error('sensitive fixture detail')
    })
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toEqual({
      decision: 'unknown',
      reason: 'host-scope-unavailable'
    })
    expect(await resolveSelectedCreateHostScope(f.intent, f.ctx, () => NOW)).toMatchObject({
      decision: 'scoped'
    })
  })
})
