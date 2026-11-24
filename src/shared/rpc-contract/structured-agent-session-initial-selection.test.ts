import { describe, expect, it } from 'vitest'
import { AttachParams, CreateIntentParams, CreateParams } from './structured-agent-session-params'
import { structuredAgentSessionCreateParams } from '../structured-agent-session-create'
import {
  structuredAgentSessionCreateFingerprint,
  structuredAgentSessionPayloadFingerprint
} from '../structured-agent-session-mutation'

const legacy = structuredAgentSessionCreateParams({
  sessionId: 'codex_11111111_2222_3333_4444_555555555555',
  worktree: 'id:repo-1::/repo/orca',
  agent: 'codex',
  randomUuid: () => '00000000-0000-4000-8000-000000000001',
  now: 1_800_000_000_000
})
const initialOptions = { model: 'gpt-6.1-sol', effort: 'medium' }
const selected = structuredAgentSessionCreateParams({
  sessionId: legacy.envelope.sessionId,
  worktree: legacy.worktree,
  agent: 'codex',
  initialOptions,
  initialOptionsCatalogRef: 'catalog_01',
  randomUuid: () => '00000000-0000-4000-8000-000000000003',
  now: 1_800_000_000_000
})

function withRecomputedDigest(
  payload: { envelope: typeof legacy.envelope } & Record<string, unknown>
) {
  const { envelope, ...fields } = payload
  return {
    ...fields,
    envelope: {
      ...envelope,
      payloadFingerprint: structuredAgentSessionPayloadFingerprint({
        method: 'agentSession.create',
        sessionId: envelope.sessionId,
        fields
      })
    }
  }
}

describe('strict initial selection create contract', () => {
  it('accepts and preserves the complete initial selection without normalization', () => {
    expect(CreateIntentParams.parse(selected)).toEqual(selected)
    expect(CreateParams.parse(selected)).toEqual(selected)
  })

  it('refuses selected fields with a legacy digest that the current host would ignore', () => {
    expect(CreateParams.safeParse({ ...selected, envelope: legacy.envelope }).success).toBe(false)
  })

  it.each([
    { initialOptions: { ...initialOptions, model: 'gpt-6-luna' } },
    { initialOptions: { ...initialOptions, effort: 'high' } },
    { initialOptionsCatalogRef: 'catalog_02' }
  ])('refuses changed selection fields under the original digest: %j', (changed) => {
    expect(CreateParams.safeParse({ ...selected, ...changed }).success).toBe(false)
  })

  it('recomputes the digest from constructor output after wire parsing', () => {
    const params = structuredAgentSessionCreateParams({
      sessionId: legacy.envelope.sessionId,
      worktree: legacy.worktree,
      agent: 'codex',
      initialOptions,
      initialOptionsCatalogRef: 'catalog_01',
      randomUuid: () => '00000000-0000-4000-8000-000000000002',
      now: 1_800_000_000_000
    })
    const parsed = CreateIntentParams.parse(params)
    expect(parsed).toEqual(params)
    expect(parsed.envelope.payloadFingerprint).toBe(
      structuredAgentSessionCreateFingerprint({ sessionId: parsed.envelope.sessionId, ...parsed })
    )
  })

  it.each([
    { ...legacy, initialOptions },
    { ...legacy, initialOptionsCatalogRef: 'catalog_01' },
    { ...selected, initialOptions: { model: 'gpt-6.1-sol' } },
    { ...selected, initialOptions: { effort: 'medium' } },
    { ...selected, initialOptions: {} },
    { ...selected, initialOptions: null },
    { ...selected, initialOptionsCatalogRef: null }
  ])('refuses partial or null selections: %j', (payload) => {
    expect(CreateParams.safeParse(withRecomputedDigest(payload)).success).toBe(false)
  })

  it.each(['fastMode', 'approvalsReviewer', 'permissionPolicy', 'tools', 'accountHome'])(
    'refuses additional initial option %s',
    (key) => {
      expect(
        CreateParams.safeParse({
          ...selected,
          initialOptions: { ...initialOptions, [key]: 'value' }
        }).success
      ).toBe(false)
    }
  )

  it.each(['model', 'effort'])('refuses invalid %s tokens', (key) => {
    for (const value of [
      '',
      ' ',
      'medium ',
      ' medium',
      'with space',
      'line\nbreak',
      'x'.repeat(513),
      1
    ]) {
      expect(
        CreateParams.safeParse(
          withRecomputedDigest({ ...selected, initialOptions: { ...initialOptions, [key]: value } })
        ).success
      ).toBe(false)
    }
  })

  it.each(['', ' ', ' catalog_01', 'catalog_01 ', 'with space', 'line\nbreak', 'x'.repeat(257), 1])(
    'refuses an invalid catalog reference: %j',
    (initialOptionsCatalogRef) => {
      expect(
        CreateParams.safeParse(withRecomputedDigest({ ...selected, initialOptionsCatalogRef }))
          .success
      ).toBe(false)
    }
  )

  it('leaves provider model and effort availability to host catalog validation', () => {
    const payload = {
      ...selected,
      initialOptions: { model: 'future-model', effort: 'future-effort' }
    }
    const signed = withRecomputedDigest(payload)
    expect(CreateIntentParams.parse(signed)).toEqual(signed)
  })

  it.each([
    { ...selected, agent: 'claude' },
    { ...selected, resumeFrom: { providerSessionId: 'thread-1' } }
  ])('refuses initial selection for a non-new Codex conversation: %j', (payload) => {
    expect(CreateParams.safeParse(withRecomputedDigest(payload)).success).toBe(false)
  })

  it.each([
    legacy,
    { ...legacy, resumeFrom: { providerSessionId: 'thread-1' } },
    { ...legacy, agent: 'claude' }
  ])('preserves a legacy create payload: %j', (payload) => {
    expect(CreateParams.parse(payload)).toEqual(payload)
  })

  const attach = {
    envelope: legacy.envelope,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/host-derived/account' },
    runtimeKind: 'native',
    providerHandle: { kind: 'codex', threadId: 'thread-1' }
  }

  it('preserves strict legacy attach behavior', () => {
    expect(AttachParams.parse(attach)).toEqual(attach)
    expect(CreateParams.parse(attach)).toEqual(attach)
  })

  it.each([
    { initialOptions },
    { initialOptionsCatalogRef: 'catalog_01' },
    { createInitialSelection: initialOptions }
  ])('refuses client-authored selection metadata on attach: %j', (metadata) => {
    expect(CreateParams.safeParse({ ...attach, ...metadata }).success).toBe(false)
  })
})
