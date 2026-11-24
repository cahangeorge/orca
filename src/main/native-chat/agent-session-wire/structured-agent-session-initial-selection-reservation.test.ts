import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { structuredAgentSessionCreateParams } from '../../../shared/structured-agent-session-create'
import type { StructuredAgentSessionInitialOptions } from '../../../shared/structured-agent-session-create'
import { CreateIntentParams } from '../../../shared/rpc-contract/structured-agent-session-params'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { AGENT_SESSION_STORE_SCHEMA_VERSION } from '../../runtime/agent-session-record-store-file'
import { prepareStructuredAgentSessionCreateForWorktree } from '../../runtime/rpc/methods/structured-agent-session-create'
import {
  admitAttachOrRefuse,
  reserveRequestFor,
  type AgentSessionAttachParams
} from './structured-agent-session-attach'
import { hostTestState } from './structured-agent-session-host-test-harness'

const NOW = 1_800_000_000_000
const SESSION = 'codex_11111111_2222_3333_4444_555555555555'
const PAIR = { model: 'gpt-6.1-sol', effort: 'medium' }
const CALLER = 'client-1'

async function prepare(pair: StructuredAgentSessionInitialOptions = PAIR, fastMode = 'true') {
  const intent = structuredAgentSessionCreateParams({
    sessionId: SESSION,
    worktree: 'id:workspace-1',
    agent: 'codex',
    initialOptions: pair,
    initialOptionsCatalogRef: 'catalog_01',
    randomUuid: () => '00000000-0000-4000-8000-000000000001',
    now: NOW
  })
  // Each changed pair has a fresh correct public digest, not a mismatch rejected before the ledger.
  expect(CreateIntentParams.parse(intent)).toEqual(intent)
  const resolved: AgentSessionAttachParams = {
    envelope: intent.envelope,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/host/.codex' },
    runtimeKind: 'native',
    options: { model: 'saved-model', effort: 'low', fastMode }
  }
  return (
    await prepareStructuredAgentSessionCreateForWorktree({
      runtime: { resolveStructuredAgentSessionCreateIntent: async () => resolved },
      ensureHost: async () => hostTestState().host,
      envelope: intent.envelope,
      worktree: intent.worktree,
      agent: 'codex',
      caller: { callerKey: CALLER },
      initialOptions: pair
    })
  ).attachParams
}

function request(params: AgentSessionAttachParams, mint = vi.fn(() => 'spawn-a'), now = NOW) {
  const admitted = admitAttachOrRefuse(params)
  if (!admitted.ok) {
    throw new Error(admitted.refusal.code)
  }
  return reserveRequestFor({
    sessionId: SESSION,
    params,
    callerKey: CALLER,
    fingerprint: admitted.fingerprint,
    now,
    authority: {
      spawnToken: mint,
      claimKeyId: 'key-1',
      handoffOperationId: params.envelope.clientOperationId,
      probe: { outcome: 'reservation-unused' }
    }
  })
}

