import { expect } from 'vitest'
import {
  structuredAgentSessionCreateParams,
  type StructuredAgentSessionInitialOptions
} from '../../../../shared/structured-agent-session-create'
import type { AgentSessionAttachParams } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import { reserveRequestFor } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import type { SelectedCreateRecoveryStore } from './structured-agent-session-selected-create-recovery'
import { hostTestState } from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import {
  HOST_TEST_LOCATION,
  HOST_TEST_NOW,
  HOST_TEST_SESSION
} from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { prepareStructuredAgentSessionCreateForWorktree } from './structured-agent-session-create'

export const RECOVERY_NOW = HOST_TEST_NOW
export const RECOVERY_SESSION = HOST_TEST_SESSION
export const RECOVERY_CALLER = 'client-1'
export const RECOVERY_PAIR = { model: 'gpt-6.1-sol', effort: 'medium' }

export function selectedCreateRequest(pair: StructuredAgentSessionInitialOptions = RECOVERY_PAIR) {
  return structuredAgentSessionCreateParams({
    sessionId: RECOVERY_SESSION,
    worktree: 'id:workspace-1',
    agent: 'codex',
    initialOptions: pair,
    initialOptionsCatalogRef: 'catalog-before-restart',
    randomUuid: () => '00000000-0000-4000-8000-000000000001',
    now: RECOVERY_NOW
  })
}

async function prepareSelectedCreate(workspaceKind: 'folder' | 'git-worktree') {
  const state = hostTestState()
  // Synthetic host grant for retained recovery tests, never a production issuer.
  state.host.deps.resolveSelectedCreateAdmission = () => ({
    reservation: { now: () => RECOVERY_NOW, validate: () => undefined },
    beforeAcquire: () => undefined
  })
  const request = selectedCreateRequest()
  const resolved: AgentSessionAttachParams = {
    envelope: request.envelope,
    location: { ...HOST_TEST_LOCATION, workspaceKind },
    accountHome: { variable: 'CODEX_HOME', path: '/pinned/account-a' },
    agent: 'codex',
    provider: 'codex',
    runtimeKind: 'native',
    options: { model: 'saved-model', effort: 'low', fastMode: 'true' }
  }
  const prepared = await prepareStructuredAgentSessionCreateForWorktree({
    runtime: { resolveStructuredAgentSessionCreateIntent: async () => resolved },
    ensureHost: async () => state.host,
    envelope: request.envelope,
    worktree: request.worktree,
    agent: 'codex',
    caller: { callerKey: RECOVERY_CALLER },
    initialOptions: RECOVERY_PAIR
  })
  return { ...state, request, prepared }
}

export async function commitSelectedCreate(workspaceKind: 'folder' | 'git-worktree' = 'folder') {
  const state = await prepareSelectedCreate(workspaceKind)
  const { prepared, request } = state
  const result = await prepared.host.attach({ callerKey: RECOVERY_CALLER }, prepared.attachParams)
  expect(result.ok).toBe(true)
  expect(state.acquire).toHaveBeenCalledOnce()
  expect(state.dispatch).not.toHaveBeenCalled()
  const record = state.store.getRecord(RECOVERY_SESSION)!
  const row = state.store.getOperationRow(RECOVERY_CALLER, request.envelope.clientOperationId)!
  expect(row.outcome.status).toBe('succeeded')
  return { ...state, request, record, row, prepared }
}

export async function reserveSelectedCreate() {
  const state = await prepareSelectedCreate('folder')
  const params = state.prepared.attachParams
  await state.store.reserveOwner(
    reserveRequestFor({
      sessionId: RECOVERY_SESSION,
      params,
      callerKey: RECOVERY_CALLER,
      fingerprint: params.envelope.payloadFingerprint,
      now: RECOVERY_NOW,
      authority: {
        spawnToken: () => 'reserved-only',
        claimKeyId: 'key-1',
        handoffOperationId: params.envelope.clientOperationId,
        probe: { outcome: 'reservation-unused' }
      }
    })
  )
  return {
    ...state,
    record: state.store.getRecord(RECOVERY_SESSION)!,
    row: state.store.getOperationRow(RECOVERY_CALLER, params.envelope.clientOperationId)!
  }
}

export function recoveryStoreView(
  store: SelectedCreateRecoveryStore,
  overrides: Partial<SelectedCreateRecoveryStore> = {}
): SelectedCreateRecoveryStore {
  return {
    hostId: store.hostId,
    readOnly: store.readOnly,
    recoveredFromBackup: store.recoveredFromBackup,
    getRecord: store.getRecord,
    getOperationRow: store.getOperationRow,
    isSessionUnreadable: store.isSessionUnreadable,
    ...overrides
  }
}
