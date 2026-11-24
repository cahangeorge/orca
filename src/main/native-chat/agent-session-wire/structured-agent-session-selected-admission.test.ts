import { readFile } from 'node:fs/promises'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { join } from 'node:path'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionRefusalError } from '../../../shared/agent-session-wire-refusals'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import type { StructuredAgentSessionSelectedCreateAdmission } from './structured-agent-session-host-types'
import {
  hostTestAttachParams,
  HOST_TEST_NOW,
  HOST_TEST_SESSION,
  HOST_TEST_LOCATION
} from './structured-agent-session-host-test-data'
import { CALLER, hostTestState } from './structured-agent-session-host-test-harness'
import { StructuredAgentSessionHostRuntimeState } from './structured-agent-session-host-runtime-state'
import { createDeferredStructuredAgentSessionEventSink } from './structured-agent-session-event-sink'

afterEach(() => vi.restoreAllMocks())

const PAIR = { model: 'gpt-6.1-sol', effort: 'medium' }

function selectedParams(): AgentSessionAttachParams {
  return hostTestAttachParams(null, {
    providerHandle: undefined,
    location: { ...HOST_TEST_LOCATION },
    options: { ...PAIR, fastMode: 'true' },
    createInitialSelection: { ...PAIR }
  })
}

function grant(): StructuredAgentSessionSelectedCreateAdmission {
  return {
    reservation: { now: () => HOST_TEST_NOW, validate: vi.fn(() => undefined) },
    beforeAcquire: vi.fn(() => undefined)
  }
}

