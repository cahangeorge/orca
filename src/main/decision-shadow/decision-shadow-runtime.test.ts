import { describe, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import type {
  AgentSessionStatusEvent,
  AgentSessionStatusSummary
} from '../../shared/agent-session-wire'
import type { StructuredAgentSessionStatusSubscriber } from '../native-chat/agent-session-wire/structured-agent-session-status-feed'
import { DecisionShadowRuntime } from './decision-shadow-runtime'
import { createSimulatedDecisionShadowProvider } from './decision-shadow-provider'
const summary: AgentSessionStatusSummary = {
  sessionId: 'session-alpha-1',
  workspaceId: 'workspace-1',
  agent: 'codex',
  status: 'idle',
  latestPrompt: '',
  updatedAt: 1,
  hostExecutionOwned: true,
  hostExecutionPhase: 'ready',
  hostExecutionChild: { generation: 'opaque-uuid', fence: 7 }
}
function rig() {
  const record = agentSessionRecordFixture()
  record.provider = 'codex'
  const subscriptions = new Map<string, StructuredAgentSessionStatusSubscriber>()
  const host = {
    deps: { store: { getRecord: () => record } },
    subscribeStatus: vi.fn((subscriber: StructuredAgentSessionStatusSubscriber) => {
      subscriptions.set(subscriber.id, subscriber)
      subscriber.emit({ type: 'snapshot', sessions: [summary] })
      return () => {
        subscriptions.delete(subscriber.id)
      }
    })
  }
  return {
    record,
    host,
    publish: (event: AgentSessionStatusEvent) => {
      for (const subscriber of subscriptions.values()) {
        subscriber.emit(event)
      }
    },
    subscriptions
  }
}
describe('host-authoritative shadow runtime', () => {
  it('default Off read does not subscribe or infer, and rejects foreign callers', () => {
    const { host } = rig()
    const runtime = new DecisionShadowRuntime(host, createSimulatedDecisionShadowProvider())
    expect(runtime.read(summary.sessionId, 'desktop-renderer')).toEqual({
      mode: 'off',
      observations: []
    })
    expect(host.subscribeStatus).not.toHaveBeenCalled()
    expect(runtime.configure(summary.sessionId, 'desktop-renderer', true)).toBe(true)
    expect(runtime.configure(summary.sessionId, 'other', false)).toBe(false)
    expect(runtime.read(summary.sessionId, 'other')).toEqual({ mode: 'off', observations: [] })
    runtime.configure(summary.sessionId, 'desktop-renderer', false)
  })
  it.each(['ssh', 'wsl', 'claude', 'unproven', 'fence', 'missing-generation'])(
    'refuses ineligible host state %s',
    (kind) => {
      const { host, record } = rig()
      if (kind === 'ssh') {
        record.location.executionHostId = 'ssh:remote'
      }
      if (kind === 'wsl') {
        record.location.wslDistro = 'Ubuntu'
      }
      if (kind === 'claude') {
        record.provider = 'claude'
      }
      if (kind === 'unproven') {
        record.lease.claimStatus = 'reserved'
      }
      if (kind === 'fence') {
        record.lease.runtimeFence = 8
      }
      if (kind === 'missing-generation') {
        host.subscribeStatus.mockImplementation((subscriber) => {
          subscriber.emit({
            type: 'snapshot',
            sessions: [{ ...summary, hostExecutionChild: { generation: null, fence: 7 } }]
          })
          return () => {}
        })
      }
      const runtime = new DecisionShadowRuntime(host, createSimulatedDecisionShadowProvider())
      expect(runtime.configure(summary.sessionId, 'desktop-renderer', true)).toBe(false)
    }
  )
  it('cancels pending work on status replacement and drops late answers', async () => {
    const { host, publish, subscriptions } = rig()
    let resolve: ((answer: unknown) => void) | undefined
    let signal: AbortSignal | undefined
    const runtime = new DecisionShadowRuntime(host, {
      id: 'simulated-fixture',
      modelRevision: 'test',
      evaluate: (_input, abort) => {
        signal = abort
        return new Promise((done) => {
          resolve = done
        })
      }
    })
    runtime.configure(summary.sessionId, 'desktop-renderer', true)
    runtime.hooks.observe({
      sessionId: summary.sessionId,
      generation: 'opaque-uuid',
      fence: 7,
      clientMessageId: 'message',
      text: 'Implement bounded cancellation handling',
      availableLanes: [{ model: 'actual', effort: 'medium' }],
      choicesVersion: 'catalog-1',
      activeTurn: false,
      autonomous: true,
      deliveryState: 'dispatched'
    })
    await Promise.resolve()
    publish({
      type: 'status',
      session: { ...summary, hostExecutionChild: { generation: 'replacement-uuid', fence: 7 } }
    })
    expect(signal?.aborted).toBe(true)
    resolve?.({ task_category: { choice: 'docs' }, execution_lane: { choice: 'needs_context' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.read(summary.sessionId, 'desktop-renderer').mode).toBe('off')
    expect(runtime.read(summary.sessionId, 'desktop-renderer').observations[0].state).toBe(
      'cancelled'
    )
    expect(subscriptions.size).toBe(0)
  })
})
