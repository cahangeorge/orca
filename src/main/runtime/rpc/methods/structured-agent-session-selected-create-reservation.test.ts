import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import { beginCodexModelCatalogProbeContext } from '../../../codex/codex-model-catalog-probe-context'
import {
  AgentModelCatalogStore,
  AGENT_MODEL_CATALOG_FRESH_MS
} from '../../../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprint } from '../../../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import { createInitialSelectionCatalogEvidence } from '../../../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'
import { hostTestState } from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import {
  hostTestAttachParams,
  HOST_TEST_NOW
} from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { reserveRequestFor } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import {
  createNewSelectedCreateReservationAttempt,
  type SelectedCreateHostScope
} from '../../agent-session-selected-first-reservation'

const pair = { model: 'gpt-6.1-sol', effort: 'medium' }
function fixture() {
  const state = hostTestState()
  let at = HOST_TEST_NOW
  let ordinal = 0
  const scope: SelectedCreateHostScope = {
    callerKey: 'client-1',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder' as const
    },
    accountHome: { variable: 'CODEX_HOME' as const, path: '/pinned/account-a' },
    workspacePath: '/workspace/a',
    policyVersion: 'pilot-v1'
  }
  const context = {
    ownerKey: scope.callerKey,
    executionHostId: scope.location.executionHostId,
    workspaceId: scope.location.workspaceId,
    workspacePath: scope.workspacePath,
    policyVersion: scope.policyVersion,
    account: {
      agent: 'codex' as const,
      accountHomeVariable: scope.accountHome.variable,
      accountHomePath: scope.accountHome.path,
      wslDistro: null
    }
  }
  const catalogs = new AgentModelCatalogStore({ now: () => at })
  const fingerprint = agentModelCatalogFingerprint(context.account)
  const success = {
    origin: 'probe' as const,
    fastModeTierByModel: new Map(),
    models: [
      {
        id: pair.model,
        label: 'Sol',
        isDefault: true,
        efforts: [
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' }
        ]
      }
    ]
  }
  beginCodexModelCatalogProbeContext(
    {
      command: '/synthetic/codex',
      cliPath: '/synthetic/codex',
      args: [],
      timeoutMs: 1,
      env: { CODEX_HOME: context.account.accountHomePath }
    },
    context.account.accountHomePath,
    () => ({ status: 'known', key: 'synthetic-reservation-account-a' })
  )(success)
  catalogs.recordSuccess(fingerprint, 'codex', success)
  const evidence = createInitialSelectionCatalogEvidence({ store: catalogs, now: () => at })
  const issued = evidence.issue(context)
  if (issued.status !== 'ready') {
    throw new Error('catalog fixture unavailable')
  }
  const mint = vi.fn(() => 'new-spawn')
  const args = {
    store: state.store,
    evidence,
    catalogRef: issued.catalogRef,
    selection: { ...pair },
    readHostScope: vi.fn(() => scope),
    seedOptions: { fastMode: 'true', model: 'saved' },
    authority: {
      spawnToken: mint,
      claimKeyId: 'key-1',
      handoffOperationId: null,
      probe: { outcome: 'reservation-unused' as const }
    },
    now: () => at,
    randomUuid: () => `00000000-0000-4000-8000-${(++ordinal).toString().padStart(12, '0')}`
  }
  return {
    ...state,
    at: () => at,
    setTime: (value: number) => {
      at = value
    },
    scope,
    args,
    mint,
    catalogs,
    fingerprint,
    success
  }
}
function request(now = HOST_TEST_NOW) {
  const params = hostTestAttachParams(null)
  return reserveRequestFor({
    sessionId: params.envelope.sessionId,
    params,
    callerKey: 'client-1',
    fingerprint: params.envelope.payloadFingerprint,
    now,
    authority: {
      spawnToken: vi.fn(() => 'legacy'),
      claimKeyId: 'key-1',
      handoffOperationId: params.envelope.clientOperationId,
      probe: { outcome: 'reservation-unused' }
    }
  })
}
const admission = (at = HOST_TEST_NOW) => ({
  now: () => at,
  validate: vi.fn((): undefined => undefined)
})

