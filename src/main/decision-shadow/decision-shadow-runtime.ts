import { createDecisionShadowProviderForEnvironment } from './opendecider-shadow-provider'
import { randomUUID } from 'node:crypto'
import {
  agentSessionLeaseAdmitsWriter,
  isAgentSessionFenceCurrent
} from '../../shared/agent-session-lease-adjudication'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AgentSessionStatusSummary } from '../../shared/agent-session-wire'
import type { DecisionShadowScope } from '../../shared/decision-shadow-types'
import type { CodexDecisionShadowHooks } from '../codex/codex-decision-shadow'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { DecisionShadowObserver } from './decision-shadow-observer'
import type { DecisionShadowProvider } from './decision-shadow-provider'

const runtimes = new WeakMap<StructuredAgentSessionHost, DecisionShadowRuntime>()
export function installDecisionShadowRuntime(
  host: StructuredAgentSessionHost,
  provider: DecisionShadowProvider = createDecisionShadowProviderForEnvironment()
): DecisionShadowRuntime {
  const runtime = new DecisionShadowRuntime(host, provider)
  runtimes.set(host, runtime)
  return runtime
}
export function decisionShadowRuntimeFor(
  host: StructuredAgentSessionHost
): DecisionShadowRuntime | undefined {
  return runtimes.get(host)
}

type DecisionShadowHost = Pick<StructuredAgentSessionHost, 'subscribeStatus'> & {
  deps: { store: Pick<StructuredAgentSessionHost['deps']['store'], 'getRecord'> }
}

export class DecisionShadowRuntime {
  private readonly observer: DecisionShadowObserver
  private readonly scopes = new Map<string, DecisionShadowScope>()
  private unsubscribe?: () => void
  constructor(
    private readonly host: DecisionShadowHost,
    provider: DecisionShadowProvider
  ) {
    this.observer = new DecisionShadowObserver(provider)
  }

  readonly hooks: CodexDecisionShadowHooks = {
    observe: (input) => {
      const scope = this.scopes.get(input.sessionId)
      if (
        !scope ||
        !this.observer.isEnabled(scope) ||
        scope.generation !== input.generation ||
        scope.fence !== input.fence
      ) {
        return
      }
      this.observer.observe({ ...input, ownerId: scope.ownerId })
    },
    update: (identity, clientMessageId, metadata) => {
      const scope = this.scopes.get(identity.sessionId)
      if (scope?.generation === identity.generation && scope.fence === identity.fence) {
        this.observer.update(scope, clientMessageId, metadata)
      }
    },
    cancel: (identity, reason) => {
      const scope = this.scopes.get(identity.sessionId)
      if (scope?.generation === identity.generation && scope.fence === identity.fence) {
        this.observer.cancel(scope, reason)
      }
      this.stopSubscriptionIfOff()
    }
  }

  configure(sessionId: string, ownerId: string, enabled: boolean): boolean {
    const previous = this.scopes.get(sessionId)
    if (previous && previous.ownerId !== ownerId) {
      return false
    }
    if (!enabled) {
      if (previous) {
        this.observer.cancel(previous, 'off')
      }
      this.stopSubscriptionIfOff()
      return true
    }
    const scope = this.resolveScope(sessionId, ownerId)
    if (!scope || !this.observer.configure(scope, true)) {
      return false
    }
    if (this.scopes.size >= 200 && !this.scopes.has(sessionId)) {
      const oldest = [...this.scopes].find(([, item]) => !this.observer.isEnabled(item))
      if (oldest) {
        this.scopes.delete(oldest[0])
      }
    }
    this.scopes.set(sessionId, scope)
    this.startSubscription()
    return true
  }

  read(sessionId: string, ownerId: string) {
    const scope = this.scopes.get(sessionId)
    if (!scope || scope.ownerId !== ownerId) {
      return { mode: 'off' as const, observations: [] }
    }
    return {
      mode: this.observer.isEnabled(scope) ? ('shadow' as const) : ('off' as const),
      observations: this.observer.read(scope)
    }
  }

  private resolveScope(sessionId: string, ownerId: string): DecisionShadowScope | undefined {
    let scope: DecisionShadowScope | undefined
    const unsubscribe = this.host.subscribeStatus({
      id: `decision-shadow-read-${randomUUID()}`,
      emit: (event) => {
        const summaries =
          event.type === 'snapshot'
            ? event.sessions
            : event.type === 'status'
              ? [event.session]
              : []
        const summary = summaries.find((item) => item.sessionId === sessionId)
        if (summary) {
          scope = this.scopeFor(summary, ownerId)
        }
      }
    })
    unsubscribe()
    return scope
  }

  private scopeFor(
    summary: AgentSessionStatusSummary,
    ownerId: string
  ): DecisionShadowScope | undefined {
    const record = this.host.deps.store.getRecord(summary.sessionId)
    const child = summary.hostExecutionChild
    if (
      !record ||
      record.provider !== 'codex' ||
      summary.agent !== 'codex' ||
      !summary.hostExecutionOwned ||
      !child?.generation ||
      record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
      record.location.wslDistro !== null ||
      record.lease.runtimeKind !== 'native' ||
      !agentSessionLeaseAdmitsWriter(record.lease) ||
      !isAgentSessionFenceCurrent(record.lease, child.fence)
    ) {
      return
    }
    return {
      sessionId: summary.sessionId,
      ownerId,
      generation: child.generation,
      fence: child.fence
    }
  }

  private startSubscription(): void {
    if (this.unsubscribe) {
      return
    }
    this.unsubscribe = this.host.subscribeStatus({
      id: `decision-shadow-${randomUUID()}`,
      emit: (event) => {
        if (event.type === 'end') {
          for (const scope of this.scopes.values()) {
            this.observer.cancel(scope, 'close')
          }
          queueMicrotask(() => this.stopSubscriptionIfOff())
          return
        }
        const summaries = event.type === 'snapshot' ? event.sessions : [event.session]
        for (const summary of summaries) {
          const previous = this.scopes.get(summary.sessionId)
          if (!previous || !this.observer.isEnabled(previous)) {
            continue
          }
          const current = this.scopeFor(summary, previous.ownerId)
          if (
            !current ||
            current.generation !== previous.generation ||
            current.fence !== previous.fence
          ) {
            this.observer.cancel(previous, current ? 'replacement' : 'close')
            queueMicrotask(() => this.stopSubscriptionIfOff())
          }
        }
      }
    })
  }

  private stopSubscriptionIfOff(): void {
    if ([...this.scopes.values()].some((scope) => this.observer.isEnabled(scope))) {
      return
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
