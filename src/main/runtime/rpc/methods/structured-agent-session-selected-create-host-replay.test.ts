import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import {
  journalDirectoryFor,
  journalDatabaseFile
} from '../../../native-chat/agent-session-journal/journal-paths'
import { journalIdentityFor } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import Database from '../../../sqlite/sync-database'
import {
  commitSelectedCreate,
  reserveSelectedCreate,
  RECOVERY_CALLER,
  RECOVERY_NOW
} from './structured-agent-session-selected-create-recovery-fixture'

function replay(
  f: Awaited<ReturnType<typeof commitSelectedCreate>>,
  overrides: Partial<Parameters<typeof f.host.replaySelectedCreate>[0]> = {}
) {
  return f.host.replaySelectedCreate({
    request: f.request,
    callerKey: RECOVERY_CALLER,
    expectedLocation: f.record.location,
    ...overrides
  })
}
function existingJournal(f: Awaited<ReturnType<typeof commitSelectedCreate>>) {
  const journal = f.host.collaboratorsForTests().sessions.get(f.record.sessionId)?.journal
  if (!journal) {
    throw new Error('fixture journal missing')
  }
  return journal
}
function storePath(f: Awaited<ReturnType<typeof commitSelectedCreate>>) {
  return join(f.root, 'store', 'agent-sessions.json')
}
async function bytes(f: Awaited<ReturnType<typeof commitSelectedCreate>>) {
  const dir = journalDirectoryFor(f.root, {
    sessionId: f.record.sessionId,
    workspaceId: f.record.location.workspaceId
  })
  const paths = [
    storePath(f),
    `${storePath(f)}.bak`,
    ...(await readdir(dir))
      .filter((name) => name !== 'journal.db-shm')
      .map((name) => join(dir, name))
  ]
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      ])
    )
  )
}
describe('execution host selected-create retained replay', () => {
  it.each(['folder', 'git-worktree'] as const)(
    'replays %s from owned existing journal without a new grant or publication',
    async (kind) => {
      const f = await commitSelectedCreate(kind)
      const journal = existingJournal(f)
      const before = await bytes(f)
      const reserve = vi.spyOn(f.store, 'reserveOwner')
      const attach = vi.spyOn(f.host, 'attach')
      const open = vi.spyOn(f.host.collaboratorsForTests().conversationDelivery, 'open')
      const committed = vi.fn()
      journal.observeCommits(committed)
      const result = await replay(f)
      expect(result).toMatchObject({
        decision: 'replay',
        result: {
          ok: true,
          replayed: true,
          fence: f.record.lease.runtimeFence,
          value: { sessionId: f.record.sessionId }
        }
      })
      expect(await bytes(f)).toEqual(before)
      expect(reserve).not.toHaveBeenCalled()
      expect(attach).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      expect(committed).not.toHaveBeenCalled()
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )
  it('reads externally updated primary without refreshing or mutating the cached record', async () => {
    const f = await commitSelectedCreate()
    const cached = f.store.getRecord(f.record.sessionId)
    const originalPrimary = await readFile(storePath(f))
    try {
      const other = await AgentSessionRecordStore.open({
        directory: join(f.root, 'store'),
        hostId: 'local'
      })
      await other.replaceSessionOptions({
        sessionId: f.record.sessionId,
        fence: f.record.lease.runtimeFence,
        options: { model: 'external-new', effort: 'low' },
        now: RECOVERY_NOW + 1
      })
      const before = await bytes(f)
      expect(
        await f.store.withFreshRead((view) => view.getRecord(f.record.sessionId)?.options?.model)
      ).toBe('external-new')
      expect(await replay(f)).toMatchObject({ decision: 'replay', result: { ok: true } })
      expect(f.store.getRecord(f.record.sessionId)).toBe(cached)
      expect(cached?.options?.model).not.toBe('external-new')
      expect(await bytes(f)).toEqual(before)
    } finally {
      // The second host persisted its unreconciled lease; restore fixture ownership for teardown.
      await writeFile(storePath(f), originalPrimary)
    }
  })
  it('supplies detached getters whose mutation cannot alter cache or next read', async () => {
    const f = await commitSelectedCreate()
    const before = await bytes(f)
    await f.store.withFreshRead((view) => {
      const record = view.getRecord(f.record.sessionId)
      const row = view.getOperationRow(RECOVERY_CALLER, f.row.operationId)
      if (!record || !row) {
        throw new Error('missing fixture')
      }
      record.options = { model: 'mutated' }
      row.fingerprint = 'b'.repeat(64)
      expect(view.getRecord(f.record.sessionId)?.options?.model).not.toBe('mutated')
      expect(view.getOperationRow(RECOVERY_CALLER, f.row.operationId)?.fingerprint).toBe(
        f.row.fingerprint
      )
    })
    expect(await bytes(f)).toEqual(before)
    expect(f.store.getRecord(f.record.sessionId)?.options?.model).not.toBe('mutated')
  })
  it.each(['corrupt-primary', 'future-schema', 'unreadable-record', 'wrong-host'] as const)(
    'refuses %s without restoring/rewriting/refencing the primary',
    async (scenario) => {
      const f = await commitSelectedCreate()
      const path = storePath(f)
      const original = await readFile(path)
      const state = JSON.parse(original.toString('utf8'))
      if (scenario === 'future-schema') {
        state.schemaVersion += 10
      }
      if (scenario === 'wrong-host') {
        state.hostId = 'ssh:other'
      }
      if (scenario === 'unreadable-record') {
        state.records[f.record.sessionId].accountHome.path = ''
      }
      await writeFile(path, scenario === 'corrupt-primary' ? '{corrupt' : JSON.stringify(state))
      try {
        const before = await bytes(f)
        const cached = f.store.getRecord(f.record.sessionId)
        expect((await replay(f)).decision).toBe('unknown')
        expect(await bytes(f)).toEqual(before)
        expect(f.store.getRecord(f.record.sessionId)).toBe(cached)
      } finally {
        await writeFile(path, original)
      }
    }
  )
  it('samples expiry after waiting for store serialization', async () => {
    const f = await commitSelectedCreate()
    let at = RECOVERY_NOW
    f.host.deps.now = () => at
    let enter!: () => void
    let unblock!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const held = f.store.withFreshRead(async () => {
      enter()
      await blocked
    })
    await entered
    const result = replay(f)
    at = f.row.expiresAt
    unblock()
    await held
    expect((await result).decision).toBe('unknown')
    expect(f.acquire).toHaveBeenCalledOnce()
  })
  it.each(['expiry', 'invalid', 'rollback'] as const)(
    'refuses clock %s after waiting for journal',
    async (scenario) => {
      const f = await commitSelectedCreate()
      let at = RECOVERY_NOW + 100
      f.host.deps.now = () => at
      const journal = existingJournal(f)
      const original = journal.readRetainedSnapshot.bind(journal)
      vi.spyOn(journal, 'readRetainedSnapshot').mockImplementation(async (...args) => {
        const snapshot = await original(...args)
        at =
          scenario === 'expiry'
            ? f.row.expiresAt
            : scenario === 'invalid'
              ? Number.NaN
              : RECOVERY_NOW + 99
        return snapshot
      })
      expect((await replay(f)).decision).toBe('unknown')
    }
  )
  it('returns recorded refusal without touching an absent journal', async () => {
    const f = await commitSelectedCreate()
    await f.store.recordOperationOutcome({
      callerKey: RECOVERY_CALLER,
      operationId: f.row.operationId,
      outcome: {
        status: 'failed',
        code: 'agent_session_operation_invalid',
        details: { reason: 'operationRefusedEarlier' },
        message: 'retained refusal'
      }
    })
    const sessions = f.host.collaboratorsForTests().sessions
    const entry = sessions.get(f.record.sessionId)!
    sessions.delete(f.record.sessionId)
    try {
      expect(await replay(f)).toMatchObject({
        decision: 'replay',
        result: { ok: false, refusal: { message: 'retained refusal' } }
      })
      expect(f.acquire).toHaveBeenCalledOnce()
    } finally {
      sessions.set(f.record.sessionId, entry)
    }
  })
  it('leaves absent host journal UNKNOWN even when files exist', async () => {
    const f = await commitSelectedCreate()
    const sessions = f.host.collaboratorsForTests().sessions
    const entry = sessions.get(f.record.sessionId)!
    sessions.delete(f.record.sessionId)
    try {
      const before = await bytes(f)
      expect((await replay(f)).decision).toBe('unknown')
      expect(await bytes(f)).toEqual(before)
      expect(sessions.has(f.record.sessionId)).toBe(false)
    } finally {
      sessions.set(f.record.sessionId, entry)
    }
  })
  it('does not read journal for an unsettled pending operation', async () => {
    const f = await reserveSelectedCreate()
    expect((await replay(f)).decision).toBe('unknown')
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })
  it('rejects SSH and WSL without a local read', async () => {
    const f = await commitSelectedCreate()
    const read = vi.spyOn(f.store, 'withFreshRead')
    expect(
      (
        await replay(f, {
          expectedLocation: { ...f.record.location, executionHostId: 'ssh:other' }
        })
      ).decision
    ).toBe('unknown')
    expect(
      (await replay(f, { expectedLocation: { ...f.record.location, wslDistro: 'Ubuntu' } }))
        .decision
    ).toBe('unknown')
    expect(read).not.toHaveBeenCalled()
  })
  it('includes preceding queued writes and returns detached snapshot content', async () => {
    const f = await commitSelectedCreate()
    const journal = existingJournal(f)
    const fence = f.record.lease.runtimeFence
    const appended = journal.appendItem(
      {
        provider: 'codex',
        threadId: '019fd532-7c11-7a90-b6de-4e1a2c3d5f60',
        turnId: 'turn-1',
        ordinal: 9
      },
      {
        kind: 'message',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'committed before read' }]
      },
      { fence }
    )
    const result = await replay(f)
    await appended
    if (result.decision !== 'replay' || !result.result.ok) {
      throw new Error('expected replay')
    }
    const item = result.result.value.page.items[0]
    expect(item.body).toMatchObject({ blocks: [{ text: 'committed before read' }] })
    item.body = { kind: 'status', text: 'mutated' }
    expect(journal.snapshot().items[0].body).toMatchObject({
      blocks: [{ text: 'committed before read' }]
    })
  })
  it.each(['schema', 'projection', 'handle', 'repair'] as const)(
    'rejects current SQLite %s drift despite cached readable snapshot',
    async (scenario) => {
      const f = await commitSelectedCreate()
      const dir = journalDirectoryFor(f.root, {
        sessionId: f.record.sessionId,
        workspaceId: f.record.location.workspaceId
      })
      const db = new Database(journalDatabaseFile(dir))
      try {
        if (scenario === 'schema') {
          db.pragma('user_version = 99')
        }
        if (scenario === 'projection') {
          db.prepare('UPDATE journal_rows SET ts = ts + 1 WHERE seq = 1').run()
        }
        if (scenario === 'handle') {
          db.prepare(
            "UPDATE journal_rows SET row_json = json_set(row_json, '$.providerHandle.threadId', 'other') WHERE seq = 1"
          ).run()
        }
        if (scenario === 'repair') {
          db.prepare('INSERT INTO journal_repairs VALUES (?, ?, ?, ?)').run(
            f.record.sessionId,
            existingJournal(f).epoch,
            2,
            RECOVERY_NOW
          )
        }
      } finally {
        db.close()
      }
      const before = await bytes(f)
      expect((await replay(f)).decision).toBe('unknown')
      expect(await bytes(f)).toEqual(before)
    }
  )
  it('refuses a closed journal and keeps later store queue work usable', async () => {
    const f = await commitSelectedCreate()
    const journal = existingJournal(f)
    await journal.close()
    expect((await replay(f)).decision).toBe('unknown')
    await expect(
      f.store.withFreshRead(() => {
        throw new Error('fixture refusal')
      })
    ).rejects.toThrow('fixture refusal')
    expect(
      await f.store.withFreshRead((view) => view.getRecord(f.record.sessionId)?.sessionId)
    ).toBe(f.record.sessionId)
  })
  it('rejects mismatched journal identity without mutations', async () => {
    const f = await commitSelectedCreate()
    const journal = existingJournal(f)
    const identity = journalIdentityFor(f.record, f.prepared.attachParams)
    expect(
      (
        await journal.readRetainedSnapshot(
          { ...identity, workspaceId: 'other' },
          f.record.lease.runtimeFence
        )
      ).decision
    ).toBe('unknown')
  })
})
