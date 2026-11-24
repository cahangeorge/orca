import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../runtime/rpc/core'

type PendingCall = {
  context: RpcContext
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const { handlers, calls, senderCreated, existingSenders } = vi.hoisted(() => {
  const calls: PendingCall[] = []
  return {
    handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
    calls,
    senderCreated:
      vi.fn<(name: string, callback: (event: unknown, sender: WebContents) => void) => void>(),
    existingSenders: vi.fn<() => WebContents[]>(() => [])
  }
})

vi.mock('electron', () => ({
  app: { on: senderCreated, removeListener: vi.fn() },
  webContents: { getAllWebContents: existingSenders },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    removeHandler: vi.fn()
  }
}))

vi.mock('../runtime/rpc/methods', async () => {
  const { defineMethod } = await import('../runtime/rpc/core')
  return {
    ALL_RPC_METHODS: [
      defineMethod({
        name: 'test.pending',
        params: null,
        handler: (_params, context) =>
          new Promise((resolve, reject) => calls.push({ context, resolve, reject }))
      })
    ]
  }
})

import { registerRuntimeHandlers } from './runtime'
import { DesktopRuntimeSenderLifecycle } from './desktop-runtime-sender-lifecycle'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'

function createSender(id: number) {
  const events = new EventEmitter()
  return Object.assign(events, {
    id,
    mainFrame: {},
    isDestroyed: (): boolean => false,
    send: vi.fn(),
    getURL: (): string => 'http://localhost:5173/',
    isLoadingMainFrame: (): boolean => false
  })
}

function desktopSender(sender: ReturnType<typeof createSender>): WebContents {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every WebContents member used by the lifecycle and navigation helper.
  return sender as unknown as WebContents
}

function call(sender: ReturnType<typeof createSender>, senderFrame = sender.mainFrame) {
  const handler = handlers.get('runtime:call')
  if (!handler) {
    throw new Error('runtime:call not registered')
  }
  return Promise.resolve(handler({ sender, senderFrame }, { method: 'test.pending' }))
}

async function pendingCall(sender: ReturnType<typeof createSender>) {
  const count = calls.length
  const result = call(sender)
  await vi.waitFor(() => expect(calls).toHaveLength(count + 1))
  return { result, record: calls[count] }
}

