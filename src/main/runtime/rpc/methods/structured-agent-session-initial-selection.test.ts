import { describe, expect, it, vi } from 'vitest'
import { structuredAgentSessionCreateParams } from '../../../../shared/structured-agent-session-create'
import type { StructuredAgentSessionInitialOptions } from '../../../../shared/structured-agent-session-create'
import { CreateIntentParams } from '../../../../shared/rpc-contract/structured-agent-session-params'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'
import {
  admitAttachOrRefuse,
  attachFingerprintFields,
  type AgentSessionAttachParams
} from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import { hostTestState } from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import {
  prepareStructuredAgentSessionCreateForWorktree,
  structuredAgentSessionCreateIntentFingerprint
} from './structured-agent-session-create'

const PAIR = { model: 'gpt-6.1-sol', effort: 'medium' }
const SEED = { model: 'saved-model', effort: 'low', fastMode: 'true', permissionPolicy: 'manual' }
const SESSION = 'codex_11111111_2222_3333_4444_555555555555'

function setup(initialOptions?: StructuredAgentSessionInitialOptions) {
  const intent = structuredAgentSessionCreateParams({
    sessionId: SESSION,
    worktree: 'id:workspace-1',
    agent: 'codex',
    ...(initialOptions ? { initialOptions, initialOptionsCatalogRef: 'catalog_01' } : {}),
    randomUuid: () => '00000000-0000-4000-8000-000000000001',
    now: 1_800_000_000_000
  })
  const resolved: AgentSessionAttachParams = {
    envelope: intent.envelope,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/host/.codex' },
    runtimeKind: 'native',
    options: { ...SEED }
  }
  const runtime = { resolveStructuredAgentSessionCreateIntent: vi.fn(async () => resolved) }
  const ensureHost = vi.fn(async () => hostTestState().host)
  const args = {
    runtime,
    ensureHost,
    envelope: intent.envelope,
    worktree: intent.worktree,
    agent: intent.agent,
    caller: { callerKey: 'client-1' },
    ...(initialOptions ? { initialOptions } : {})
  }
  return { args, intent, resolved, runtime, ensureHost }
}

