import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import {
  journalDatabaseFile,
  journalDirectoryFor
} from '../../../native-chat/agent-session-journal/journal-paths'
import Database from '../../../sqlite/sync-database'
import { journals } from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import { journalIdentityFor } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import { readAgentSessionHydrationPage } from '../../../native-chat/agent-session-wire/agent-session-history-page'
import {
  RECOVERY_CALLER,
  RECOVERY_NOW,
  commitSelectedCreate,
  reserveSelectedCreate,
  recoveryStoreView
} from './structured-agent-session-selected-create-recovery-fixture'
import { resolveSelectedStructuredCreateReplay } from './structured-agent-session-selected-create-replay'

function replay(
  f: Awaited<ReturnType<typeof commitSelectedCreate>>,
  overrides: Partial<Parameters<typeof resolveSelectedStructuredCreateReplay>[0]> = {}
) {
  return resolveSelectedStructuredCreateReplay({
    store: f.store,
    request: f.request,
    callerKey: RECOVERY_CALLER,
    expectedLocation: f.record.location,
    now: RECOVERY_NOW,
    journalRoot: f.root,
    readQuiescence: () => true,
    ...overrides
  })
}
function readableStoreView(
  store: Parameters<typeof recoveryStoreView>[0],
  overrides: Parameters<typeof recoveryStoreView>[1] = {}
) {
  return recoveryStoreView(store, {
    isSessionUnreadable: (id) => store.isSessionUnreadable(id),
    ...overrides
  })
}