describe('initial selection durable reservation', () => {
  it('records the admitted selection digest and persists options before any provider acquisition', async () => {
    const params = await prepare()
    const { store, acquire, dispatch } = hostTestState()
    const result = await store.reserveOwner(request(params))
    expect(result.disposition).toBe('created')
    expect(result.record.options).toEqual({ ...PAIR, fastMode: 'true' })
    expect(result.operationRow.fingerprint).toBe(params.envelope.payloadFingerprint)
    expect(acquire).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it.each([
    { model: 'gpt-6-luna', effort: 'medium' },
    { model: 'gpt-6.1-sol', effort: 'high' }
  ])(
    'refuses a changed pair with fully valid recomputed digests at the real ledger: %j',
    async (pair) => {
      const { store } = hostTestState()
      const first = await prepare()
      await store.reserveOwner(request(first))
      const changed = await prepare(pair)
      const mint = vi.fn(() => 'spawn-second')
      await expect(store.reserveOwner(request(changed, mint))).rejects.toThrow(
        'agent_session_operation_conflict'
      )
      expect(mint).not.toHaveBeenCalled()
      expect(store.listOperationRows()).toHaveLength(1)
      expect(store.getRecord(SESSION)?.options).toEqual({ ...PAIR, fastMode: 'true' })
      expect(store.getOperationRow(CALLER, first.envelope.clientOperationId)?.fingerprint).toBe(
        first.envelope.payloadFingerprint
      )
    }
  )

  it('replays the same operation/pair without replacing seed state or minting another token', async () => {
    const { store } = hostTestState()
    await store.reserveOwner(request(await prepare()))
    const mint = vi.fn(() => 'spawn-second')
    const replay = await store.reserveOwner(request(await prepare(PAIR, 'false'), mint))
    expect(replay.disposition).toBe('replayed')
    expect(replay.record.options).toEqual({ ...PAIR, fastMode: 'true' })
    expect(mint).not.toHaveBeenCalled()
  })

  it('allows only one concurrent winner for different pairs under the same operation', async () => {
    const { store } = hostTestState()
    const first = request(
      await prepare(),
      vi.fn(() => 'spawn-first')
    )
    const other = request(
      await prepare({ ...PAIR, effort: 'high' }),
      vi.fn(() => 'spawn-other')
    )
    const results = await Promise.allSettled([store.reserveOwner(first), store.reserveOwner(other)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ message: 'agent_session_operation_conflict' })
      }
    }
    expect(store.listRecords()).toHaveLength(1)
    expect(store.listOperationRows()).toHaveLength(1)
    expect(first.spawnToken).toHaveBeenCalledOnce()
    expect(other.spawnToken).not.toHaveBeenCalled()
  })

  it('replays simultaneous identical pairs with one durable record and one token', async () => {
    const { store } = hostTestState()
    const mint = vi.fn(() => 'spawn-once')
    const params = await prepare()
    const results = await Promise.all([
      store.reserveOwner(request(params, mint)),
      store.reserveOwner(request(params, mint))
    ])
    expect(results.map((r) => r.disposition).sort()).toEqual(['created', 'replayed'])
    expect(store.listRecords()).toHaveLength(1)
    expect(store.listOperationRows()).toHaveLength(1)
    expect(mint).toHaveBeenCalledOnce()
  })

  it('keeps selected conflict protection after reopening and reconciling a released reservation', async () => {
    const { store, root } = hostTestState()
    const first = await prepare()
    await store.reserveOwner(request(first))
    const reopened = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    await reopened.reconcileOnRestart({
      probe: async () => ({ outcome: 'indeterminate', reason: 'test restart' }),
      now: NOW + 1
    })
    const changedMint = vi.fn(() => 'spawn-changed')
    await expect(
      reopened.reserveOwner(
        request(await prepare({ ...PAIR, effort: 'high' }), changedMint, NOW + 1)
      )
    ).rejects.toThrow('agent_session_operation_conflict')
    expect(changedMint).not.toHaveBeenCalled()
    const replay = await reopened.reserveOwner(
      request(
        await prepare(),
        vi.fn(() => 'spawn-restarted'),
        NOW + 1
      )
    )
    expect(replay.disposition).toBe('reserved')
    expect(replay.record.lease.runtimeFence).toBe(3)
    expect(replay.record.options).toEqual({ ...PAIR, fastMode: 'true' })
    expect(reopened.getOperationRow(CALLER, first.envelope.clientOperationId)?.fingerprint).toBe(
      first.envelope.payloadFingerprint
    )
    const raw = await readFile(join(root, 'store', 'agent-sessions.json'), 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 2 })
    expect(AGENT_SESSION_STORE_SCHEMA_VERSION).toBe(2)
  })

  it.each(['succeeded', 'unknown'] as const)(
    'replays a durable %s outcome after restart, while changed pair still conflicts',
    async (status) => {
      const { store, root } = hostTestState()
      const params = await prepare()
      await store.reserveOwner(request(params))
      await store.recordOperationOutcome({
        callerKey: CALLER,
        operationId: params.envelope.clientOperationId,
        outcome: status === 'succeeded' ? { status, sessionId: SESSION } : { status }
      })
      const reopened = await AgentSessionRecordStore.open({
        directory: join(root, 'store'),
        hostId: 'local'
      })
      const mint = vi.fn(() => 'spawn-second')
      const replay = await reopened.reserveOwner(request(await prepare(PAIR, 'false'), mint))
      expect(replay.disposition).toBe('replayed')
      expect(replay.record.options).toEqual({ ...PAIR, fastMode: 'true' })
      await expect(
        reopened.reserveOwner(request(await prepare({ ...PAIR, model: 'gpt-6-luna' }), mint))
      ).rejects.toThrow('agent_session_operation_conflict')
      expect(mint).not.toHaveBeenCalled()
    }
  )
})