describe('desktop unary RPC lifecycle', () => {
  let cleanup: ReturnType<typeof vi.fn<(connectionId: string) => void>>
  beforeEach(() => {
    vi.restoreAllMocks()
    senderCreated.mockClear()
    existingSenders.mockReturnValue([])
    handlers.clear()
    calls.length = 0
    cleanup = vi.fn()
    const runtime = {
      cleanupSubscriptionsForConnection: cleanup,
      getRuntimeId: () => 'test-runtime'
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests invoke only the registered unary channel and supply all runtime methods it uses.
    registerRuntimeHandlers(runtime as never)
  })

  it.each(['did-navigate', 'render-process-gone', 'destroyed'])(
    'aborts concurrent calls on %s while preserving other senders',
    async (eventName) => {
      const sender = createSender(1)
      const other = createSender(2)
      const first = await pendingCall(sender)
      const second = await pendingCall(sender)
      const surviving = await pendingCall(other)
      expect(first.record.context.connectionId).toBe(second.record.context.connectionId)
      expect(first.record.context.signal).toBeInstanceOf(AbortSignal)
      sender.emit(eventName)
      expect(first.record.context.signal?.aborted).toBe(true)
      expect(second.record.context.signal?.aborted).toBe(true)
      expect(surviving.record.context.signal?.aborted).toBe(false)
      expect(cleanup).toHaveBeenCalledWith(first.record.context.connectionId)
      for (const record of calls) {
        record.resolve({})
      }
      await Promise.all([first.result, second.result, surviving.result])
    }
  )

  it('aborts at privileged document navigation start and refuses reentrant and new calls', async () => {
    const sender = createSender(9)
    const old = await pendingCall(sender)
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const tracked = lifecycle.beginUnaryCall(desktopSender(sender))
    const stream = new AbortController()
    lifecycle.subscriptionsFor(desktopSender(sender)).set('stream', stream)
    let refused = false
    tracked.signal.addEventListener('abort', () => {
      try {
        lifecycle.beginUnaryCall(desktopSender(sender))
      } catch {
        refused = true
      }
    })
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    expect(old.record.context.signal?.aborted).toBe(true)
    expect(refused).toBe(true)
    expect(stream.signal.aborted).toBe(false)
    await expect(call(sender)).rejects.toThrow('during renderer document navigation')
    expect(calls).toHaveLength(1)
    old.record.resolve({})
    await old.result
  })

  it.each([
    ['http://localhost:5173/frame', false, false],
    ['http://localhost:5173/#hash', true, true],
    ['https://external.example/', false, true]
  ])('keeps calls alive for ignored navigation %s', async (url, sameDocument, mainFrame) => {
    const sender = createSender(10)
    const pending = await pendingCall(sender)
    sender.emit('did-start-navigation', {}, url, sameDocument, mainFrame)
    expect(pending.record.context.signal?.aborted).toBe(false)
    pending.record.resolve({})
    await pending.result
  })

  it('permits fresh calls after a canceled navigation without reviving aborted work', async () => {
    const sender = createSender(11)
    const old = await pendingCall(sender)
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    sender.emit(
      'will-navigate',
      { defaultPrevented: true },
      'http://localhost:5173/reloaded',
      false,
      true
    )
    await Promise.resolve()
    const fresh = await pendingCall(sender)
    expect(old.record.context.signal?.aborted).toBe(true)
    expect(fresh.record.context.signal?.aborted).toBe(false)
    old.record.resolve({})
    await old.result
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    expect(fresh.record.context.signal?.aborted).toBe(true)
    fresh.record.resolve({})
    await fresh.result
  })

  it('opens a new generation after a navigation commits', async () => {
    const sender = createSender(12)
    const old = await pendingCall(sender)
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    sender.emit('did-frame-navigate', {}, 'http://localhost:5173/reloaded', 200, 'OK', true)
    sender.emit('did-navigate')
    const fresh = await pendingCall(sender)
    expect(old.record.context.signal?.aborted).toBe(true)
    expect(fresh.record.context.signal?.aborted).toBe(false)
    expect(fresh.record.context.connectionId).not.toBe(old.record.context.connectionId)
    old.record.resolve({})
    await old.result
    sender.emit('render-process-gone')
    expect(fresh.record.context.signal?.aborted).toBe(true)
    fresh.record.resolve({})
    await fresh.result
  })

  it('retires a replaced sender ID without retiring its replacement', async () => {
    const oldSender = createSender(3)
    const replacement = createSender(3)
    const old = await pendingCall(oldSender)
    const fresh = await pendingCall(replacement)
    expect(old.record.context.signal?.aborted).toBe(true)
    expect(fresh.record.context.signal?.aborted).toBe(false)
    expect(fresh.record.context.connectionId).not.toBe(old.record.context.connectionId)
    oldSender.emit('destroyed')
    expect(fresh.record.context.signal?.aborted).toBe(false)
    replacement.emit('destroyed')
    expect(fresh.record.context.signal?.aborted).toBe(true)
    for (const record of calls) {
      record.resolve({})
    }
    await Promise.all([old.result, fresh.result])
  })

  it('releases successful and failed calls while retaining later pending calls', async () => {
    const sender = createSender(4)
    const success = await pendingCall(sender)
    success.record.resolve({})
    await success.result
    const failure = await pendingCall(sender)
    failure.record.reject(new Error('handler failed'))
    await failure.result
    const pending = await pendingCall(sender)
    sender.emit('did-navigate')
    expect(success.record.context.signal?.aborted).toBe(false)
    expect(failure.record.context.signal?.aborted).toBe(false)
    expect(pending.record.context.signal?.aborted).toBe(true)
    pending.record.resolve({})
    await pending.result
  })

  it('releases calls when dispatch itself rejects', async () => {
    const sender = createSender(5)
    let signal: AbortSignal | undefined
    vi.spyOn(RpcDispatcher.prototype, 'dispatch').mockImplementation(async (_request, options) => {
      signal = options?.signal
      throw new Error('dispatch rejected')
    })
    await expect(call(sender)).rejects.toThrow('dispatch rejected')
    expect(signal).toBeInstanceOf(AbortSignal)
    sender.emit('did-navigate')
    expect(signal?.aborted).toBe(false)
  })

  it('refuses a stale frame without entering dispatch or lifecycle setup', async () => {
    const sender = createSender(6)
    const dispatch = vi.spyOn(RpcDispatcher.prototype, 'dispatch')
    await expect(call(sender, {})).rejects.toThrow('current main frame')
    expect(dispatch).not.toHaveBeenCalled()
    expect(sender.eventNames()).toEqual([])
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('preserves calls and subscriptions added by retirement abort callbacks', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const sender = createSender(7)
    const old = lifecycle.beginUnaryCall(desktopSender(sender))
    const oldSubscriptions = lifecycle.subscriptionsFor(desktopSender(sender))
    const stream = new AbortController()
    oldSubscriptions.set('same-id', stream)
    let replacement: ReturnType<DesktopRuntimeSenderLifecycle['beginUnaryCall']> | undefined
    const newStream = new AbortController()
    old.signal.addEventListener('abort', () => {
      replacement = lifecycle.beginUnaryCall(desktopSender(sender))
      lifecycle.subscriptionsFor(desktopSender(sender)).set('same-id', newStream)
    })
    sender.emit('did-navigate')
    expect(old.signal.aborted).toBe(true)
    expect(stream.signal.aborted).toBe(true)
    expect(replacement?.connectionId).not.toBe(old.connectionId)
    expect(replacement?.signal.aborted).toBe(false)
    expect(newStream.signal.aborted).toBe(false)
    old.release()
    sender.emit('render-process-gone')
    expect(replacement?.signal.aborted).toBe(true)
    expect(newStream.signal.aborted).toBe(true)
    expect(cleanup).toHaveBeenCalledWith(replacement?.connectionId)
  })

  it('publishes a sender-ID replacement before abort callbacks reenter it', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const oldSender = createSender(8)
    const replacement = createSender(8)
    const old = lifecycle.beginUnaryCall(desktopSender(oldSender))
    let reentrant: ReturnType<DesktopRuntimeSenderLifecycle['beginUnaryCall']> | undefined
    old.signal.addEventListener('abort', () => {
      reentrant = lifecycle.beginUnaryCall(desktopSender(replacement))
    })
    const fresh = lifecycle.beginUnaryCall(desktopSender(replacement))
    expect(fresh.connectionId).toBe(reentrant?.connectionId)
    expect(reentrant?.signal.aborted).toBe(false)
    replacement.emit('destroyed')
    expect(fresh.signal.aborted).toBe(true)
    expect(reentrant?.signal.aborted).toBe(true)
  })
  it('rejects destroyed sender revival from abort callbacks', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const sender = createSender(20)
    const old = lifecycle.beginUnaryCall(desktopSender(sender))
    let refused = false
    old.signal.addEventListener('abort', () => {
      try {
        lifecycle.beginUnaryCall(desktopSender(sender))
      } catch {
        refused = true
      }
    })
    sender.emit('destroyed')
    expect(refused).toBe(true)
    expect(() => lifecycle.beginUnaryCall(desktopSender(sender))).toThrow()
  })

  it('refuses an already destroyed sender before state creation', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const sender = createSender(21)
    sender.isDestroyed = () => true
    expect(() => lifecycle.beginUnaryCall(desktopSender(sender))).toThrow()
    expect(sender.eventNames()).toEqual([])
  })

  it('prevents replaced objects from stealing their numeric ID during abort', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const oldSender = createSender(22)
    const replacement = createSender(22)
    const old = lifecycle.beginUnaryCall(desktopSender(oldSender))
    let refused = false
    old.signal.addEventListener('abort', () => {
      try {
        lifecycle.beginUnaryCall(desktopSender(oldSender))
      } catch {
        refused = true
      }
    })
    const fresh = lifecycle.beginUnaryCall(desktopSender(replacement))
    expect(refused).toBe(true)
    replacement.emit('destroyed')
    expect(fresh.signal.aborted).toBe(true)
  })

  it('fences first IPC when navigation starts before the first lifecycle access', async () => {
    const sender = createSender(23)
    const listener = senderCreated.mock.calls.find(([name]) => name === 'web-contents-created')?.[1]
    listener?.({}, desktopSender(sender))
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    await expect(call(sender)).rejects.toThrow('during renderer document navigation')
    expect(calls).toHaveLength(0)
  })

  it('allows first IPC during an initial document observed from creation', async () => {
    const sender = createSender(24)
    sender.getURL = () => ''
    sender.isLoadingMainFrame = () => true
    const listener = senderCreated.mock.calls.find(([name]) => name === 'web-contents-created')?.[1]
    listener?.({}, desktopSender(sender))
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/', false, true)
    const initial = await pendingCall(sender)
    expect(initial.record.context.signal?.aborted).toBe(false)
    sender.getURL = () => 'http://localhost:5173/'
    sender.emit('did-frame-navigate', {}, sender.getURL(), 200, 'OK', true)
    sender.emit('did-navigate')
    expect(initial.record.context.signal?.aborted).toBe(true)
    initial.record.resolve({})
    await initial.result
  })

  it('holds unknown late registration until loading stops', () => {
    const lifecycle = new DesktopRuntimeSenderLifecycle({
      cleanupSubscriptionsForConnection: cleanup
    })
    const sender = createSender(25)
    sender.isLoadingMainFrame = () => true
    expect(() => lifecycle.beginUnaryCall(desktopSender(sender))).toThrow(
      'during renderer document navigation'
    )
    sender.isLoadingMainFrame = () => false
    sender.emit('did-stop-loading')
    const fresh = lifecycle.beginUnaryCall(desktopSender(sender))
    expect(fresh.signal.aborted).toBe(false)
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    expect(fresh.signal.aborted).toBe(true)
  })
  it('tracks existing documents before their first IPC', async () => {
    const sender = createSender(26)
    existingSenders.mockReturnValue([desktopSender(sender)])
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unary dispatch uses only these supplied runtime methods.
    registerRuntimeHandlers({
      cleanupSubscriptionsForConnection: cleanup,
      getRuntimeId: () => 'test-runtime'
    } as never)
    sender.emit('did-start-navigation', {}, 'http://localhost:5173/reloaded', false, true)
    await expect(call(sender)).rejects.toThrow('during renderer document navigation')
    expect(calls).toHaveLength(0)
  })
})
