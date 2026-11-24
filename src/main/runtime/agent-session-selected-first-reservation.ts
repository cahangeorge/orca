import { randomUUID } from 'node:crypto'
import {
  createStructuredAgentSessionId,
  structuredAgentSessionCreateParams,
  type StructuredAgentSessionInitialOptions
} from '../../shared/structured-agent-session-create'
import {
  agentSessionRefusalError,
  isAgentSessionRefusalError
} from '../../shared/agent-session-wire-refusals'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  agentSessionExecutionLocationsEqual,
  type AgentSessionAccountHome,
  type AgentSessionExecutionLocation
} from '../../shared/agent-session-record'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import {
  admitAttachOrRefuse,
  attachFingerprintFields,
  reserveRequestFor,
  type AgentSessionAttachParams,
  type AgentSessionAttachAuthority
} from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { agentModelCatalogIdentityForRecord } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import type { createInitialSelectionCatalogEvidence } from '../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'

import {
  commitAgentSessionReservation,
  evaluateAgentSessionReserveOperation,
  type AgentSessionReserveRequest,
  type AgentSessionReserveResult
} from './agent-session-reservation-admission'
import type { AgentSessionStoreTransactionQueue } from './agent-session-store-transaction-queue'

export type AgentSessionFirstReservationAdmission = {
  now: () => number
  validate: (request: AgentSessionReserveRequest) => undefined
}

/** A first reservation cannot change an existing record or publish owner-death evidence. */
export function reserveFirstSelectedAgentSession(
  transactions: AgentSessionStoreTransactionQueue,
  request: AgentSessionReserveRequest,
  admission: AgentSessionFirstReservationAdmission,
  leaseTtlMs: number
): Promise<AgentSessionReserveResult> {
  return transactions.transact(
    () => {
      const at = admission.now()
      if (!Number.isSafeInteger(at) || at < 0) {
        uncertain()
      }
      const current = { ...request, now: at }
      const state = transactions.state
      const decision = evaluateAgentSessionReserveOperation(state, current)
      if (decision.decision === 'refused') {
        throw agentSessionRefusalError(decision.code, decision.details)
      }
      if (
        decision.decision !== 'admit' ||
        state.records.has(current.sessionId) ||
        state.unreadableRecords.has(current.sessionId)
      ) {
        uncertain()
      }
      admission.validate(current)
      return commitAgentSessionReservation(state, current, leaseTtlMs)
    },
    { requireAuthoritativePrimary: true }
  )
}

/** Preserve legacy reserve notifications; only first-only admission uses the stricter transaction. */
export function createAgentSessionReservationOwner(
  transactions: () => AgentSessionStoreTransactionQueue,
  legacy: (request: AgentSessionReserveRequest) => Promise<AgentSessionReserveResult>,
  leaseTtlMs: number
) {
  return (
    request: AgentSessionReserveRequest,
    admission?: AgentSessionFirstReservationAdmission
  ) =>
    admission
      ? reserveFirstSelectedAgentSession(transactions(), request, admission, leaseTtlMs)
      : legacy(request)
}

export type SelectedCreateHostScope = {
  /** Derived by the host's authenticated caller namespace, never copied from request data. */
  callerKey: string
  location: AgentSessionExecutionLocation
  accountHome: AgentSessionAccountHome
  workspacePath: string
  policyVersion: string
}
function uncertain(): never {
  throw agentSessionRefusalError('agent_session_operation_unknown', { reason: 'outcomeUnknown' })
}
function copyScope(scope: SelectedCreateHostScope): SelectedCreateHostScope {
  return { ...scope, location: { ...scope.location }, accountHome: { ...scope.accountHome } }
}
function validScope(scope: SelectedCreateHostScope, hostId: string): boolean {
  return (
    scope.location.executionHostId === LOCAL_EXECUTION_HOST_ID &&
    scope.location.executionHostId === hostId &&
    scope.location.wslDistro === null &&
    scope.accountHome.variable === 'CODEX_HOME' &&
    [
      scope.callerKey,
      scope.location.workspaceId,
      scope.accountHome.path,
      scope.workspacePath,
      scope.policyVersion
    ].every((value) => value.trim().length > 0)
  )
}

