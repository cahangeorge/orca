import { describe, expect, it } from 'vitest'
import { createCodexModelCatalogProbe } from './codex-model-catalog-probe'
import {
  beginCodexModelCatalogProbeContext,
  type CodexModelCatalogProbeContextReader
} from './codex-model-catalog-probe-context'
import {
  AgentModelCatalogStore,
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS
} from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprint } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import {
  createInitialSelectionCatalogEvidence,
  type InitialSelectionCatalogContext
} from '../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'

const context: InitialSelectionCatalogContext = {
  ownerKey: 'owner',
  executionHostId: 'host',
  workspaceId: 'workspace',
  workspacePath: '/workspace',
  policyVersion: 'v1',
  account: {
    agent: 'codex',
    accountHomeVariable: 'CODEX_HOME',
    accountHomePath: '/synthetic/account',
    wslDistro: null
  }
}
const row = {
  model: 'sol',
  displayName: 'Sol',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
  isDefault: true
}

async function fixture(
  options: { reader?: CodexModelCatalogProbeContextReader; duringRun?: () => void } = {}
) {
  let key = 'synthetic-current-launch-and-account-generation-1'
  let at = 1_000
  const reader: CodexModelCatalogProbeContextReader =
    options.reader ??
    ((pinned) => {
      expect(pinned.accountHomePath).toBe(context.account.accountHomePath)
      expect(pinned.invocation.env?.CODEX_HOME).toBe(pinned.accountHomePath)
      expect(Object.isFrozen(pinned)).toBe(true)
      expect(Object.isFrozen(pinned.invocation)).toBe(true)
      expect(Object.isFrozen(pinned.invocation.args)).toBe(true)
      expect(Object.isFrozen(pinned.invocation.env)).toBe(true)
      return { status: 'known', key }
    })
  const store = new AgentModelCatalogStore({ now: () => at })
  const fingerprint = agentModelCatalogFingerprint(context.account)
  const probe = createCodexModelCatalogProbe({
    resolveCommand: () => '/synthetic/codex',
    resolveEnvironment: async () => ({ PATH: '/synthetic/bin' }),
    readCurrentContext: reader,
    runSession: async (invocation, body) => {
      expect(Object.isFrozen(invocation)).toBe(true)
      options.duringRun?.()
      return body({ request: async () => ({ data: [row], nextCursor: null }), notify: () => {} })
    }
  })
  const success = await probe(context.account.accountHomePath)
  const entry = store.recordSuccess(fingerprint, 'codex', success)!
  const evidence = createInitialSelectionCatalogEvidence({ store, now: () => at })
  return {
    store,
    fingerprint,
    probe,
    success,
    entry,
    evidence,
    setKey: (value: string) => {
      key = value
    },
    setTime: (value: number) => {
      at = value
    },
    validate: (catalogRef: string) =>
      evidence.validateNewCreate({
        context,
        catalogRef,
        selection: { model: 'sol', effort: 'medium' }
      })
  }
}

