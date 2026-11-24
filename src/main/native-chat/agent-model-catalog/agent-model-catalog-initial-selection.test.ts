import { describe, expect, it } from 'vitest'
import { agentModelCatalogFingerprint } from './agent-model-catalog-fingerprint'
import {
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS,
  AGENT_MODEL_CATALOG_FRESH_MS,
  AgentModelCatalogStore,
  type AgentModelCatalogSuccess
} from './agent-model-catalog-store'
import {
  createInitialSelectionCatalogEvidence,
  type InitialSelectionCatalogContext
} from './agent-model-catalog-initial-selection'

function fixture(origin: 'probe' | 'live-session' = 'probe') {
  let at = 1_000
  const context: InitialSelectionCatalogContext = {
    ownerKey: 'owner-a',
    executionHostId: 'host-a',
    workspaceId: 'workspace-a',
    workspacePath: '/workspace/a',
    policyVersion: 'pilot-v1',
    account: {
      agent: 'codex',
      accountHomeVariable: 'CODEX_HOME',
      accountHomePath: '/accounts/a',
      wslDistro: null
    }
  }
  const fingerprint = agentModelCatalogFingerprint(context.account)
  const store = new AgentModelCatalogStore({ now: () => at })
  const success: AgentModelCatalogSuccess = {
    origin,
    fastModeTierByModel: new Map(),
    models: [
      {
        id: 'sol',
        label: 'Sol',
        isDefault: true,
        efforts: [
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' }
        ]
      }
    ]
  }
  store.recordSuccess(fingerprint, 'codex', success)
  const evidence = createInitialSelectionCatalogEvidence({ store, now: () => at })
  const issued = evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('fixture must issue evidence')
  }
  const selection = { model: 'sol', effort: 'medium' }
  const validate = (scope = context) =>
    evidence.validateNewCreate({
      context: scope,
      catalogRef: issued.catalogRef,
      choicesVersion: issued.choicesVersion,
      selection
    })
  return {
    context,
    fingerprint,
    store,
    success,
    evidence,
    issued,
    selection,
    validate,
    setTime: (value: number) => {
      at = value
    }
  }
}

