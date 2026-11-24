import type { AgentSessionJournal } from '../../../native-chat/agent-session-journal/journal-store'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'
import { isAgentSessionOperationRow } from '../../../../shared/agent-session-operation-ledger'
import {
  isPersistedAgentSessionRecord,
  type AgentSessionExecutionLocation
} from '../../../../shared/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { agentSessionProviderHandleChainHead } from '../../../../shared/agent-session-provider-handle'
import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../../../shared/agent-session-wire'
import { CreateIntentParams } from '../../../../shared/rpc-contract/structured-agent-session-params'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../../shared/remote-runtime-memory-limits'
import {
  readQuiescentRetainedJournal,
  type RetainedJournalRead
} from '../../../native-chat/agent-session-journal/journal-retained-read'
import { buildHydrationPage } from '../../../native-chat/agent-session-wire/agent-session-history-page'
import { resolveAgentSessionReplayOutcome } from '../../../native-chat/agent-session-wire/structured-agent-session-replay-outcome'
import {
  resolveSelectedStructuredCreateRecovery,
  type SelectedCreateRecoveryStore
} from './structured-agent-session-selected-create-recovery'

export type SelectedCreateReplay =
  | { decision: 'unknown' | 'conflict'; reason: string }
  | { decision: 'replay'; result: AgentSessionMutationResult<AgentSessionAttachResult> }

/** Internal read-only materialization; quiescence is host-owned, never a client assertion. */
export function resolveSelectedStructuredCreateReplay(input: {
  store: SelectedCreateRecoveryStore
  request: unknown
  callerKey: string
  expectedLocation: AgentSessionExecutionLocation
  now: number
  journalRoot?: string
  readQuiescence?: () => boolean
  retainedJournal?: RetainedJournalRead
}): SelectedCreateReplay {
  try {
    return readSelectedCreateReplay(input)
  } catch {
    return unknownReplay()
  }
}

function readSelectedCreateReplay(
  input: Parameters<typeof resolveSelectedStructuredCreateReplay>[0]
): SelectedCreateReplay {
  const request = structuredClone(input.request)
  const expectedLocation = { ...input.expectedLocation }
  if (
    expectedLocation.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    expectedLocation.wslDistro !== null
  ) {
    return unknownReplay()
  }
  const parsed = CreateIntentParams.safeParse(request)
  if (!parsed.success) {
    return { decision: 'conflict', reason: 'request-malformed' }
  }
  const { sessionId, clientOperationId: operationId } = parsed.data.envelope
  const record = structuredClone(input.store.getRecord(sessionId))
  const row = structuredClone(input.store.getOperationRow(input.callerKey, operationId))
  const snapshotStore: SelectedCreateRecoveryStore = {
    hostId: input.store.hostId,
    readOnly: input.store.readOnly,
    recoveredFromBackup: input.store.recoveredFromBackup,
    getRecord: (id) => (id === sessionId ? record : null),
    getOperationRow: (caller, id) =>
      caller === input.callerKey && id === operationId ? row : null,
    isSessionUnreadable: () => input.store.isSessionUnreadable(sessionId)
  }
  const recovered = resolveSelectedStructuredCreateRecovery({
    ...input,
    request,
    expectedLocation,
    store: snapshotStore
  })
  if (recovered.decision !== 'settled') {
    return recovered
  }
  const unchanged = (): boolean =>
    input.store.hostId === snapshotStore.hostId &&
    input.store.readOnly === snapshotStore.readOnly &&
    input.store.recoveredFromBackup === snapshotStore.recoveredFromBackup &&
    !input.store.isSessionUnreadable(sessionId) &&
    JSON.stringify(input.store.getRecord(sessionId)) === JSON.stringify(record) &&
    JSON.stringify(input.store.getOperationRow(input.callerKey, operationId)) ===
      JSON.stringify(row)
  if (
    !record ||
    !row ||
    !isAgentSessionOperationRow(row) ||
    row.callerKey !== input.callerKey ||
    row.operationId !== operationId ||
    !isPersistedAgentSessionRecord(record) ||
    record.lease.runtimeKind !== 'native' ||
    !unchanged()
  ) {
    return unknownReplay()
  }
  if (recovered.outcome.status === 'failed') {
    const failure = resolveAgentSessionReplayOutcome<AgentSessionAttachResult>({
      operationId,
      outcome: recovered.outcome,
      reconstruct: () => null
    })
    return failure.decision === 'refuse'
      ? { decision: 'replay', result: { ok: false, refusal: failure.refusal } }
      : unknownReplay()
  }
  const head = agentSessionProviderHandleChainHead(record.providerHandleChain)
  if (!head || head.handle.provider !== 'codex') {
    return unknownReplay()
  }
  const fence = record.lease.runtimeFence
  const retained =
    input.retainedJournal ??
    (input.journalRoot && input.readQuiescence
      ? readQuiescentRetainedJournal({
          journalRoot: input.journalRoot,
          identity: {
            sessionId: record.sessionId,
            workspaceId: record.location.workspaceId,
            hostId: record.location.executionHostId,
            agent: 'codex',
            providerHandle: { kind: 'codex', threadId: head.handle.threadId }
          },
          fence,
          readQuiescence: input.readQuiescence
        })
      : { decision: 'unknown' as const, reason: 'retained-journal-unavailable' })
  if (
    retained.decision !== 'retained' ||
    retained.snapshot.sessionId !== record.sessionId ||
    !unchanged()
  ) {
    return unknownReplay()
  }
  const result: AgentSessionMutationResult<AgentSessionAttachResult> = {
    ok: true,
    replayed: true,
    fence,
    cursor: retained.snapshot.cursor,
    value: {
      sessionId: record.sessionId,
      fence,
      page: buildHydrationPage(retained.snapshot, fence),
      unconfirmedClientMessageIds: retained.snapshot.submissions
        .filter((entry) => entry.dispatchState === 'unknown' && entry.recovered === true)
        .map((entry) => entry.clientMessageId)
    }
  }
  return Buffer.byteLength(JSON.stringify(result), 'utf8') <= REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES
    ? { decision: 'replay', result }
    : unknownReplay()
}

