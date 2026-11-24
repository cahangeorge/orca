import {
  agentSessionOperationKey,
  evaluateAgentSessionOperation,
  type AgentSessionOperationOutcome
} from '../../../../shared/agent-session-operation-ledger'
import {
  agentSessionExecutionLocationsEqual,
  type AgentSessionAccountHome,
  type AgentSessionExecutionLocation
} from '../../../../shared/agent-session-record'
import { CreateIntentParams } from '../../../../shared/rpc-contract/structured-agent-session-params'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'
import type { StructuredAgentSessionInitialOptions } from '../../../../shared/structured-agent-session-create'
import { attachFingerprintFields } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'

export type SelectedCreateRecoveryStore = Pick<
  AgentSessionRecordStore,
  | 'hostId'
  | 'readOnly'
  | 'recoveredFromBackup'
  | 'getOperationRow'
  | 'getRecord'
  | 'isSessionUnreadable'
>

export type SelectedCreateRecovery =
  | { decision: 'unknown'; reason: string }
  | { decision: 'conflict'; reason: string }
  | {
      decision: 'settled'
      outcome: Extract<AgentSessionOperationOutcome, { status: 'succeeded' | 'failed' }>
      pinned: {
        sessionId: string
        location: AgentSessionExecutionLocation
        accountHome: AgentSessionAccountHome
        initialOptions: StructuredAgentSessionInitialOptions
        options: Readonly<Record<string, string>>
      }
    }

/** Internal settlement evidence only; neither a fresh-create nor an acquire grant.
 * The caller must resolve identity on the execution host before invoking this. */
export function resolveSelectedStructuredCreateRecovery(input: {
  store: SelectedCreateRecoveryStore
  request: unknown
  callerKey: string
  expectedLocation: AgentSessionExecutionLocation
  now: number
}): SelectedCreateRecovery {
  try {
    return readSelectedCreateRecovery(input)
  } catch {
    return { decision: 'unknown', reason: 'durable-evidence-unavailable' }
  }
}

function readSelectedCreateRecovery(input: {
  store: SelectedCreateRecoveryStore
  request: unknown
  callerKey: string
  expectedLocation: AgentSessionExecutionLocation
  now: number
}): SelectedCreateRecovery {
  const { store, callerKey, now, expectedLocation } = input
  const parsed = CreateIntentParams.safeParse(input.request)
  const initialOptions = parsed.success ? parsed.data.initialOptions : undefined
  if (
    !parsed.success ||
    parsed.data.agent !== 'codex' ||
    !initialOptions ||
    parsed.data.resumeFrom !== undefined ||
    parsed.data.envelope.expectedRuntimeFence !== null
  ) {
    return { decision: 'conflict', reason: 'request-malformed' }
  }
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    callerKey.trim().length === 0 ||
    store.readOnly ||
    store.recoveredFromBackup ||
    expectedLocation.executionHostId !== store.hostId
  ) {
    return { decision: 'unknown', reason: 'durable-evidence-unavailable' }
  }
  const request = parsed.data
  const { envelope } = request
  const row = store.getOperationRow(callerKey, envelope.clientOperationId)
  if (!row || row.expiresAt <= now || row.recordedAt > now) {
    return { decision: 'unknown', reason: 'operation-evidence-missing' }
  }
  const record = store.getRecord(envelope.sessionId)
  if (
    !record ||
    store.isSessionUnreadable(envelope.sessionId) ||
    record.sessionId !== envelope.sessionId ||
    record.provider !== 'codex' ||
    record.accountHome.variable !== 'CODEX_HOME' ||
    record.accountHome.path.trim().length === 0 ||
    record.location.executionHostId !== store.hostId
  ) {
    return { decision: 'unknown', reason: 'record-evidence-unavailable' }
  }
  if (!agentSessionExecutionLocationsEqual(record.location, expectedLocation)) {
    return { decision: 'conflict', reason: 'location-changed' }
  }
  // Current session options can change; the original request pair is proved by its ledger digest.
  const fingerprint = computeAgentSessionPayloadFingerprint({
    method: 'agentSession.attach',
    sessionId: record.sessionId,
    fields: attachFingerprintFields({
      envelope,
      location: record.location,
      provider: 'codex',
      agent: 'codex',
      accountHome: record.accountHome,
      runtimeKind: 'native',
      createInitialSelection: initialOptions
    })
  })
  const evaluated = evaluateAgentSessionOperation({
    rows: new Map([[agentSessionOperationKey(callerKey, envelope.clientOperationId), row]]),
    callerKey,
    operationId: envelope.clientOperationId,
    fingerprint,
    now
  })
  if (evaluated.decision !== 'replay') {
    return evaluated.decision === 'refused' && evaluated.code === 'agent_session_operation_conflict'
      ? { decision: 'conflict', reason: 'selection-or-identity-changed' }
      : { decision: 'unknown', reason: 'operation-evidence-invalid' }
  }
  if (row.outcome.status === 'pending' || row.outcome.status === 'unknown') {
    return { decision: 'unknown', reason: 'operation-unsettled' }
  }
  if (row.outcome.status === 'succeeded' && row.outcome.sessionId !== record.sessionId) {
    return { decision: 'unknown', reason: 'result-evidence-incoherent' }
  }
  return {
    decision: 'settled',
    outcome: structuredClone(row.outcome),
    pinned: {
      sessionId: record.sessionId,
      location: { ...record.location },
      accountHome: { ...record.accountHome },
      initialOptions: { ...initialOptions },
      options: { ...record.options }
    }
  }
}
