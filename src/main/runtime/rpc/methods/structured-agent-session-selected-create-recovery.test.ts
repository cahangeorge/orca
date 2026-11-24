import { describe, expect, it } from 'vitest'
import {
  commitSelectedCreate,
  RECOVERY_CALLER,
  RECOVERY_NOW,
  RECOVERY_PAIR,
  selectedCreateRequest,
  reserveSelectedCreate
} from './structured-agent-session-selected-create-recovery-fixture'
import { resolveSelectedStructuredCreateRecovery } from './structured-agent-session-selected-create-recovery'

describe('selected create recovery (read-only settlement evidence)', () => {
  it.each(['folder', 'git-worktree'] as const)(
    'recovers the original %s create after a lost ACK',
    async (kind) => {
      const f = await commitSelectedCreate(kind)
      const before = JSON.stringify(f.record)
      const result = resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW + 1
      })
      expect(result).toMatchObject({
        decision: 'settled',
        outcome: { status: 'succeeded' },
        pinned: {
          sessionId: f.record.sessionId,
          accountHome: f.record.accountHome,
          initialOptions: RECOVERY_PAIR,
          options: { ...RECOVERY_PAIR, fastMode: 'true' }
        }
      })
      expect(JSON.stringify(f.record)).toBe(before)
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.dispatch).not.toHaveBeenCalled()
      expect(f.store.listOperationRows()).toHaveLength(1)
    }
  )

  it.each([
    { model: 'gpt-6-luna', effort: 'medium' },
    { ...RECOVERY_PAIR, effort: 'high' }
  ])('conflicts on a changed pair even with its fully valid public digest: %j', async (pair) => {
    const f = await commitSelectedCreate()
    expect(
      resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: selectedCreateRequest(pair),
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW
      }).decision
    ).toBe('conflict')
    expect(f.acquire).toHaveBeenCalledOnce()
  })

  it('checks the original operation selection separately from current session options', async () => {
    const f = await commitSelectedCreate()
    await f.store.replaceSessionOptions({
      sessionId: f.record.sessionId,
      fence: f.record.lease.runtimeFence,
      options: { model: 'later-model', effort: 'high', fastMode: 'false' },
      now: RECOVERY_NOW + 1
    })
    const result = resolveSelectedStructuredCreateRecovery({
      store: f.store,
      request: f.request,
      callerKey: RECOVERY_CALLER,
      expectedLocation: f.record.location,
      now: RECOVERY_NOW + 2
    })
    expect(result).toMatchObject({
      decision: 'settled',
      pinned: {
        initialOptions: RECOVERY_PAIR,
        options: { model: 'later-model', effort: 'high', fastMode: 'false' }
      }
    })
    expect(f.acquire).toHaveBeenCalledOnce()
  })

  it.each(['pending', 'unknown', 'failed'] as const)(
    'preserves retained %s outcome without reacquiring',
    async (status) => {
      const f = await reserveSelectedCreate()
      await f.store.recordOperationOutcome({
        callerKey: RECOVERY_CALLER,
        operationId: f.request.envelope.clientOperationId,
        outcome:
          status === 'failed'
            ? {
                status,
                code: 'agent_session_operation_invalid',
                details: { reason: 'requestMalformed' },
                message: 'Original refusal'
              }
            : { status }
      })
      const result = resolveSelectedStructuredCreateRecovery({
        store: f.store,
        request: f.request,
        callerKey: RECOVERY_CALLER,
        expectedLocation: f.record.location,
        now: RECOVERY_NOW + 1
      })
      expect(result.decision).toBe(status === 'failed' ? 'settled' : 'unknown')
      if (status === 'failed') {
        expect(result).toMatchObject({ outcome: { status, message: 'Original refusal' } })
      }
      expect(f.acquire).not.toHaveBeenCalled()
    }
  )

  it.each(['workspaceId', 'workspaceKind', 'wslDistro'] as const)(
    'conflicts on trusted target %s drift',
    async (key) => {
      const f = await commitSelectedCreate()
      const expectedLocation = {
        ...f.record.location,
        [key]: key === 'workspaceKind' ? ('git-worktree' as const) : 'other'
      }
      expect(
        resolveSelectedStructuredCreateRecovery({
          store: f.store,
          request: f.request,
          callerKey: RECOVERY_CALLER,
          expectedLocation,
          now: RECOVERY_NOW
        }).decision
      ).toBe('conflict')
    }
  )

  it('treats a different caller or execution host as unknown, not a new operation', async () => {
    const f = await commitSelectedCreate()
    for (const input of [
      { callerKey: 'other-caller', expectedLocation: f.record.location },
      {
        callerKey: RECOVERY_CALLER,
        expectedLocation: { ...f.record.location, executionHostId: 'ssh:other-host' as const }
      }
    ]) {
      expect(
        resolveSelectedStructuredCreateRecovery({
          store: f.store,
          request: f.request,
          ...input,
          now: RECOVERY_NOW
        }).decision
      ).toBe('unknown')
    }
  })

  it.each([Number.NaN, Infinity, -1, RECOVERY_NOW - 1])(
    'refuses to infer settlement at invalid time %s',
    async (now) => {
      const f = await commitSelectedCreate()
      expect(
        resolveSelectedStructuredCreateRecovery({
          store: f.store,
          request: f.request,
          callerKey: RECOVERY_CALLER,
          expectedLocation: f.record.location,
          now
        }).decision
      ).toBe('unknown')
    }
  )

  it('does not share mutable evidence with the underlying store', async () => {
    const f = await commitSelectedCreate()
    const result = resolveSelectedStructuredCreateRecovery({
      store: f.store,
      request: f.request,
      callerKey: RECOVERY_CALLER,
      expectedLocation: f.record.location,
      now: RECOVERY_NOW
    })
    if (result.decision !== 'settled') {
      throw new Error('expected settlement')
    }
    result.pinned.accountHome.path = '/mutated'
    result.pinned.location.workspaceId = 'mutated'
    Object.assign(result.pinned.options, { fastMode: 'false' })
    Object.assign(result.pinned.initialOptions, { effort: 'invented' })
    result.outcome.status = 'failed'
    expect(f.store.getRecord(f.record.sessionId)?.accountHome.path).toBe('/pinned/account-a')
    expect(f.store.getRecord(f.record.sessionId)?.location.workspaceId).toBe('workspace-1')
    expect(f.store.getRecord(f.record.sessionId)?.options?.fastMode).toBe('true')
    expect(f.store.getOperationRow(RECOVERY_CALLER, f.row.operationId)?.outcome.status).toBe(
      'succeeded'
    )
  })

  it('never treats malformed public selection or absent selection as no prior effect', async () => {
    const f = await commitSelectedCreate()
    for (const request of [
      { ...f.request, initialOptions: undefined, initialOptionsCatalogRef: undefined },
      { ...f.request, initialOptionsCatalogRef: undefined },
      { ...f.request, initialOptions: { ...RECOVERY_PAIR, model: 'has space' } },
      { ...f.request, envelope: { ...f.request.envelope, payloadFingerprint: '0'.repeat(64) } },
      { ...f.request, envelope: { ...f.request.envelope, expectedRuntimeFence: 1 } }
    ]) {
      expect(
        resolveSelectedStructuredCreateRecovery({
          store: f.store,
          request,
          callerKey: RECOVERY_CALLER,
          expectedLocation: f.record.location,
          now: RECOVERY_NOW
        }).decision
      ).toBe('conflict')
    }
    expect(f.acquire).toHaveBeenCalledOnce()
  })
})