/** Internal first-attempt capability only. Never entered from a retry or missing ledger evidence.
 * Host-minted IDs are not the existing client-ID wire protocol; public integration remains held. */
export function createNewSelectedCreateReservationAttempt(input: {
  store: AgentSessionRecordStore
  evidence: ReturnType<typeof createInitialSelectionCatalogEvidence>
  catalogRef: string
  selection: StructuredAgentSessionInitialOptions
  /** Current, synchronous HOST scope at admission, including account/policy drift. */
  readHostScope: () => SelectedCreateHostScope
  authority: AgentSessionAttachAuthority
  seedOptions?: Readonly<Record<string, string>>
  now?: () => number
  randomUuid?: () => string
}) {
  const store = input.store
  const evidence = input.evidence
  const readHostScope = input.readHostScope
  const now = input.now ?? Date.now
  const uuid = input.randomUuid ?? randomUUID
  const scope = copyScope(readHostScope())
  if (!validScope(scope, store.hostId)) {
    uncertain()
  }
  const selection = { ...input.selection }
  const catalogRef = input.catalogRef
  const sessionId = createStructuredAgentSessionId('codex', uuid)
  const intent = structuredAgentSessionCreateParams({
    sessionId,
    agent: 'codex',
    worktree: `id:${scope.location.workspaceId}`,
    initialOptions: selection,
    initialOptionsCatalogRef: catalogRef,
    randomUuid: uuid,
    now: now()
  })
  const params: AgentSessionAttachParams = {
    envelope: intent.envelope,
    location: scope.location,
    accountHome: scope.accountHome,
    provider: 'codex',
    agent: 'codex',
    runtimeKind: 'native',
    options: { ...input.seedOptions, ...selection },
    createInitialSelection: selection
  }
  params.envelope = {
    ...params.envelope,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method: 'agentSession.attach',
      sessionId,
      fields: attachFingerprintFields(params)
    })
  }
  const admitted = admitAttachOrRefuse(params)
  if (!admitted.ok) {
    uncertain()
  }
  const request = reserveRequestFor({
    sessionId,
    params,
    callerKey: scope.callerKey,
    fingerprint: admitted.fingerprint,
    now: now(),
    authority: { ...input.authority, handoffOperationId: intent.envelope.clientOperationId }
  })
  let spent = false
  return {
    sessionId,
    operationId: intent.envelope.clientOperationId,
    async reserve() {
      if (spent) {
        uncertain()
      }
      spent = true
      try {
        return await store.reserveOwner(request, {
          now,
          validate(current) {
            const live = copyScope(readHostScope())
            if (
              !validScope(live, store.hostId) ||
              live.callerKey !== current.operation.callerKey ||
              !agentSessionExecutionLocationsEqual(live.location, current.location) ||
              live.accountHome.variable !== current.accountHome.variable ||
              live.accountHome.path !== current.accountHome.path ||
              current.provider !== 'codex' ||
              current.expectedFence !== null ||
              current.adoptedHandleLink ||
              current.options?.model !== selection.model ||
              current.options?.effort !== selection.effort
            ) {
              uncertain()
            }
            const validated = evidence.validateNewCreate({
              context: {
                ownerKey: live.callerKey,
                executionHostId: live.location.executionHostId,
                workspaceId: live.location.workspaceId,
                workspacePath: live.workspacePath,
                policyVersion: live.policyVersion,
                account: agentModelCatalogIdentityForRecord({
                  provider: 'codex',
                  accountHome: current.accountHome,
                  location: current.location
                })
              },
              catalogRef,
              selection
            })
            if (validated.status !== 'validated') {
              uncertain()
            }
            return undefined
          }
        })
      } catch (error) {
        if (isAgentSessionRefusalError(error)) {
          throw error
        }
        uncertain()
      }
    }
  }
}