describe('initial selection catalog evidence (host only, new create only)', () => {
  it.each(['probe', 'live-session'] as const)('accepts current-process %s evidence', (origin) => {
    const f = fixture(origin)
    expect(f.validate()).toEqual({ status: 'validated', initialOptions: f.selection })
    expect(f.issued.catalogRef).toMatch(/^[\da-f-]{36}$/u)
    expect(JSON.stringify(f.issued)).not.toContain('/accounts')
    expect(JSON.stringify(f.issued)).not.toContain('/workspace')
  })

  it.each([
    'ownerKey',
    'executionHostId',
    'workspaceId',
    'workspacePath',
    'policyVersion'
  ] as const)('refuses %s drift and revokes the examined reference', (field) => {
    const f = fixture()
    expect(f.validate({ ...f.context, [field]: 'changed' }).status).toBe('refused')
    expect(f.validate().status).toBe('unknown')
  })

  it('refuses account drift even if the other account lists the same pair', () => {
    const f = fixture()
    const context = {
      ...f.context,
      account: { ...f.context.account, accountHomePath: '/accounts/b' }
    }
    f.store.recordSuccess(agentModelCatalogFingerprint(context.account), 'codex', f.success)
    expect(f.validate(context).status).toBe('refused')
  })

  it.each([1_000 + AGENT_MODEL_CATALOG_FRESH_MS, 999, Number.NaN, Infinity, -1])(
    'refuses stale/future/invalid clock %s',
    (time) => {
      const f = fixture()
      f.setTime(time)
      expect(f.validate().status).toBe('refused')
    }
  )

  it('accepts until strictly before the freshness boundary', () => {
    const f = fixture()
    f.setTime(999 + AGENT_MODEL_CATALOG_FRESH_MS)
    expect(f.validate().status).toBe('validated')
  })

  it('refuses a missing catalog, unknown origin, wrong provider or nonfinite timestamp', () => {
    const f = fixture()
    const entry = f.store.get(f.fingerprint)!
    for (const fetchedAt of [Number.NaN, Infinity, -1]) {
      entry.fetchedAt = fetchedAt
      expect(f.evidence.issue(f.context).status).toBe('refused')
    }
    entry.fetchedAt = 1_000
    f.store.recordSuccess(f.fingerprint, 'claude', f.success)
    expect(f.evidence.issue(f.context).status).toBe('refused')
    expect(
      f.evidence.issue({
        ...f.context,
        account: { ...f.context.account, accountHomePath: '/missing' }
      }).status
    ).toBe('refused')
  })

  it('refuses unsupported account variable, provider or WSL before issuing', () => {
    const f = fixture()
    expect(
      f.evidence.issue({
        ...f.context,
        account: { ...f.context.account, accountHomeVariable: 'OTHER' }
      }).status
    ).toBe('refused')
    expect(
      f.evidence.issue({ ...f.context, account: { ...f.context.account, agent: 'claude' } }).status
    ).toBe('refused')
    expect(
      f.evidence.issue({ ...f.context, account: { ...f.context.account, wslDistro: 'linux' } })
        .status
    ).toBe('refused')
  })

  it('refuses withdrawal and efforts mutated through the permissive store', () => {
    for (const mutation of ['model', 'effort']) {
      const f = fixture()
      const entry = f.store.get(f.fingerprint)!
      if (mutation === 'model') {
        entry.models[0]!.id = 'other'
      } else {
        entry.models[0]!.efforts[0]!.value = 'low'
      }
      expect(f.validate().status).toBe('refused')
    }
  })

  it('refuses refresh failure beyond the picker failure TTL', () => {
    const f = fixture()
    f.store.recordFailure(f.fingerprint, 'private provider detail')
    f.setTime(1_001 + AGENT_MODEL_CATALOG_FAILURE_TTL_MS)
    expect(f.store.hasActiveFailure(f.fingerprint)).toBe(false)
    expect(f.validate()).toEqual({ status: 'refused', reason: 'catalog-unavailable' })
    expect(f.evidence.issue(f.context).status).toBe('refused')
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    expect(f.evidence.issue(f.context).status).toBe('ready')
    expect(f.validate().status).toBe('unknown')
  })

  it('refuses empty refresh without changing the picker last-good listing', () => {
    const f = fixture()
    f.store.recordSuccess(f.fingerprint, 'codex', { ...f.success, models: [] })
    expect(f.store.get(f.fingerprint)!.models).toHaveLength(1)
    expect(f.validate().status).toBe('refused')
  })

  it('requires a new reference after a successful refresh even at the same timestamp', () => {
    const f = fixture()
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    expect(f.validate().status).toBe('refused')
    expect(f.evidence.issue(f.context).status).toBe('ready')
  })

  it('does not allow presentation or selection mutations to change stored authority', () => {
    const f = fixture()
    f.issued.choices[0]!.efforts[0] = 'invented'
    const result = f.validate()
    if (result.status !== 'validated') {
      throw new Error('expected valid selection')
    }
    Object.assign(result.initialOptions, { effort: 'invented' })
    expect(f.validate()).toEqual({ status: 'validated', initialOptions: f.selection })
    expect(
      f.evidence.validateNewCreate({
        context: f.context,
        catalogRef: f.issued.catalogRef,
        choicesVersion: f.issued.choicesVersion,
        selection: { model: 'sol', effort: 'invented' }
      }).status
    ).toBe('refused')
  })

  it('refuses forged choicesVersion', () => {
    const f = fixture()
    expect(
      f.evidence.validateNewCreate({
        context: f.context,
        catalogRef: f.issued.catalogRef,
        choicesVersion: 'forged',
        selection: f.selection
      }).status
    ).toBe('refused')
  })

  it('validates the create contract with only the opaque reference and explicit pair', () => {
    const f = fixture()
    expect(
      f.evidence.validateNewCreate({
        context: f.context,
        catalogRef: f.issued.catalogRef,
        selection: f.selection
      })
    ).toEqual({ status: 'validated', initialOptions: f.selection })
  })

  it('normalizes ordering but binds origin, timestamp and membership', () => {
    const f = fixture()
    const before = f.issued.choicesVersion
    f.success.models[0]!.efforts.reverse()
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    const same = f.evidence.issue(f.context)
    expect(same.status === 'ready' && same.choicesVersion).toBe(before)
    f.setTime(1_001)
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    const later = f.evidence.issue(f.context)
    expect(later.status === 'ready' && later.choicesVersion).not.toBe(before)
  })

  it.each(['duplicate-model', 'duplicate-effort', 'empty-efforts', 'invalid-id', 'invalid-effort'])(
    'refuses ambiguous/malformed %s catalog',
    (mutation) => {
      const f = fixture()
      const model = f.store.get(f.fingerprint)!.models[0]!
      if (mutation === 'duplicate-model') {
        f.store.get(f.fingerprint)!.models.push({ ...model })
      }
      if (mutation === 'duplicate-effort') {
        model.efforts.push({ ...model.efforts[0]! })
      }
      if (mutation === 'empty-efforts') {
        model.efforts = []
      }
      if (mutation === 'invalid-id') {
        model.id = 'has space'
      }
      if (mutation === 'invalid-effort') {
        model.efforts[0]!.value = ''
      }
      expect(f.evidence.issue(f.context).status).toBe('refused')
    }
  )

  it('returns UNKNOWN for missing/restarted/evicted references, never permission to recreate', () => {
    const f = fixture()
    const input = {
      context: f.context,
      catalogRef: f.issued.catalogRef,
      choicesVersion: f.issued.choicesVersion,
      selection: f.selection
    }
    expect(
      createInitialSelectionCatalogEvidence({ store: f.store, now: () => 1_000 }).validateNewCreate(
        input
      )
    ).toEqual({ status: 'unknown', reason: 'reconciliation-required' })
    for (let index = 0; index < 256; index++) {
      expect(f.evidence.issue(f.context).status).toBe('ready')
    }
    expect(f.evidence.validateNewCreate(input)).toEqual({
      status: 'unknown',
      reason: 'reconciliation-required'
    })
  })

  it('cannot issue against persisted last-good evidence after a restart', async () => {
    const f = fixture()
    const restarted = new AgentModelCatalogStore({ now: () => 1_000 })
    await restarted.attachPersistence({
      load: async () => [f.store.get(f.fingerprint)!],
      save: () => {},
      flush: async () => {}
    })
    expect(
      createInitialSelectionCatalogEvidence({ store: restarted, now: () => 1_000 }).issue(f.context)
        .status
    ).toBe('refused')
  })

  it('rejects unknown origin and blank host identities without exposing paths', () => {
    const f = fixture()
    Object.assign(f.store.get(f.fingerprint)!, { origin: 'unknown' })
    expect(f.evidence.issue(f.context)).toEqual({
      status: 'refused',
      reason: 'catalog-unavailable'
    })
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    for (const field of [
      'ownerKey',
      'executionHostId',
      'workspaceId',
      'workspacePath',
      'policyVersion'
    ] as const) {
      expect(f.evidence.issue({ ...f.context, [field]: ' ' }).status).toBe('refused')
    }
  })
})
