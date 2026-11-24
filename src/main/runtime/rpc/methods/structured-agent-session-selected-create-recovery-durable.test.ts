import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import { agentSessionLeaseIsReleased } from '../../../../shared/agent-session-lease-adjudication'
import { pinnedAgentSessionLaunchEnv } from '../../../native-chat/agent-session-wire/structured-agent-session-launch-env'
import { createCodexStructuredLaunchResolver } from '../../../codex/codex-structured-launch-resolution'
import { createCodexModelCatalogProbe } from '../../../codex/codex-model-catalog-probe'
import { createInitialSelectionCatalogEvidence } from '../../../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'
import { agentModelCatalogFingerprint } from '../../../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import {
  AGENT_MODEL_CATALOG_FRESH_MS,
  AgentModelCatalogStore
} from '../../../native-chat/agent-model-catalog/agent-model-catalog-store'
import {
  commitSelectedCreate,
  reserveSelectedCreate,
  recoveryStoreView,
  RECOVERY_CALLER,
  RECOVERY_NOW,
  RECOVERY_PAIR
} from './structured-agent-session-selected-create-recovery-fixture'
import { resolveSelectedStructuredCreateRecovery } from './structured-agent-session-selected-create-recovery'

describe('selected create recovery across durable and catalog boundaries', () => {
  it.each(['account-switch', 'expired-catalog', 'model-withdrawn', 'lost-reference'] as const)(
    'retains original settlement when fresh-create evidence is unavailable: %s',
    async (scenario) => {
      const f = await commitSelectedCreate()
      const now =
        scenario === 'expired-catalog'
          ? RECOVERY_NOW + AGENT_MODEL_CATALOG_FRESH_MS
          : RECOVERY_NOW + 1
      let at = RECOVERY_NOW
      const catalog = new AgentModelCatalogStore({ now: () => at })
      const context = {
        ownerKey: RECOVERY_CALLER,
        executionHostId: 'local',
        workspaceId: 'workspace-1',
        workspacePath: '/workspace',
        policyVersion: 'pilot-v1',
        account: {
          agent: 'codex' as const,
          accountHomeVariable: 'CODEX_HOME',
          accountHomePath: f.record.accountHome.path,
          wslDistro: null
        }
      }
      const fp = agentModelCatalogFingerprint(context.account)
      const initialCatalog = await createCodexModelCatalogProbe({
        resolveCommand: () => '/synthetic/codex',
        resolveEnvironment: async () => ({}),
        readCurrentContext: () => ({ status: 'known', key: 'synthetic-recovery-account-a' }),
        runSession: async (_invocation, body) =>
          body({
            request: async () => ({
              data: [
                {
                  model: RECOVERY_PAIR.model,
                  displayName: 'Sol',
                  isDefault: true,
                  supportedReasoningEfforts: [{ reasoningEffort: RECOVERY_PAIR.effort }]
                }
              ],
              nextCursor: null
            }),
            notify: () => {}
          })
      })(context.account.accountHomePath)
      catalog.recordSuccess(fp, 'codex', initialCatalog)
      const evidence = createInitialSelectionCatalogEvidence({
        store: catalog,
        now: () => at
      })
      const issued = evidence.issue(context)
      if (issued.status !== 'ready') {
        throw new Error('fixture requires catalog evidence')
      }
      at = now
      if (scenario === 'account-switch') {
        context.account.accountHomePath = '/current/account-b'
      }
      if (scenario === 'model-withdrawn') {
        catalog.recordSuccess(fp, 'codex', {
          origin: 'probe',
          fastModeTierByModel: new Map(),
          models: [
            {
              id: 'other-model',
              label: 'Other',
              isDefault: true,
              efforts: [{ value: 'medium', label: 'Medium' }]
            }
          ]
        })
      }
      const currentEvidence =
        scenario === 'lost-reference'
          ? createInitialSelectionCatalogEvidence({ store: catalog, now: () => now })
          : evidence
      expect(
        currentEvidence.validateNewCreate({
          context,
          catalogRef: issued.catalogRef,
          selection: RECOVERY_PAIR
        }).status
      ).not.toBe('validated')
      const before = await readFile(join(f.root, 'store', 'agent-sessions.json'))
      const recovered = resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now
      })
      expect(recovered).toMatchObject({
        decision: 'settled',
        pinned: {
          accountHome: { path: '/pinned/account-a' },
          initialOptions: RECOVERY_PAIR,
          options: { fastMode: 'true' }
        }
      })
      expect(await readFile(join(f.root, 'store', 'agent-sessions.json'))).toEqual(before)
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )

  it('recovers the succeeded identity after reopening without granting the unreconciled lease', async () => {
    const f = await commitSelectedCreate()
    const reopened = await AgentSessionRecordStore.open({
      directory: join(f.root, 'store'),
      hostId: 'local'
    })
    expect(reopened.getRecord(f.record.sessionId)?.lease.unreconciled).toBe(true)
    const before = await readFile(join(f.root, 'store', 'agent-sessions.json'))
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: reopened,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW + 1
      })
    ).toMatchObject({
      decision: 'settled',
      outcome: { status: 'succeeded' },
      pinned: { initialOptions: RECOVERY_PAIR }
    })
    expect(reopened.getRecord(f.record.sessionId)?.lease.unreconciled).toBe(true)
    expect(await readFile(join(f.root, 'store', 'agent-sessions.json'))).toEqual(before)
    expect(f.acquire).toHaveBeenCalledOnce()
  })

  it('uses the actual launch resolver to read pinned account/model/Fast inputs from the record', async () => {
    const f = await commitSelectedCreate()
    const resolveRollout = vi.fn(async (accountHomePath: string) =>
      join(accountHomePath, 'rollout.jsonl')
    )
    const launch = await createCodexStructuredLaunchResolver({
      store: f.store,
      resolveCommand: () => 'mock-codex',
      resolveWorkspacePath: async () => '/workspace',
      resolveRollout,
      resolveEnvironment: async () => ({ CODEX_HOME: '/changed/environment-home' })
    })({
      identity: {
        sessionId: f.record.sessionId,
        workspaceId: 'workspace-1',
        hostId: 'local',
        agent: 'codex',
        providerHandle: { kind: 'opaque', agent: 'codex', value: 'ignored' }
      }
    })
    expect(launch.codexHome).toBe('/pinned/account-a')
    expect(launch.model).toBe(RECOVERY_PAIR.model)
    expect(resolveRollout.mock.calls[0]?.[0]).toBe('/pinned/account-a')
    expect(
      await pinnedAgentSessionLaunchEnv(
        () => ({ CODEX_HOME: '/changed/environment-home' }),
        f.prepared.attachParams
      )
    ).toEqual({ launchEnv: { CODEX_HOME: '/pinned/account-a' } })
    expect(f.store.getRecord(f.record.sessionId)?.options?.fastMode).toBe('true')
    expect(f.acquire).toHaveBeenCalledOnce()
  })

  it('returns UNKNOWN at the expiry boundary even while the row remains in memory', async () => {
    const f = await commitSelectedCreate()
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: f.row.expiresAt - 1
      }).decision
    ).toBe('settled')
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: f.row.expiresAt
      }).decision
    ).toBe('unknown')
    expect(f.acquire).toHaveBeenCalledOnce()
  })

  it('keeps a pruned operation UNKNOWN after restart even for a released unused reservation', async () => {
    const f = await reserveSelectedCreate()
    const reopened = await AgentSessionRecordStore.open({
      directory: join(f.root, 'store'),
      hostId: 'local'
    })
    await reopened.reconcileOnRestart({
      now: RECOVERY_NOW + 1,
      probe: async () => ({ outcome: 'indeterminate', reason: 'synthetic restart' })
    })
    expect(agentSessionLeaseIsReleased(reopened.getRecord(f.record.sessionId)!.lease)).toBe(true)
    const at = f.row.expiresAt
    await reopened.admitOperation({
      callerKey: 'prune-fixture',
      operationId: `${at}-00000000000000000000000000000002`,
      fingerprint: 'a'.repeat(64),
      now: at
    })
    expect(reopened.getOperationRow(RECOVERY_CALLER, f.row.operationId)).toBeNull()
    const before = await readFile(join(f.root, 'store', 'agent-sessions.json'))
    const secondReopen = await AgentSessionRecordStore.open({
      directory: join(f.root, 'store'),
      hostId: 'local'
    })
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: secondReopen,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: at
      }).decision
    ).toBe('unknown')
    expect(await readFile(join(f.root, 'store', 'agent-sessions.json'))).toEqual(before)
    expect(secondReopen.listRecords()).toHaveLength(1)
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    'missing-row',
    'missing-record',
    'unreadable',
    'backup',
    'read-only',
    'read-error'
  ] as const)(
    'does not downgrade missing/untrusted durable evidence into a new create: %s',
    async (scenario) => {
      const f = await commitSelectedCreate()
      const store = recoveryStoreView(f.store, {
        ...(scenario === 'missing-row' ? { getOperationRow: () => null } : {}),
        ...(scenario === 'missing-record' ? { getRecord: () => null } : {}),
        ...(scenario === 'unreadable' ? { isSessionUnreadable: () => true } : {}),
        ...(scenario === 'backup' ? { recoveredFromBackup: true } : {}),
        ...(scenario === 'read-only' ? { readOnly: true } : {}),
        ...(scenario === 'read-error'
          ? {
              getRecord: () => {
                throw new Error('private details')
              }
            }
          : {})
      })
      const recovered = resolveSelectedStructuredCreateRecovery({
        store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW
      })
      expect(recovered.decision).toBe('unknown')
      expect(JSON.stringify(recovered)).not.toContain('private details')
      expect(f.acquire).toHaveBeenCalledOnce()
    }
  )

  it('does not reconstruct a success row naming a different session', async () => {
    const f = await commitSelectedCreate()
    await f.store.recordOperationOutcome({
      callerKey: RECOVERY_CALLER,
      operationId: f.row.operationId,
      outcome: { status: 'succeeded', sessionId: 'another-session' }
    })
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW
      }).decision
    ).toBe('unknown')
  })

  it('preserves UNKNOWN for a real store recovered from its older backup', async () => {
    const f = await commitSelectedCreate()
    const primary = join(f.root, 'store', 'agent-sessions.json')
    const original = await readFile(primary)
    try {
      await writeFile(primary, '{broken-primary', 'utf8')
      const backup = await AgentSessionRecordStore.open({
        directory: join(f.root, 'store'),
        hostId: 'local'
      })
      expect(backup.recoveredFromBackup).toBe(true)
      expect(
        resolveSelectedStructuredCreateRecovery({
          store: backup,
          request: f.request,
          callerKey: RECOVERY_CALLER,
          expectedLocation: f.record.location,
          now: RECOVERY_NOW
        }).decision
      ).toBe('unknown')
      expect(f.acquire).toHaveBeenCalledOnce()
    } finally {
      // The mock host still owns this store and must flush against its original committed bytes.
      await writeFile(primary, original)
    }
  })
})
