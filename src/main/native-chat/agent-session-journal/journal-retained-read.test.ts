import { createHash } from 'node:crypto'
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../../shared/agent-session-journal-types'
import type Database from '../../sqlite/sync-database'
import { openJournalDatabase } from './journal-database'
import { journalDatabaseFile, journalDirectoryFor } from './journal-paths'
import { insertJournalRow, upsertJournalSessionRow } from './journal-row-table'
import type { JournalRow } from './journal-row-schema'
import { readQuiescentRetainedJournal } from './journal-retained-read'

const identity: AgentSessionJournalIdentity = {
  sessionId: 'session-alpha',
  workspaceId: 'workspace-1',
  hostId: 'local',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: 'thread-1' }
}
let root: string
let db: Database.Database | undefined
const anchor: JournalRow = {
  kind: 'epoch',
  reason: 'session_created',
  providerHandle: identity.providerHandle,
  v: 2,
  epoch: 'epoch-1',
  seq: 1,
  fence: 1,
  ts: 1000
}
function seed() {
  const dir = journalDirectoryFor(root, identity)
  mkdirSync(dir, { recursive: true })
  db = openJournalDatabase(journalDatabaseFile(dir)).db
  upsertJournalSessionRow(db, identity.sessionId, 'epoch-1', 1000)
  insertJournalRow(db, identity.sessionId, anchor)
  insertJournalRow(db, identity.sessionId, {
    ...anchor,
    kind: 'item',
    seq: 2,
    itemId: 'item-1',
    revision: 1,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'retained' }] }
  })
  return { db, dir }
}
function bytes(dir: string) {
  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex')
      ])
  )
}
function read(overrides: Partial<Parameters<typeof readQuiescentRetainedJournal>[0]> = {}) {
  return readQuiescentRetainedJournal({
    journalRoot: root,
    identity,
    fence: 1,
    readQuiescence: () => true,
    ...overrides
  })
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-retained-test-'))
})
afterEach(async () => {
  db?.close()
  db = undefined
  await rm(root, { recursive: true, force: true })
})
describe('quiescent retained journal', () => {
  it('reads committed WAL data without touching DB/WAL/SHM bytes or membership', () => {
    const { dir } = seed()
    expect(readdirSync(dir)).toContain('journal.db-wal')
    const before = bytes(dir)
    expect(read()).toMatchObject({
      decision: 'retained',
      snapshot: {
        sessionId: identity.sessionId,
        cursor: { epoch: 'epoch-1', sequence: 2 },
        items: [{ body: { blocks: [{ text: 'retained' }] } }]
      }
    })
    expect(bytes(dir)).toEqual(before)
  })
  it('reads a closed WAL-mode database without creating source sidecars', () => {
    const { dir } = seed()
    db?.close()
    db = undefined
    const before = bytes(dir)
    expect(read().decision).toBe('retained')
    expect(bytes(dir)).toEqual(before)
  })
  it('leaves missing source paths absent', () => {
    const before = readdirSync(root)
    expect(read().decision).toBe('unknown')
    expect(readdirSync(root)).toEqual(before)
  })
  it('refuses unavailable or lost host quiescence', () => {
    seed()
    expect(read({ readQuiescence: () => false }).decision).toBe('unknown')
    let calls = 0
    expect(read({ readQuiescence: () => ++calls === 1 }).decision).toBe('unknown')
  })
  it('refuses a source change during collection', () => {
    const { db: writer } = seed()
    let calls = 0
    expect(
      read({
        readQuiescence: () => {
          if (++calls === 2) {
            writer.pragma('user_version = 8')
          }
          return true
        }
      }).decision
    ).toBe('unknown')
  })
  it.each([0, 1, 3])('refuses unsupported schema %s without migration', (version) => {
    const { db: writer, dir } = seed()
    writer.pragma(`user_version = ${version}`)
    const before = bytes(dir)
    expect(read().decision).toBe('unknown')
    expect(bytes(dir)).toEqual(before)
  })
  it.each([
    ['future row', { v: 99 }],
    ['wrong epoch', { epoch: 'other' }],
    ['wrong projected sequence', { seq: 3 }],
    ['wrong projected timestamp', { ts: 2000 }],
    ['unsafe fence', { fence: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative fence', { fence: -1 }],
    ['future fence', { fence: 2 }],
    ['wrong handle', { providerHandle: { kind: 'codex', threadId: 'other' } }]
  ])('refuses %s without repairing source', (_name, mutation) => {
    const { db: writer, dir } = seed()
    writer
      .prepare('UPDATE journal_rows SET row_json = ? WHERE seq = 1')
      .run(JSON.stringify({ ...anchor, ...mutation }))
    const before = bytes(dir)
    expect(read().decision).toBe('unknown')
    expect(bytes(dir)).toEqual(before)
  })
  it('refuses gaps and pending repair evidence', () => {
    const { db: writer, dir } = seed()
    writer.prepare('DELETE FROM journal_rows WHERE seq = 1').run()
    const before = bytes(dir)
    expect(read().decision).toBe('unknown')
    expect(bytes(dir)).toEqual(before)
  })
  it('refuses a standing repair marker even with a readable prefix', () => {
    const { db: writer } = seed()
    writer
      .prepare('INSERT INTO journal_repairs VALUES (?, ?, ?, ?)')
      .run(identity.sessionId, 'epoch-1', 3, 1000)
    expect(read().decision).toBe('unknown')
  })
  it('refuses symlink source rather than opening its target', () => {
    const { dir } = seed()
    db?.close()
    db = undefined
    const source = journalDatabaseFile(dir)
    const target = join(root, 'target.db')
    writeFileSync(target, readFileSync(source))
    writeFileSync(source, '')
    // A sidecar symlink is equally untrusted and avoids replacing the seeded DB.
    symlinkSync(target, `${source}-wal`)
    const before = bytes(dir)
    expect(read().decision).toBe('unknown')
    expect(bytes(dir)).toEqual(before)
  })
  it('refuses an oversized sparse source before allocating its contents', () => {
    const { dir } = seed()
    db?.close()
    db = undefined
    const path = journalDatabaseFile(dir)
    const fd = openSync(path, 'r+')
    try {
      ftruncateSync(fd, 32 * 1024 * 1024 + 1)
    } finally {
      closeSync(fd)
    }
    expect(read().decision).toBe('unknown')
  })
  it('rejects schema shape drift without creating missing tables', () => {
    const { db: writer, dir } = seed()
    writer.exec('DROP TABLE journal_repairs')
    const before = bytes(dir)
    expect(read().decision).toBe('unknown')
    expect(bytes(dir)).toEqual(before)
  })
  it('removes the private copy after success and malformed-image refusal', () => {
    const copyRoot = join(root, 'private-copies')
    mkdirSync(copyRoot)
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
      vi.stubEnv(name, copyRoot)
    }
    try {
      const { db: writer } = seed()
      expect(read().decision).toBe('retained')
      expect(readdirSync(copyRoot)).toEqual([])
      writer.pragma('user_version = 99')
      expect(read().decision).toBe('unknown')
      expect(readdirSync(copyRoot)).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
