import type { AgentSessionJournalIdentity } from '../../../shared/agent-session-journal-types'
import type Database from '../../sqlite/sync-database'
import type { JournalWriteQueue } from './journal-store-close'
import { readRetainedJournalSnapshot, type RetainedJournalRead } from './journal-retained-read'

/** Call only inside the owning journal queue; observes a single committed SQLite horizon. */
export function readOwnedRetainedJournal(
  queue: JournalWriteQueue,
  connection: () => Database.Database | null,
  owner: AgentSessionJournalIdentity,
  identity: AgentSessionJournalIdentity,
  fence: number
): Promise<RetainedJournalRead> {
  return queue
    .serialize(async (): Promise<RetainedJournalRead> => {
      const db = connection()
      const sameOwner = (['sessionId', 'workspaceId', 'hostId', 'agent'] as const).every(
        (key) => identity[key] === owner[key]
      )
      if (
        !db ||
        db.isTransaction ||
        !Number.isSafeInteger(fence) ||
        fence < 0 ||
        identity.agent !== 'codex' ||
        identity.providerHandle.kind !== 'codex' ||
        !sameOwner
      ) {
        return unknownJournal()
      }
      db.exec('BEGIN DEFERRED')
      try {
        const snapshot = readRetainedJournalSnapshot(db, identity, fence)
        return snapshot
          ? { decision: 'retained', snapshot: structuredClone(snapshot) }
          : unknownJournal()
      } finally {
        db.exec('ROLLBACK')
      }
    })
    .catch(unknownJournal)
}

function unknownJournal(): RetainedJournalRead {
  return { decision: 'unknown', reason: 'retained-journal-unavailable' }
}