describe('connected probe continuity selection protocol', () => {
  it('issues and validates actual probe receipts without serializing provenance', async () => {
    const f = await fixture()
    const issued = f.evidence.issue(context)
    expect(issued.status).toBe('ready')
    if (issued.status !== 'ready') {
      throw new Error('expected evidence')
    }
    expect(f.validate(issued.catalogRef).status).toBe('validated')
    const serialized = JSON.stringify([f.success, f.entry, issued])
    expect(serialized).not.toContain('synthetic-current')
    expect(serialized).not.toContain('/synthetic')
    expect(Object.getOwnPropertySymbols(f.entry)).toEqual([])
    expect(Object.keys(f.success)).toEqual(['models', 'fastModeTierByModel', 'origin'])
  })

  it.each([undefined, null, 'known', {}, { status: 'unknown' }, { status: 'known', key: '' }])(
    'refuses malformed/unknown observation %j',
    async (value) => {
      const f = await fixture({ reader: () => value })
      expect(f.evidence.issue(context).status).toBe('refused')
      expect(f.store.hasCurrentProcessLaunchEvidence(f.entry)).toBe(true)
    }
  )

  it('refuses absent production reader while retaining the picker listing', async () => {
    const f = await fixture()
    const unproven = await createCodexModelCatalogProbe({
      resolveCommand: () => '/synthetic/codex',
      resolveEnvironment: async () => ({}),
      runSession: async (_invocation, body) =>
        body({ request: async () => ({ data: [row], nextCursor: null }), notify: () => {} })
    })(context.account.accountHomePath)
    f.store.recordSuccess(f.fingerprint, 'codex', unproven)
    expect(f.evidence.issue(context).status).toBe('refused')
    expect(f.store.get(f.fingerprint)?.models).toHaveLength(1)
  })

  it('refuses throwing and rejected async/thenable readers without unhandled rejection', async () => {
    for (const reader of [
      () => {
        throw new Error('private')
      },
      () => Promise.reject(new Error('private')),
      () => ({
        // oxlint-disable-next-line unicorn/no-thenable -- Intentional adversarial async reader.
        then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('private'))
      })
    ]) {
      const f = await fixture({ reader })
      expect(f.evidence.issue(context).status).toBe('refused')
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  })

  it('latches drift and unknown around the actual run until a new probe', async () => {
    for (const after of [{ status: 'known', key: 'changed' }, { status: 'unknown' }]) {
      let observation: unknown = { status: 'known', key: 'before' }
      let firstRun = true
      const f = await fixture({
        reader: () => observation,
        duringRun: () => {
          if (firstRun) {
            observation = after
          }
          firstRun = false
        }
      })
      observation = { status: 'known', key: 'before' }
      expect(f.evidence.issue(context).status).toBe('refused')
      f.store.recordSuccess(f.fingerprint, 'codex', await f.probe(context.account.accountHomePath))
      expect(f.evidence.issue(context).status).toBe('ready')
    }
  })

  it('revokes after issuance on context drift and cannot revive by replaying the success', async () => {
    const f = await fixture()
    const issued = f.evidence.issue(context)
    if (issued.status !== 'ready') {
      throw new Error('expected evidence')
    }
    f.setKey('changed')
    expect(f.validate(issued.catalogRef).status).toBe('refused')
    f.setKey('synthetic-current-launch-and-account-generation-1')
    f.store.recordSuccess(f.fingerprint, 'codex', f.success)
    expect(f.evidence.issue(context).status).toBe('refused')
    expect(f.validate(issued.catalogRef).status).toBe('unknown')
  })

  it('binds account home and rejects live-session overwrite', async () => {
    const f = await fixture()
    expect(f.store.hasCurrentProbeContextEvidence(f.entry, '/another-account')).toBe(false)
    const success = await f.probe(context.account.accountHomePath)
    f.store.recordSuccess(f.fingerprint, 'codex', { ...success, origin: 'live-session' })
    expect(f.evidence.issue(context).status).toBe('refused')
  })

  it('revokes failed and empty refresh beyond failure TTL', async () => {
    for (const empty of [false, true]) {
      const f = await fixture()
      if (empty) {
        f.store.recordSuccess(f.fingerprint, 'codex', { ...f.success, models: [] })
      } else {
        f.store.recordFailure(f.fingerprint, 'synthetic failure')
      }
      f.setTime(1_001 + AGENT_MODEL_CATALOG_FAILURE_TTL_MS)
      expect(f.evidence.issue(context).status).toBe('refused')
    }
  })

  it.each(['failure', 'replacement', 'eviction'] as const)(
    'refuses synchronous reader reentrant %s',
    async (mutation) => {
      let callback = () => {}
      const f = await fixture({
        reader: () => {
          callback()
          return { status: 'known', key: 'stable' }
        }
      })
      callback = () => {
        callback = () => {}
        if (mutation === 'failure') {
          f.store.recordFailure(f.fingerprint, 'synthetic')
        }
        if (mutation === 'replacement') {
          f.store.recordSuccess(f.fingerprint, 'codex', f.success)
        }
        if (mutation === 'eviction') {
          for (let i = 0; i < 256; i++) {
            f.store.recordSuccess(`other-${i}`, 'codex', { ...f.success })
          }
        }
      }
      expect(f.evidence.issue(context).status).toBe('refused')
    }
  )

  it('does not hydrate private receipts into a restarted store', async () => {
    const f = await fixture()
    const restarted = new AgentModelCatalogStore()
    await restarted.attachPersistence({
      load: async () => [f.entry],
      save: () => {},
      flush: async () => {}
    })
    expect(createInitialSelectionCatalogEvidence({ store: restarted }).issue(context).status).toBe(
      'refused'
    )
  })
})