function unknownReplay(): SelectedCreateReplay {
  return { decision: 'unknown', reason: 'retained-result-unavailable' }
}

/** Lock order: host session, fresh store/file lock, journal; callbacks never re-enter those queues. */
export function createSelectedCreateReplayReader(context: {
  store: () => AgentSessionRecordStore
  getJournal: (sessionId: string) => AgentSessionJournal | null
  serialize: <T>(sessionId: string, read: () => Promise<T>) => Promise<T>
  now: () => number
}) {
  return async (input: {
    request: unknown
    callerKey: string
    expectedLocation: AgentSessionExecutionLocation
  }): Promise<SelectedCreateReplay> => {
    try {
      const pinned = structuredClone(input)
      const parsed = CreateIntentParams.safeParse(pinned.request)
      if (!parsed.success) {
        return { decision: 'conflict', reason: 'request-malformed' }
      }
      if (
        pinned.expectedLocation.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
        pinned.expectedLocation.wslDistro !== null
      ) {
        return unknownReplay()
      }
      const { sessionId } = parsed.data.envelope
      return await context.serialize(sessionId, () =>
        context.store().withFreshRead(async (store) => {
          const now = context.now()
          const recovery = resolveSelectedStructuredCreateRecovery({ ...pinned, store, now })
          if (recovery.decision !== 'settled') {
            return recovery
          }
          if (recovery.outcome.status === 'failed') {
            return resolveSelectedStructuredCreateReplay({ ...pinned, store, now })
          }
          const record = store.getRecord(sessionId)
          const head = record && agentSessionProviderHandleChainHead(record.providerHandleChain)
          const journal = context.getJournal(sessionId)
          if (!record || !head || head.handle.provider !== 'codex' || !journal) {
            return unknownReplay()
          }
          const retainedJournal = await journal.readRetainedSnapshot(
            {
              sessionId,
              workspaceId: record.location.workspaceId,
              hostId: record.location.executionHostId,
              agent: 'codex',
              providerHandle: { kind: 'codex', threadId: head.handle.threadId }
            },
            record.lease.runtimeFence
          )
          const after = context.now()
          if (
            !Number.isSafeInteger(after) ||
            after < now ||
            context.getJournal(sessionId) !== journal
          ) {
            return unknownReplay()
          }
          return resolveSelectedStructuredCreateReplay({
            ...pinned,
            store,
            now: after,
            retainedJournal
          })
        })
      )
    } catch {
      return unknownReplay()
    }
  }
}