function evidence(f: Awaited<ReturnType<typeof commitSelectedCreate>>) {
  const dir = journalDirectoryFor(f.root, {
    sessionId: f.record.sessionId,
    workspaceId: f.record.location.workspaceId
  })
  const files = [
    ...readdirSync(dir).map((name) => join(dir, name)),
    join(f.root, 'store', 'agent-sessions.json')
  ]
  return Object.fromEntries(
    files
      .sort()
      .map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])
  )
}
function journalDir(f: Awaited<ReturnType<typeof commitSelectedCreate>>) {
  return journalDirectoryFor(f.root, {
    sessionId: f.record.sessionId,
    workspaceId: f.record.location.workspaceId
  })
}
describe('internal retained selected-create replay', () => {
  it.each(['folder', 'git-worktree'] as const)(
    'returns retained wire hydration for %s without a new acquisition or durable write',
    async (kind) => {
      const f = await commitSelectedCreate(kind)
      const before = evidence(f)
      const reserve = vi.spyOn(f.store, 'reserveOwner')
      const attach = vi.spyOn(f.host, 'attach')
      const result = replay(f)
      expect(result).toMatchObject({
        decision: 'replay',
        result: {
          ok: true,
          replayed: true,
          fence: f.record.lease.runtimeFence,
          value: {
            sessionId: f.record.sessionId,
            fence: f.record.lease.runtimeFence,
            page: { direction: 'tail' },
            unconfirmedClientMessageIds: []
          }
        }
      })
      expect(evidence(f)).toEqual(before)
      expect(reserve).not.toHaveBeenCalled()
      expect(attach).not.toHaveBeenCalled()
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )
  it('replays a recorded failed refusal without checking/opening journal', async () => {
    const f = await commitSelectedCreate()
    await f.store.recordOperationOutcome({
      callerKey: RECOVERY_CALLER,
      operationId: f.row.operationId,
      outcome: {
        status: 'failed',
        code: 'agent_session_operation_invalid',
        details: { reason: 'operationRefusedEarlier' },
        message: 'Saved refusal'
      }
    })
    const readQuiescence = vi.fn(() => {
      throw new Error('must not read journal')
    })
    expect(replay(f, { journalRoot: '/missing', readQuiescence })).toMatchObject({
      decision: 'replay',
      result: {
        ok: false,
        refusal: { code: 'agent_session_operation_invalid', message: 'Saved refusal' }
      }
    })
    expect(readQuiescence).not.toHaveBeenCalled()
    expect(f.acquire).toHaveBeenCalledOnce()
  })
  it('preserves unknown for pending operation without journal access', async () => {
    const f = await reserveSelectedCreate()
    const readQuiescence = vi.fn(() => true)
    expect(replay(f, { readQuiescence }).decision).toBe('unknown')
    expect(readQuiescence).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'expired', 'missing-journal', 'no-quiescence'] as const)(
    'does not rerun %s evidence',
    async (scenario) => {
      const f = await commitSelectedCreate()
      expect(
        replay(f, {
          ...(scenario === 'unknown'
            ? {
                store: readableStoreView(f.store, {
                  getOperationRow: () => ({ ...f.row, outcome: { status: 'unknown' } })
                })
              }
            : {}),
          ...(scenario === 'expired' ? { now: f.row.expiresAt } : {}),
          ...(scenario === 'missing-journal' ? { journalRoot: join(f.root, 'absent') } : {}),
          ...(scenario === 'no-quiescence' ? { readQuiescence: () => false } : {})
        }).decision
      ).toBe('unknown')
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )
  it('reads restarted-unreconciled record without granting or changing it', async () => {
    const f = await commitSelectedCreate()
    const reopened = await AgentSessionRecordStore.open({
      directory: join(f.root, 'store'),
      hostId: 'local'
    })
    expect(reopened.getRecord(f.record.sessionId)?.lease.unreconciled).toBe(true)
    const before = evidence(f)
    expect(replay(f, { store: reopened }).decision).toBe('replay')
    expect(evidence(f)).toEqual(before)
    expect(reopened.getRecord(f.record.sessionId)?.lease.unreconciled).toBe(true)
    expect(f.acquire).toHaveBeenCalledOnce()
  })
  it('rejects different current host/WSL scope and selection', async () => {
    const f = await commitSelectedCreate()
    expect(
      replay(f, { expectedLocation: { ...f.record.location, executionHostId: 'ssh:test' } })
        .decision
    ).toBe('unknown')
    expect(
      replay(f, { expectedLocation: { ...f.record.location, wslDistro: 'Ubuntu' } }).decision
    ).toBe('unknown')
    expect(
      replay(f, { request: { ...f.request, initialOptions: { model: 'other', effort: 'low' } } })
        .decision
    ).toBe('conflict')
  })
  it('rejects record drift during retained read', async () => {
    const f = await commitSelectedCreate()
    let calls = 0
    const store = readableStoreView(f.store, {
      getRecord: (id) => {
        const record = f.store.getRecord(id)
        if (record && ++calls >= 3) {
          return { ...record, options: { model: 'changed' } }
        }
        return record
      }
    })
    expect(replay(f, { store }).decision).toBe('unknown')
    expect(f.acquire).toHaveBeenCalledOnce()
  })
  it('rejects provider handle mismatch in retained journal', async () => {
    const f = await commitSelectedCreate()
    const db = new Database(journalDatabaseFile(journalDir(f)))
    try {
      db.prepare(
        "UPDATE journal_rows SET row_json = json_set(row_json, '$.providerHandle.threadId', 'other') WHERE seq = 1"
      ).run()
    } finally {
      db.close()
    }
    const before = evidence(f)
    expect(replay(f).decision).toBe('unknown')
    expect(evidence(f)).toEqual(before)
  })
  it('reuses bounded hydration and preserves unknown delivery evidence without reconciling it', async () => {
    const f = await commitSelectedCreate()
    const fence = f.record.lease.runtimeFence
    const journal = await journals.open({
      identity: journalIdentityFor(f.record, f.prepared.attachParams),
      journalDir: journalDir(f)
    })
    await journal.appendSubmission({
      clientMessageId: 'unconfirmed-1',
      payloadFingerprint: 'a'.repeat(64),
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'pending delivery' }] },
      fence
    })
    await journal.resolveDispatch({
      clientMessageId: 'unconfirmed-1',
      fence,
      state: 'unknown',
      recovered: true
    })
    for (let ordinal = 0; ordinal < 205; ordinal++) {
      await journal.appendItem(
        {
          provider: 'codex',
          threadId: '019fd532-7c11-7a90-b6de-4e1a2c3d5f60',
          turnId: 'turn-1',
          ordinal
        },
        { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: `item ${ordinal}` }] },
        { fence }
      )
    }
    const expected = readAgentSessionHydrationPage(journal, fence)
    const before = evidence(f)
    const result = replay(f)
    if (result.decision !== 'replay' || !result.result.ok) {
      throw new Error('expected retained replay')
    }
    expect(result.result.value.page).toEqual(expected)
    expect(result.result.value.page.hasOlder).toBe(true)
    expect(result.result.value.unconfirmedClientMessageIds).toEqual(['unconfirmed-1'])
    expect(evidence(f)).toEqual(before)
    expect(f.acquire).toHaveBeenCalledOnce()
    expect(f.dispatch).not.toHaveBeenCalled()
  })
  it('replays a released durable owner using its current fence without reacquiring', async () => {
    const f = await commitSelectedCreate()
    const released = await f.store.evictProvenDeadOwner({
      sessionId: f.record.sessionId,
      expectedFence: f.record.lease.runtimeFence,
      probe: { outcome: 'pid-absent' },
      now: RECOVERY_NOW + 1
    })
    expect(released.lease.claimStatus).toBe('released')
    const before = evidence(f)
    const result = replay(f)
    expect(result).toMatchObject({
      decision: 'replay',
      result: { ok: true, fence: released.lease.runtimeFence }
    })
    expect(evidence(f)).toEqual(before)
    expect(f.acquire).toHaveBeenCalledOnce()
    expect(f.dispatch).not.toHaveBeenCalled()
  })
  it('preserves original selection proof after mutable option changes', async () => {
    const f = await commitSelectedCreate()
    await f.store.replaceSessionOptions({
      sessionId: f.record.sessionId,
      fence: f.record.lease.runtimeFence,
      options: { model: 'later-model', effort: 'low' },
      now: RECOVERY_NOW + 1
    })
    const before = evidence(f)
    expect(replay(f).decision).toBe('replay')
    expect(evidence(f)).toEqual(before)
  })
  it('refuses changed ledger readback without rerunning', async () => {
    const f = await commitSelectedCreate()
    let calls = 0
    const store = readableStoreView(f.store, {
      getOperationRow: () => (++calls >= 3 ? null : f.row)
    })
    expect(replay(f, { store }).decision).toBe('unknown')
    expect(f.acquire).toHaveBeenCalledOnce()
  })
  it.each(['succeeded', 'failed'] as const)(
    'refuses same-outcome changed ledger fingerprint before %s replay',
    async (status) => {
      const f = await commitSelectedCreate()
      expect(replay(f, { store: readableStoreView(f.store) }).decision).toBe('replay')
      const row: typeof f.row = {
        ...f.row,
        outcome:
          status === 'succeeded'
            ? f.row.outcome
            : {
                status: 'failed',
                code: 'agent_session_operation_invalid',
                details: { reason: 'operationRefusedEarlier' }
              }
      }
      let calls = 0
      const store = readableStoreView(f.store, {
        getOperationRow: () =>
          ++calls === 1
            ? row
            : { ...row, fingerprint: 'b'.repeat(64), expiresAt: row.expiresAt + 1000 }
      })
      const readQuiescence = vi.fn(() => true)
      expect(replay(f, { store, readQuiescence }).decision).toBe('unknown')
      expect(readQuiescence).not.toHaveBeenCalled()
      expect(f.acquire).toHaveBeenCalledOnce()
    }
  )
})