it('cannot refresh eligibility by replaying a probe success or copying it', async () => {
  const f = await fixture()
  f.setTime(601_000)
  f.store.recordSuccess(f.fingerprint, 'codex', f.success)
  expect(f.evidence.issue(context).status).toBe('refused')
  const proven = await f.probe(context.account.accountHomePath)
  f.store.recordSuccess(f.fingerprint, 'codex', { ...proven })
  expect(f.evidence.issue(context).status).toBe('refused')
  f.store.recordSuccess(f.fingerprint, 'codex', proven)
  expect(f.evidence.issue(context).status).toBe('ready')
})

it('refuses unknown before the probe even when its final observation is known', async () => {
  let value: unknown = { status: 'unknown' }
  const f = await fixture({
    reader: () => value,
    duringRun: () => {
      value = { status: 'known', key: 'stable' }
    }
  })
  expect(f.evidence.issue(context).status).toBe('refused')
})

it('independently binds CODEX_HOME even if a synthetic reader falsely returns an equal key', async () => {
  const f = await fixture()
  const success = { ...f.success }
  beginCodexModelCatalogProbeContext(
    {
      command: '/synthetic/codex',
      cliPath: '/synthetic/codex',
      args: [],
      timeoutMs: 1,
      env: { CODEX_HOME: '/wrong' }
    },
    context.account.accountHomePath,
    () => ({ status: 'known', key: 'synthetic' })
  )(success)
  f.store.recordSuccess(f.fingerprint, 'codex', success)
  expect(f.evidence.issue(context).status).toBe('refused')
})

it('returns UNKNOWN if a synchronous reader evicts the examined reference', async () => {
  let callback = () => {}
  const f = await fixture({
    reader: () => {
      callback()
      return { status: 'known', key: 'stable' }
    }
  })
  const issued = f.evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('expected evidence')
  }
  callback = () => {
    callback = () => {}
    for (let i = 0; i < 256; i++) {
      f.evidence.issue(context)
    }
  }
  expect(f.validate(issued.catalogRef)).toEqual({
    status: 'unknown',
    reason: 'reconciliation-required'
  })
})

it('pins caller context and selection before a synchronous reader callback', async () => {
  let callback = () => {}
  const f = await fixture({
    reader: () => {
      callback()
      return { status: 'known', key: 'stable' }
    }
  })
  const issued = f.evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('expected evidence')
  }
  const callerContext = { ...context, account: { ...context.account } }
  const selection = { model: 'sol', effort: 'medium' }
  callback = () => {
    callerContext.account.accountHomePath = '/changed'
    selection.model = 'changed'
    selection.effort = 'changed'
  }
  expect(
    f.evidence.validateNewCreate({
      context: callerContext,
      catalogRef: issued.catalogRef,
      selection
    })
  ).toEqual({ status: 'validated', initialOptions: { model: 'sol', effort: 'medium' } })
})

it('refuses a receipt revoked by nested account validation during the current read', async () => {
  let callback = () => {}
  const f = await fixture({
    reader: () => {
      callback()
      return { status: 'known', key: 'stable' }
    }
  })
  const issued = f.evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('expected evidence')
  }
  callback = () => {
    callback = () => {}
    expect(f.store.hasCurrentProbeContextEvidence(f.entry, '/wrong-account')).toBe(false)
  }
  expect(f.validate(issued.catalogRef).status).toBe('refused')
  expect(f.store.hasCurrentProbeContextEvidence(f.entry, context.account.accountHomePath)).toBe(
    false
  )
  expect(f.validate(issued.catalogRef).status).toBe('unknown')
})

it('refuses when the continuity callback crosses the catalog freshness boundary', async () => {
  let callback = () => {}
  const f = await fixture({
    reader: () => {
      callback()
      return { status: 'known', key: 'stable' }
    }
  })
  const issued = f.evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('expected evidence')
  }
  callback = () => {
    f.setTime(601_000)
  }
  expect(f.validate(issued.catalogRef).status).toBe('refused')
  expect(f.validate(issued.catalogRef).status).toBe('unknown')
})