function unknown(): never {
  throw agentSessionRefusalError('agent_session_operation_unknown', { reason: 'outcomeUnknown' })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('selected create host admission effect boundary', () => {
  it('refuses missing admission before reconciliation, recovery, reservation or acquisition', async () => {
    const { host, store, acquire } = hostTestState()
    const reserve = vi.spyOn(store, 'reserveOwner')
    const recover = vi.spyOn(StructuredAgentSessionHostRuntimeState.prototype, 'resolveRecovery')
    const probe = vi.spyOn(StructuredAgentSessionHostRuntimeState.prototype, 'probeOwner')
    const scan = vi.fn(async () => null)
    host.deps.scanSpawnTokenProcesses = scan
    const result = await host.attach(CALLER, selectedParams())
    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_unknown' }
    })
    expect(recover).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(scan).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(store.getRecord(HOST_TEST_SESSION)).toBeNull()
  })

  it.each(['null', 'throws'])(
    'refuses an admission resolver that %s without fresh fallback',
    async (mode) => {
      const { host, store, acquire } = hostTestState()
      host.deps.resolveSelectedCreateAdmission = () => (mode === 'null' ? null : unknown())
      const reserve = vi.spyOn(store, 'reserveOwner')
      expect(await host.attach(CALLER, selectedParams())).toMatchObject({
        ok: false,
        refusal: { code: 'agent_session_operation_unknown' }
      })
      expect(reserve).not.toHaveBeenCalled()
      expect(acquire).not.toHaveBeenCalled()
    }
  )

  it.each([
    Promise.resolve(grant()),
    {},
    { reservation: {} },
    { reservation: grant().reservation, beforeAcquire: null }
  ])('refuses malformed or asynchronous host grant %# before effects', async (malformed) => {
    const { host, store, acquire } = hostTestState()
    Object.defineProperty(host.deps, 'resolveSelectedCreateAdmission', {
      value: () => malformed,
      configurable: true
    })
    const reserve = vi.spyOn(store, 'reserveOwner')
    expect(await host.attach(CALLER, selectedParams())).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_unknown' }
    })
    expect(reserve).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'decorated'])(
    'refuses %s asynchronous grant resolvers without leaking rejections',
    async (kind) => {
      const { host, store, acquire } = hostTestState()
      const admission = grant()
      Object.defineProperty(host.deps, 'resolveSelectedCreateAdmission', {
        value: () =>
          kind === 'rejected'
            ? Promise.reject(new Error('unsupported asynchronous grant'))
            : Object.assign(Promise.resolve(admission), admission)
      })
      const reserve = vi.spyOn(store, 'reserveOwner')
      expect(await host.attach(CALLER, selectedParams())).toMatchObject({
        ok: false,
        refusal: { code: 'agent_session_operation_unknown' }
      })
      expect(reserve).not.toHaveBeenCalled()
      expect(acquire).not.toHaveBeenCalled()
    }
  )

  it('passes original IDs, fingerprint, selection and Fast to actual first reservation', async () => {
    const { host, store, acquire } = hostTestState()
    const params = selectedParams()
    const admission = grant()
    const validate = vi.spyOn(admission.reservation, 'validate').mockImplementation((request) => {
      expect(store.getRecord(HOST_TEST_SESSION)).toBeNull()
      expect(store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)).toBeNull()
      expect(request.sessionId).toBe(params.envelope.sessionId)
      expect(request.operation).toEqual({
        callerKey: CALLER.callerKey,
        operationId: params.envelope.clientOperationId,
        fingerprint: params.envelope.payloadFingerprint
      })
      expect(request.handoffOperationId).toBe(params.envelope.clientOperationId)
      expect(request.options).toEqual({ ...PAIR, fastMode: 'true' })
      return undefined
    })
    const resolver = vi.fn(() => admission)
    host.deps.resolveSelectedCreateAdmission = resolver
    expect((await host.attach(CALLER, params)).ok).toBe(true)
    expect(resolver).toHaveBeenCalledWith(CALLER, params)
    expect(validate).toHaveBeenCalledOnce()
    expect(admission.beforeAcquire).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledOnce()
    expect(acquire.mock.calls[0][0].options).toEqual({ ...PAIR, fastMode: 'true' })
    const record = store.getRecord(HOST_TEST_SESSION)!
    expect(record.options).toEqual({ ...PAIR, fastMode: 'true' })
    expect(
      store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)?.fingerprint
    ).toBe(params.envelope.payloadFingerprint)
    expect(record).not.toHaveProperty('selectedCreateAdmission')
  })

  it.each([
    ['clock', 'promise'],
    ['clock', 'rejection'],
    ['clock', 'value'],
    ['reservation', 'promise'],
    ['reservation', 'rejection'],
    ['reservation', 'value'],
    ['acquisition', 'promise'],
    ['acquisition', 'rejection'],
    ['acquisition', 'value']
  ])('refuses %s validation returning %s without starting a provider', async (stage, kind) => {
    const { host, store, acquire } = hostTestState()
    const params = selectedParams()
    const admission = grant()
    Object.defineProperty(
      stage !== 'acquisition' ? admission.reservation : admission,
      stage === 'clock' ? 'now' : stage === 'reservation' ? 'validate' : 'beforeAcquire',
      {
        value: () =>
          kind === 'rejection'
            ? Promise.reject(new Error('unsupported asynchronous validation'))
            : kind === 'promise'
              ? Promise.resolve(undefined)
              : true
      }
    )
    host.deps.resolveSelectedCreateAdmission = () => admission
    expect(await host.attach(CALLER, params)).toMatchObject({ ok: false })
    expect(acquire).not.toHaveBeenCalled()
    if (stage !== 'acquisition') {
      expect(store.getRecord(HOST_TEST_SESSION)).toBeNull()
      expect(store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)).toBeNull()
    } else {
      expect(store.getRecord(HOST_TEST_SESSION)?.lease.claimStatus).toBe('released')
      expect(
        store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)?.outcome.status
      ).toBe('failed')
    }
  })

  it('failed under-lock validation creates no record, row, or provider child', async () => {
    const { host, store, acquire } = hostTestState()
    const params = selectedParams()
    const admission = grant()
    admission.reservation.validate = unknown
    host.deps.resolveSelectedCreateAdmission = () => admission
    expect(await host.attach(CALLER, params)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_unknown' }
    })
    expect(store.getRecord(HOST_TEST_SESSION)).toBeNull()
    expect(store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)).toBeNull()
    expect(acquire).not.toHaveBeenCalled()
    expect(admission.beforeAcquire).not.toHaveBeenCalled()
  })

  it.each(['scope drift', 'cancellation'])(
    'revalidates %s after the awaited acquisition barrier and durably settles processless failure',
    async (mode) => {
      const { host, store, acquire, releaseAcquisition, root } = hostTestState()
      const params = selectedParams()
      const gate = deferred()
      const entered = deferred()
      const sink = createDeferredStructuredAgentSessionEventSink()
      sink.drained = async () => {
        entered.resolve()
        await gate.promise
        return { ok: true }
      }
      const currentSink = vi
        .spyOn(StructuredAgentSessionHostRuntimeState.prototype, 'currentEventSink')
        .mockReturnValue(sink)
      let account = '/pinned/account-a'
      const controller = new AbortController()
      const admission = grant()
      admission.beforeAcquire = vi.fn((record) => {
        expect(record.sessionId).toBe(params.envelope.sessionId)
        if (account !== '/pinned/account-a' || controller.signal.aborted) {
          unknown()
        }
        return undefined
      })
      host.deps.resolveSelectedCreateAdmission = () => admission
      const pending = host.attach(CALLER, params)
      await entered.promise
      expect(store.getRecord(HOST_TEST_SESSION)?.lease.claimStatus).toBe('reserved')
      expect(admission.beforeAcquire).not.toHaveBeenCalled()
      if (mode === 'scope drift') {
        account = '/pinned/account-b'
      } else {
        controller.abort()
      }
      gate.resolve()
      const result = await pending
      currentSink.mockRestore()
      expect(result.ok).toBe(false)
      expect(admission.beforeAcquire).toHaveBeenCalledOnce()
      expect(acquire).not.toHaveBeenCalled()
      expect(releaseAcquisition).not.toHaveBeenCalled()
      const record = store.getRecord(HOST_TEST_SESSION)!
      expect(record.lease.ownerProcess).toBeNull()
      expect(record.lease.claimStatus).toBe('released')
      expect(
        store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)?.outcome.status
      ).toBe('failed')
      const reopened = await AgentSessionRecordStore.open({
        directory: join(root, 'store'),
        hostId: 'local'
      })
      expect(reopened.getRecord(HOST_TEST_SESSION)?.lease.ownerProcess).toBeNull()
      expect(reopened.getRecord(HOST_TEST_SESSION)?.lease.claimStatus).toBe('released')
      expect(
        reopened.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)?.outcome
          .status
      ).toBe('failed')
      sink.close()
    }
  )

  it('snapshots selected intent before serialization and freezes the resolver snapshot', async () => {
    const { host, store, acquire } = hostTestState()
    const first = selectedParams()
    const queued = selectedParams()
    const original = structuredClone(queued)
    const gate = deferred()
    const entered = deferred()
    let argsCalls = 0
    host.deps.resolveLaunchArgs = async () => {
      if (++argsCalls === 1) {
        entered.resolve()
        await gate.promise
      }
      return undefined
    }
    const denied = grant()
    denied.reservation.validate = unknown
    const accepted = grant()
    const resolver = vi
      .fn<NonNullable<typeof host.deps.resolveSelectedCreateAdmission>>(() => accepted)
      .mockReturnValueOnce(denied)
    host.deps.resolveSelectedCreateAdmission = resolver
    const firstResult = host.attach(CALLER, first)
    await entered.promise
    const queuedResult = host.attach(CALLER, queued)
    queued.envelope.clientOperationId = 'mutated'
    queued.envelope.sessionId = 'mutated'
    queued.envelope.payloadFingerprint = 'mutated'
    queued.location.workspaceId = 'mutated'
    queued.accountHome.path = '/mutated'
    Object.assign(queued.createInitialSelection!, { model: 'mutated' })
    queued.options = { model: 'mutated', effort: 'high', fastMode: 'false' }
    gate.resolve()
    expect((await firstResult).ok).toBe(false)
    expect((await queuedResult).ok).toBe(true)
    const snapshot = resolver.mock.calls[1]?.[1]
    expect(snapshot).toEqual(original)
    for (const value of [
      snapshot,
      snapshot?.envelope,
      snapshot?.location,
      snapshot?.accountHome,
      snapshot?.options,
      snapshot?.createInitialSelection
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(store.getRecord(original.envelope.sessionId)?.options).toEqual({
      ...PAIR,
      fastMode: 'true'
    })
    expect(
      store.getOperationRow(CALLER.callerKey, original.envelope.clientOperationId)?.outcome.status
    ).toBe('succeeded')
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('rejects selected repeats and existing records through first-only reservation', async () => {
    const { host, acquire } = hostTestState()
    const params = selectedParams()
    const admission = grant()
    host.deps.resolveSelectedCreateAdmission = () => admission
    expect((await host.attach(CALLER, params)).ok).toBe(true)
    expect((await host.attach(CALLER, params)).ok).toBe(false)
    expect((await host.attach(CALLER, selectedParams())).ok).toBe(false)
    expect(admission.reservation.validate).toHaveBeenCalledOnce()
    expect(admission.beforeAcquire).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('refuses an existing expired owner on restart without reconciling or changing retained evidence', async () => {
    const { host, store, acquire, root } = hostTestState()
    const params = selectedParams()
    host.deps.resolveSelectedCreateAdmission = () => grant()
    expect((await host.attach(CALLER, params)).ok).toBe(true)
    const restartedStore = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    const before = restartedStore.getRecord(HOST_TEST_SESSION)
    expect(before?.lease.unreconciled).toBe(true)
    const probe = vi.fn(async () => ({ outcome: 'pid-absent' as const }))
    const restarted = new StructuredAgentSessionHost({
      ...host.deps,
      store: restartedStore,
      now: () => HOST_TEST_NOW + 600_000,
      probeOwner: probe
    })
    const reconcile = vi.spyOn(restartedStore, 'reconcileOnRestart')
    const recovery = vi.spyOn(StructuredAgentSessionHostRuntimeState.prototype, 'resolveRecovery')
    const storePath = join(root, 'store', 'agent-sessions.json')
    try {
      const diskBefore = await readFile(storePath, 'utf8')
      const result = await restarted.attach(CALLER, params)
      expect(result.ok).toBe(false)
      expect(reconcile).not.toHaveBeenCalled()
      expect(recovery).not.toHaveBeenCalled()
      expect(probe).not.toHaveBeenCalled()
      expect(restartedStore.getRecord(HOST_TEST_SESSION)).toEqual(before)
      expect(await readFile(storePath, 'utf8')).toBe(diskBefore)
      expect(acquire).toHaveBeenCalledOnce()
    } finally {
      await restarted.flushAllStreamedEvents()
    }
    expect(store.getRecord(HOST_TEST_SESSION)?.lease.ownerProcess).not.toBeNull()
  })

  it('legacy create keeps Fast without consulting selected admission', async () => {
    const { host, acquire } = hostTestState()
    const resolver = vi.fn(() => unknown())
    host.deps.resolveSelectedCreateAdmission = resolver
    const params = hostTestAttachParams(null, {
      providerHandle: undefined,
      options: { model: 'saved', effort: 'low', fastMode: 'true' }
    })
    expect((await host.attach(CALLER, params)).ok).toBe(true)
    expect(resolver).not.toHaveBeenCalled()
    expect(acquire.mock.calls[0][0].options).toEqual(params.options)
  })
})
