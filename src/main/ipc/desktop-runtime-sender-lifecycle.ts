import type { WebContents } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { registerRendererDocumentNavigation } from '../window/renderer-document-navigation'

type SenderState = {
  connectionId: string
  sender: WebContents
  subscriptions: Map<string, AbortController>
  unaryCalls: Set<AbortController>
  navigationPending: boolean
}

type CleanupRuntime = Pick<OrcaRuntimeService, 'cleanupSubscriptionsForConnection'>

export class DesktopRuntimeSenderLifecycle {
  private readonly senders = new Map<number, SenderState>()
  private readonly retiredSenders = new WeakSet<WebContents>()
  private nextConnectionGeneration = 1

  constructor(private readonly runtime: CleanupRuntime) {}

  track(sender: WebContents, observedCreation = false): void {
    if (!sender.isDestroyed()) {
      this.stateFor(sender, observedCreation)
    }
  }

  connectionIdFor(sender: WebContents): string {
    return this.stateFor(sender).connectionId
  }

  beginUnaryCall(sender: WebContents): {
    connectionId: string
    signal: AbortSignal
    release: () => void
  } {
    const state = this.stateFor(sender)
    if (state.navigationPending) {
      throw new Error('Runtime RPC call cannot start during renderer document navigation')
    }
    const controller = new AbortController()
    const pending = state.unaryCalls
    pending.add(controller)
    return {
      connectionId: state.connectionId,
      signal: controller.signal,
      release: () => {
        pending.delete(controller)
      }
    }
  }

  subscriptionsFor(sender: WebContents): Map<string, AbortController> {
    return this.stateFor(sender).subscriptions
  }

  existingSubscriptionsFor(sender: WebContents): Map<string, AbortController> | null {
    const state = this.senders.get(sender.id)
    return state?.sender === sender ? state.subscriptions : null
  }

  private stateFor(sender: WebContents, observedCreation = false): SenderState {
    if (this.retiredSenders.has(sender) || sender.isDestroyed()) {
      throw new Error('Runtime sender is destroyed or replaced')
    }
    const existing = this.senders.get(sender.id)
    if (existing?.sender === sender) {
      return existing
    }
    const state: SenderState = {
      connectionId: this.mintConnectionId(sender.id),
      sender,
      subscriptions: new Map(),
      unaryCalls: new Set(),
      navigationPending: !observedCreation && sender.isLoadingMainFrame()
    }
    if (existing) {
      this.retiredSenders.add(existing.sender)
    }
    this.senders.set(sender.id, state)
    // Late registration cannot distinguish startup from an already pending document replacement.
    if (state.navigationPending) {
      sender.on('did-stop-loading', () => {
        if (!sender.isLoadingMainFrame()) {
          state.navigationPending = false
        }
      })
    }
    registerRendererDocumentNavigation(sender, () => {
      if (this.senders.get(sender.id) !== state) {
        return
      }
      state.navigationPending = true
      const pending = state.unaryCalls
      state.unaryCalls = new Set()
      for (const controller of pending) {
        controller.abort()
      }
      pending.clear()
      return () => {
        state.navigationPending = false
      }
    })
    const retireDocument = (): void => this.retire(state, false)
    sender.on('did-navigate', retireDocument)
    sender.on('render-process-gone', retireDocument)
    sender.once('destroyed', () => this.retire(state, true))
    if (existing) {
      this.abortRetiredGeneration(existing)
    }
    if (this.senders.get(sender.id) !== state || this.retiredSenders.has(sender)) {
      throw new Error('Runtime sender was replaced during registration')
    }
    return state
  }

  private retire(state: SenderState, destroyed: boolean): void {
    if (this.senders.get(state.sender.id) !== state) {
      return
    }
    if (destroyed) {
      this.retiredSenders.add(state.sender)
      this.senders.delete(state.sender.id)
    }
    state.navigationPending = false
    this.abortRetiredGeneration(state)
  }

  private abortRetiredGeneration(state: SenderState): void {
    const retiredConnectionId = state.connectionId
    const subscriptions = state.subscriptions
    const unaryCalls = state.unaryCalls
    // Abort listeners may register work synchronously in the replacement generation.
    state.connectionId = this.mintConnectionId(state.sender.id)
    state.subscriptions = new Map()
    state.unaryCalls = new Set()
    for (const controller of subscriptions.values()) {
      controller.abort()
    }
    subscriptions.clear()
    for (const controller of unaryCalls) {
      controller.abort()
    }
    unaryCalls.clear()
    this.runtime.cleanupSubscriptionsForConnection(retiredConnectionId)
  }

  private mintConnectionId(senderId: number): string {
    return `desktop-renderer:${senderId}:${this.nextConnectionGeneration++}`
  }
}