describe('selected first reservation at the transaction boundary', () => {
  it('pins approved options and host scope before any acquire or dispatch', async () => {
    const f = fixture()
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    const result = await attempt.reserve()
    expect(result.disposition).toBe('created')
    expect(result.record.sessionId).toBe(attempt.sessionId)
    expect(result.record.options).toEqual({ fastMode: 'true', ...pair })
    expect(result.record.accountHome).toEqual(f.scope.accountHome)
    expect(result.record.location).toEqual(f.scope.location)
    expect(result.operationRow.operationId).toBe(attempt.operationId)
    expect(f.mint).toHaveBeenCalledOnce()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })
  it.each(['clock', 'catalog', 'caller', 'account', 'workspace', 'path', 'policy'] as const)(
    'rejects queued %s drift before token or durable state',
    async (drift) => {
      const f = fixture()
      const attempt = createNewSelectedCreateReservationAttempt(f.args)
      const reserved = attempt.reserve()
      if (drift === 'clock') {
        f.setTime(f.at() + AGENT_MODEL_CATALOG_FRESH_MS)
      }
      if (drift === 'catalog') {
        f.catalogs.recordSuccess(f.fingerprint, 'codex', f.success)
      }
      if (drift === 'caller') {
        f.scope.callerKey = 'client-other'
      }
      if (drift === 'account') {
        f.scope.accountHome.path = '/changed/account'
      }
      if (drift === 'workspace') {
        f.scope.location.workspaceId = 'workspace-other'
      }
      if (drift === 'path') {
        f.scope.workspacePath = '/changed/workspace'
      }
      if (drift === 'policy') {
        f.scope.policyVersion = 'pilot-v2'
      }
      await expect(reserved).rejects.toThrow('agent_session_operation_unknown')
      expect(f.mint).not.toHaveBeenCalled()
      expect(f.store.listRecords()).toHaveLength(0)
      expect(f.store.listOperationRows()).toHaveLength(0)
      expect(f.acquire).not.toHaveBeenCalled()
    }
  )
  it('copies selection and seed options before caller edits', async () => {
    const f = fixture()
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    f.args.selection.model = 'edited'
    f.args.seedOptions.fastMode = 'false'
    const result = await attempt.reserve()
    expect(result.record.options).toEqual({ fastMode: 'true', ...pair })
  })
  it('refuses second use of a ticket without replay, new IDs or another token', async () => {
    const f = fixture()
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    await attempt.reserve()
    const path = join(f.root, 'store', 'agent-sessions.json')
    const before = await readFile(path)
    await expect(attempt.reserve()).rejects.toThrow('agent_session_operation_unknown')
    expect(await readFile(path)).toEqual(before)
    expect(f.mint).toHaveBeenCalledOnce()
    expect(f.store.listRecords()).toHaveLength(1)
    expect(f.store.listOperationRows()).toHaveLength(1)
  })
  it('has one concurrent winner for a single ticket', async () => {
    const f = fixture()
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    const outcomes = await Promise.allSettled([attempt.reserve(), attempt.reserve()])
    expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((v) => v.status === 'rejected')).toHaveLength(1)
    expect(f.mint).toHaveBeenCalledOnce()
  })
  it.each(['remote', 'wsl', 'account', 'path', 'policy', 'caller', 'selection'] as const)(
    'refuses invalid host %s scope',
    async (invalid) => {
      const f = fixture()
      if (invalid === 'remote') {
        f.scope.location.executionHostId = 'ssh:host'
      }
      if (invalid === 'wsl') {
        f.args.readHostScope.mockReturnValue({
          ...f.scope,
          location: { ...f.scope.location, wslDistro: 'Ubuntu' }
        })
      }
      if (invalid === 'account') {
        f.scope.accountHome.path = ''
      }
      if (invalid === 'path') {
        f.scope.workspacePath = ''
      }
      if (invalid === 'policy') {
        f.scope.policyVersion = ''
      }
      if (invalid === 'caller') {
        f.scope.callerKey = ''
      }
      if (invalid === 'selection') {
        f.args.selection.effort = 'unsupported'
      }
      await expect(async () =>
        createNewSelectedCreateReservationAttempt(f.args).reserve()
      ).rejects.toThrow('agent_session_operation_unknown')
      expect(f.mint).not.toHaveBeenCalled()
      expect(f.store.listRecords()).toHaveLength(0)
    }
  )
  it('checks backup recovery discovered by refresh, not just initial public metadata', async () => {
    const f = fixture()
    await f.store.reserveOwner(request())
    await f.store.reserveOwner({ ...request(), sessionId: 'other-session' })
    expect(f.store.recoveredFromBackup).toBe(false)
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    const path = join(f.root, 'store', 'agent-sessions.json')
    const valid = await readFile(path)
    await writeFile(path, 'corrupt-primary')
    try {
      await expect(attempt.reserve()).rejects.toThrow('agent_session_operation_unknown')
      expect(await readFile(path, 'utf8')).toBe('corrupt-primary')
      expect(f.mint).not.toHaveBeenCalled()
    } finally {
      await writeFile(path, valid)
    }
  })
  it.each(['pending', 'unknown', 'succeeded', 'failed'] as const)(
    'never resumes a retained %s operation through strict first reservation',
    async (status) => {
      const { store, root } = hostTestState()
      const req = request()
      await store.reserveOwner(req)
      if (status !== 'pending') {
        await store.recordOperationOutcome({
          callerKey: req.operation.callerKey,
          operationId: req.operation.operationId,
          outcome:
            status === 'succeeded'
              ? { status, sessionId: req.sessionId }
              : status === 'failed'
                ? { status, code: 'agent_session_operation_unknown' }
                : { status }
        })
      }
      const reopened = await AgentSessionRecordStore.open({
        directory: join(root, 'store'),
        hostId: 'local'
      })
      await reopened.reconcileOnRestart({
        now: HOST_TEST_NOW + 1,
        probe: async () => ({ outcome: 'indeterminate', reason: 'owned fixture restart' })
      })
      const before = await readFile(join(root, 'store', 'agent-sessions.json'))
      const guard = admission()
      const mint = vi.fn(() => 'second')
      await expect(reopened.reserveOwner({ ...req, spawnToken: mint }, guard)).rejects.toThrow(
        'agent_session_operation_unknown'
      )
      expect(guard.validate).not.toHaveBeenCalled()
      expect(mint).not.toHaveBeenCalled()
      expect(await readFile(join(root, 'store', 'agent-sessions.json'))).toEqual(before)
    }
  )
  it('rejects an aged-out released continuation while legacy behavior stays available', async () => {
    const { store, root } = hostTestState()
    const req = request()
    const first = await store.reserveOwner(req)
    const reopened = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    await reopened.reconcileOnRestart({
      now: HOST_TEST_NOW + 1,
      probe: async () => ({ outcome: 'indeterminate', reason: 'owned fixture restart' })
    })
    const guard = admission(first.operationRow.expiresAt)
    const mint = vi.fn(() => 'second')
    await expect(reopened.reserveOwner({ ...req, spawnToken: mint }, guard)).rejects.toThrow(
      'agent_session_operation_expired'
    )
    expect(mint).not.toHaveBeenCalled()
    expect(guard.validate).not.toHaveBeenCalled()
  })
  it('rejects a new operation for an existing released session before token mint', async () => {
    const { store, root } = hostTestState()
    const req = request()
    await store.reserveOwner(req)
    const reopened = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    await reopened.reconcileOnRestart({
      now: HOST_TEST_NOW + 1,
      probe: async () => ({ outcome: 'indeterminate', reason: 'owned fixture restart' })
    })
    const mint = vi.fn(() => 'second')
    await expect(
      reopened.reserveOwner(
        { ...request(), sessionId: req.sessionId, spawnToken: mint },
        admission()
      )
    ).rejects.toThrow('agent_session_operation_unknown')
    expect(mint).not.toHaveBeenCalled()
  })
  it('refuses an unreadable record even when its operation row is absent', async () => {
    const { store, root } = hostTestState()
    const req = request()
    await store.reserveOwner(req)
    const path = join(root, 'store', 'agent-sessions.json')
    const text = await readFile(path, 'utf8')
    const corrupt = text.replace(
      /"journalCheckpoint":\s*null/u,
      '"journalCheckpoint":{"epoch":"bad","sequence":1}'
    )
    expect(corrupt).not.toBe(text)
    await writeFile(path, corrupt)
    const reopened = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    expect(reopened.isSessionUnreadable(req.sessionId)).toBe(true)
    const normalized = await readFile(path, 'utf8')
    const guard = admission()
    const mint = vi.fn(() => 'unexpected')
    await expect(reopened.reserveOwner({ ...request(), spawnToken: mint }, guard)).rejects.toThrow(
      'agent_session_operation_unknown'
    )
    expect(guard.validate).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
    expect(await readFile(path, 'utf8')).toBe(normalized)
  })
  it.each([Number.NaN, Infinity, -1])('rejects invalid transaction clock %s', async (clock) => {
    const { store } = hostTestState()
    const req = request()
    const guard = admission(clock)
    const mint = vi.fn(() => 'unexpected')
    await expect(store.reserveOwner({ ...req, spawnToken: mint }, guard)).rejects.toThrow(
      'agent_session_operation_unknown'
    )
    expect(mint).not.toHaveBeenCalled()
    expect(guard.validate).not.toHaveBeenCalled()
    expect(store.listRecords()).toHaveLength(0)
    expect(store.listOperationRows()).toHaveLength(0)
  })
  it('does not turn a catalog process restart into a fresh grant', async () => {
    const f = fixture()
    f.args.evidence = createInitialSelectionCatalogEvidence({ store: f.catalogs, now: f.at })
    const attempt = createNewSelectedCreateReservationAttempt(f.args)
    await expect(attempt.reserve()).rejects.toThrow('agent_session_operation_unknown')
    await expect(attempt.reserve()).rejects.toThrow('agent_session_operation_unknown')
    expect(f.mint).not.toHaveBeenCalled()
    expect(f.store.listRecords()).toHaveLength(0)
  })
  it('rolls back a throwing admission without token or operation effects', async () => {
    const { store, root } = hostTestState()
    await store.reserveOwner(request())
    const path = join(root, 'store', 'agent-sessions.json')
    const before = await readFile(path)
    const req = { ...request(), sessionId: 'other-session' }
    const mint = vi.fn(() => 'unexpected')
    const guard = {
      now: () => HOST_TEST_NOW,
      validate: (): undefined => {
        throw new Error('reject in transaction')
      }
    }
    await expect(store.reserveOwner({ ...req, spawnToken: mint }, guard)).rejects.toThrow(
      'reject in transaction'
    )
    expect(mint).not.toHaveBeenCalled()
    expect(await readFile(path)).toEqual(before)
    expect(store.listRecords()).toHaveLength(1)
    expect(store.listOperationRows()).toHaveLength(1)
  })
  it('preserves changed-fingerprint conflicts before validation', async () => {
    const { store } = hostTestState()
    const req = request()
    await store.reserveOwner(req)
    const guard = admission()
    await expect(
      store.reserveOwner(
        { ...req, operation: { ...req.operation, fingerprint: 'f'.repeat(64) } },
        guard
      )
    ).rejects.toThrow('agent_session_operation_conflict')
    expect(guard.validate).not.toHaveBeenCalled()
  })
})
