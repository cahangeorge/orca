import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_JOURNAL_DISPATCH_STATES } from '../../../shared/agent-session-journal-types'
import type {
  AgentJournalSnapshot,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import Database from '../../sqlite/sync-database'
import { JOURNAL_DB_SCHEMA_VERSION } from './journal-database-schema'
import { replayJournal } from './journal-open'
import { journalDatabaseFile, journalDirectoryFor } from './journal-paths'
import { renderJournalState } from './journal-reducer'
import { iterateJournalEpochRows, readJournalSessionEpoch } from './journal-row-table'
import { AGENT_JOURNAL_EPOCH_REASONS, parseJournalRow } from './journal-row-schema'

export type RetainedJournalRead =
  | { decision: 'retained'; snapshot: AgentJournalSnapshot }
  | { decision: 'unknown'; reason: string }

type RetainedFile = { bytes: Buffer; stamp: string }
type RetainedImage = Map<string, RetainedFile>
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const SUFFIXES = ['', '-wal', '-shm'] as const

/** Host must hold source quiescence for this entire synchronous call; samples are not a lock. */
export function readQuiescentRetainedJournal(input: {
  journalRoot: string
  identity: AgentSessionJournalIdentity
  fence: number
  readQuiescence: () => boolean
}): RetainedJournalRead {
  let copyDir: string | undefined
  try {
    if (
      !input.readQuiescence() ||
      !Number.isSafeInteger(input.fence) ||
      input.fence < 0 ||
      input.identity.agent !== 'codex' ||
      input.identity.providerHandle.kind !== 'codex'
    ) {
      return unknownJournal()
    }
    const source = journalDatabaseFile(journalDirectoryFor(input.journalRoot, input.identity))
    const first = collectImage(source)
    if (!input.readQuiescence() || !imagesEqual(first, collectImage(source))) {
      return unknownJournal()
    }
    copyDir = mkdtempSync(join(tmpdir(), 'orca-retained-journal-'))
    const copy = journalDatabaseFile(copyDir)
    // SQLite may rebuild SHM on the private copy; never open the source database.
    for (const suffix of ['', '-wal']) {
      const file = first.get(suffix)
      if (file) {
        writeFileSync(`${copy}${suffix}`, file.bytes, { mode: 0o600 })
      }
    }
    const db = new Database(copy, { readonly: true, fileMustExist: true })
    let snapshot: AgentJournalSnapshot | null
    try {
      snapshot = readRetainedJournalSnapshot(db, input.identity, input.fence)
    } finally {
      db.close()
    }
    return snapshot && input.readQuiescence() && imagesEqual(first, collectImage(source))
      ? { decision: 'retained', snapshot }
      : unknownJournal()
  } catch {
    return unknownJournal()
  } finally {
    if (copyDir) {
      rmSync(copyDir, { recursive: true, force: true })
    }
  }
}

function unknownJournal(): RetainedJournalRead {
  return { decision: 'unknown', reason: 'retained-journal-unavailable' }
}

function collectImage(path: string): RetainedImage {
  const image: RetainedImage = new Map()
  let total = 0
  for (const suffix of SUFFIXES) {
    const file = readBoundedFile(`${path}${suffix}`, MAX_IMAGE_BYTES - total)
    if (!file) {
      if (suffix === '') {
        throw new Error('Missing journal')
      }
      continue
    }
    total += file.bytes.length
    image.set(suffix, file)
  }
  return image
}

function fileStamp(stat: ReturnType<typeof fstatSync>): string {
  return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs])
}

function readBoundedFile(path: string, limit: number): RetainedFile | null {
  let initial: ReturnType<typeof lstatSync>
  try {
    initial = lstatSync(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > limit) {
    throw new Error('Untrusted journal file')
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || fileStamp(before) !== fileStamp(initial)) {
      throw new Error('Journal file changed')
    }
    // One extra byte detects growth without allocating an unbounded readFile buffer.
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, length)
      if (read === 0) {
        break
      }
      length += read
    }
    if (
      length !== before.size ||
      fileStamp(before) !== fileStamp(fstatSync(fd)) ||
      fileStamp(before) !== fileStamp(lstatSync(path))
    ) {
      throw new Error('Journal file changed')
    }
    return { bytes: buffer.subarray(0, length), stamp: fileStamp(before) }
  } finally {
    closeSync(fd)
  }
}