describe('host prepared initial selection', () => {
  it('binds the selected pair before digesting the same attach object admitted later', async () => {
    const { args } = setup(PAIR)
    const prepared = await prepareStructuredAgentSessionCreateForWorktree(args)
    expect(prepared.attachParams.createInitialSelection).toEqual(PAIR)
    expect(prepared.attachParams.options).toEqual({ ...SEED, ...PAIR })
    expect(admitAttachOrRefuse(prepared.attachParams)).toEqual({
      ok: true,
      fingerprint: prepared.attachParams.envelope.payloadFingerprint
    })
    expect(prepared.attachParams.envelope.payloadFingerprint).toBe(
      computeAgentSessionPayloadFingerprint({
        method: 'agentSession.attach',
        sessionId: SESSION,
        fields: attachFingerprintFields(prepared.attachParams)
      })
    )
    expect(hostTestState().acquire).not.toHaveBeenCalled()
    expect(hostTestState().dispatch).not.toHaveBeenCalled()
  })

  it('copies the approved pair before resolution can yield to an input edit', async () => {
    const pair = { ...PAIR }
    const { args, runtime, resolved } = setup(pair)
    runtime.resolveStructuredAgentSessionCreateIntent.mockImplementationOnce(async () => {
      pair.model = 'edited-model'
      pair.effort = 'high'
      return resolved
    })
    const prepared = await prepareStructuredAgentSessionCreateForWorktree(args)
    expect(prepared.attachParams.createInitialSelection).toEqual(PAIR)
    expect(prepared.attachParams.createInitialSelection).not.toBe(pair)
    expect(prepared.attachParams.options).toEqual({ ...SEED, ...PAIR })
  })

  it.each([
    { model: 'gpt-6-luna', effort: 'medium' },
    { model: 'gpt-6.1-sol', effort: 'high' }
  ])('binds changed model/effort to a different attach digest: %j', async (changed) => {
    const first = await prepareStructuredAgentSessionCreateForWorktree(setup(PAIR).args)
    const second = await prepareStructuredAgentSessionCreateForWorktree(setup(changed).args)
    expect(second.attachParams.envelope.payloadFingerprint).not.toBe(
      first.attachParams.envelope.payloadFingerprint
    )
  })

  it('excludes settings drift and presentation from the selected attach identity', async () => {
    const first = await prepareStructuredAgentSessionCreateForWorktree(setup(PAIR).args)
    const { args, resolved } = setup(PAIR)
    resolved.options = { model: 'another-saved-model', effort: 'high', fastMode: 'false' }
    const second = await prepareStructuredAgentSessionCreateForWorktree({
      ...args,
      tabId: 'tab-other'
    })
    expect(second.attachParams.envelope.payloadFingerprint).toBe(
      first.attachParams.envelope.payloadFingerprint
    )
    expect(second.attachParams.options).toEqual({ ...PAIR, fastMode: 'false' })
  })

  it.each([
    { agent: 'claude' as const },
    { resumeFrom: { providerSessionId: 'thread-adopted' } },
    { options: { model: 'dispatch-model' } }
  ])(
    'refuses mixing the new selection with incompatible input before resolution: %j',
    async (extra) => {
      const { args, runtime, ensureHost } = setup(PAIR)
      await expect(
        prepareStructuredAgentSessionCreateForWorktree({ ...args, ...extra })
      ).rejects.toThrow('agent_session_operation_invalid')
      expect(runtime.resolveStructuredAgentSessionCreateIntent).not.toHaveBeenCalled()
      expect(ensureHost).not.toHaveBeenCalled()
    }
  )

  it('keeps valid selected public creates inactive until catalog/account forwarding exists', () => {
    const { intent } = setup(PAIR)
    expect(CreateIntentParams.parse(intent)).toEqual(intent)
    expect(structuredAgentSessionCreateIntentFingerprint(intent)).not.toBe(
      intent.envelope.payloadFingerprint
    )
  })

  it('keeps the legacy blank attach digest and excludes undefined metadata', async () => {
    const { args } = setup()
    const first = await prepareStructuredAgentSessionCreateForWorktree(args)
    const tabbed = await prepareStructuredAgentSessionCreateForWorktree({ ...args, tabId: 'tab-1' })
    expect(first.attachParams).not.toHaveProperty('createInitialSelection')
    expect(first.attachParams.options).toEqual(SEED)
    expect(first.attachParams.envelope.payloadFingerprint).toBe(
      '2354ae4c3f4a8ebc7a559d561b6dcbb9bcbc65fe6b50ac17447bab307dc0dafc'
    )
    expect(tabbed.attachParams.envelope.payloadFingerprint).toBe(
      first.attachParams.envelope.payloadFingerprint
    )
    expect(
      attachFingerprintFields({ ...first.attachParams, createInitialSelection: undefined })
    ).toEqual(attachFingerprintFields(first.attachParams))
  })

  it('keeps legacy orchestration replacement options outside the digest', async () => {
    const { args } = setup()
    const original = await prepareStructuredAgentSessionCreateForWorktree(args)
    const dispatch = await prepareStructuredAgentSessionCreateForWorktree({
      ...args,
      options: { model: 'dispatch-model' }
    })
    expect(dispatch.attachParams.options).toEqual({ model: 'dispatch-model' })
    expect(dispatch.attachParams.envelope.payloadFingerprint).toBe(
      original.attachParams.envelope.payloadFingerprint
    )
  })

  it('keeps the pinned adopting attach digest without new metadata', async () => {
    const { args, resolved } = setup()
    resolved.adopt = {
      providerHandle: { kind: 'codex', threadId: 'thread-adopted' },
      transcriptPath: '/host/transcript'
    }
    const prepared = await prepareStructuredAgentSessionCreateForWorktree({
      ...args,
      resumeFrom: { providerSessionId: 'thread-adopted' }
    })
    expect(prepared.attachParams.envelope.payloadFingerprint).toBe(
      'dacdb858e9da78bcbeb48ace752fe7c951334b4fe975b7ca92a43b93f5081683'
    )
  })

  it.each(['wrong-model', undefined])(
    'refuses selection metadata that does not match reservation options: %j',
    async (model) => {
      const prepared = await prepareStructuredAgentSessionCreateForWorktree(setup(PAIR).args)
      const params = {
        ...prepared.attachParams,
        options: { effort: PAIR.effort, ...(model ? { model } : {}) }
      }
      expect(admitAttachOrRefuse(params)).toMatchObject({
        ok: false,
        refusal: { code: 'agent_session_operation_invalid' }
      })
    }
  )

  it.each([
    { agent: 'claude' as const },
    { provider: 'claude' as const },
    { adopt: { providerHandle: { kind: 'codex' as const, threadId: 'thread-adopted' } } }
  ])(
    'refuses selected metadata outside a new Codex attach despite a correct digest: %j',
    async (extra) => {
      const prepared = await prepareStructuredAgentSessionCreateForWorktree(setup(PAIR).args)
      const params = { ...prepared.attachParams, ...extra }
      params.envelope = {
        ...params.envelope,
        payloadFingerprint: computeAgentSessionPayloadFingerprint({
          method: 'agentSession.attach',
          sessionId: SESSION,
          fields: attachFingerprintFields(params)
        })
      }
      expect(admitAttachOrRefuse(params)).toMatchObject({
        ok: false,
        refusal: { code: 'agent_session_operation_invalid' }
      })
    }
  )

  it('refuses a selected ensure with a non-null fence despite a correct digest', async () => {
    const { args, runtime, ensureHost } = setup(PAIR)
    const envelope = { ...args.envelope, expectedRuntimeFence: 1 }
    await expect(
      prepareStructuredAgentSessionCreateForWorktree({ ...args, envelope })
    ).rejects.toThrow('agent_session_operation_invalid')
    expect(runtime.resolveStructuredAgentSessionCreateIntent).not.toHaveBeenCalled()
    expect(ensureHost).not.toHaveBeenCalled()
    const prepared = await prepareStructuredAgentSessionCreateForWorktree(args)
    const params = { ...prepared.attachParams, envelope }
    params.envelope = {
      ...envelope,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.attach',
        sessionId: SESSION,
        fields: attachFingerprintFields(params)
      })
    }
    expect(admitAttachOrRefuse(params)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
  })
})