function imagesEqual(left: RetainedImage, right: RetainedImage): boolean {
  return (
    left.size === right.size &&
    [...left].every(([name, file]) => {
      const other = right.get(name)
      return other?.stamp === file.stamp && file.bytes.equals(other.bytes)
    })
  )
}

export function readRetainedJournalSnapshot(
  db: Database.Database,
  identity: AgentSessionJournalIdentity,
  fence: number
): AgentJournalSnapshot | null {
  if (db.pragma('user_version', { simple: true }) !== JOURNAL_DB_SCHEMA_VERSION) {
    return null
  }
  const columns = {
    journal_rows: [
      ['session_id', 'TEXT', 1],
      ['epoch', 'TEXT', 2],
      ['seq', 'INTEGER', 3],
      ['ts', 'INTEGER', 0],
      ['row_json', 'TEXT', 0]
    ],
    journal_sessions: [
      ['session_id', 'TEXT', 1],
      ['epoch', 'TEXT', 0],
      ['updated_at', 'INTEGER', 0]
    ],
    journal_repairs: [
      ['session_id', 'TEXT', 1],
      ['epoch', 'TEXT', 0],
      ['content_from', 'INTEGER', 0],
      ['repaired_at', 'INTEGER', 0]
    ]
  }
  for (const [table, expected] of Object.entries(columns)) {
    if (db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(table)?.type !== 'table') {
      return null
    }
    const actual = db.pragma(`table_info(${table})`)
    if (
      !Array.isArray(actual) ||
      actual.length !== expected.length ||
      actual.some(
        (column: unknown, index) =>
          !column ||
          typeof column !== 'object' ||
          !('name' in column) ||
          column.name !== expected[index][0] ||
          !('type' in column) ||
          column.type !== expected[index][1] ||
          !('pk' in column) ||
          column.pk !== expected[index][2]
      )
    ) {
      return null
    }
  }
  const check = db.prepare('PRAGMA quick_check(1)').get()
  if (!check || Object.values(check)[0] !== 'ok') {
    return null
  }
  const sessions = db.prepare('SELECT session_id FROM journal_sessions').all()
  if (sessions.length !== 1 || sessions[0]?.session_id !== identity.sessionId) {
    return null
  }
  if (
    db
      .prepare('SELECT session_id FROM journal_repairs WHERE session_id = ?')
      .get(identity.sessionId)
  ) {
    return null
  }
  const epoch = readJournalSessionEpoch(db, identity.sessionId)
  if (!epoch || typeof epoch !== 'string') {
    return null
  }
  if (
    db
      .prepare('SELECT seq FROM journal_rows WHERE session_id != ? OR epoch != ? LIMIT 1')
      .get(identity.sessionId, epoch)
  ) {
    return null
  }
  let sequence = 0
  for (const stored of iterateJournalEpochRows(db, identity.sessionId, epoch)) {
    if (++sequence > 100_000) {
      return null
    }
    const parsed = parseJournalRow(stored.rowJson)
    if (!parsed.ok) {
      return null
    }
    const row = parsed.row
    if (
      row.epoch !== epoch ||
      row.epoch !== stored.epoch ||
      row.seq !== stored.seq ||
      row.seq !== sequence ||
      row.ts !== stored.ts ||
      !Number.isSafeInteger(row.ts) ||
      row.ts < 0 ||
      !Number.isSafeInteger(row.fence) ||
      row.fence < 0 ||
      row.fence > fence ||
      (sequence === 1 ? row.kind !== 'epoch' : row.kind === 'epoch')
    ) {
      return null
    }
    if (row.kind === 'epoch' || row.kind === 'submission') {
      if (
        row.providerHandle.kind !== 'codex' ||
        identity.providerHandle.kind !== 'codex' ||
        row.providerHandle.threadId !== identity.providerHandle.threadId
      ) {
        return null
      }
    }
    if (row.kind === 'epoch' && !AGENT_JOURNAL_EPOCH_REASONS.includes(row.reason)) {
      return null
    }
    if (row.kind === 'dispatch' && !AGENT_JOURNAL_DISPATCH_STATES.includes(row.state)) {
      return null
    }
  }
  const loaded = replayJournal(db, false, identity.sessionId)
  return loaded && !loaded.readOnly && !loaded.corrupt && loaded.truncateFrom === undefined
    ? renderJournalState(loaded.state)
    : null
}
