/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session-wire'
import { useConversationTabPhase } from './use-conversation-tab-phase'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const host = vi.hoisted(
  (): {
    sessions: Map<string, AgentSessionStatusSummary>
    listeners: Set<() => void>
    observation: 'live' | 'unverifiable'
  } => ({
    sessions: new Map<string, AgentSessionStatusSummary>(),
    listeners: new Set<() => void>(),
    observation: 'live'
  })
)
vi.mock('@/store', () => ({ useAppStore: (selector: (state: object) => unknown) => selector({}) }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => 'host-A'
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({ getActiveRuntimeTarget: () => 'host-A' }))
vi.mock('@/runtime/structured-agent-session-status-feed', () => ({
  getStructuredAgentSessionStatusFeed: () => ({
    activate: () => () => {},
    subscribe: (listener: () => void) => {
      host.listeners.add(listener)
      return () => host.listeners.delete(listener)
    },
    getSnapshot: () => host.sessions,
    getSessionObservation: () => host.observation
  })
}))
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    act(cleanup)
  }
  host.sessions.clear()
  host.listeners.clear()
  host.observation = 'live'
})
function summary(sessionId: string, workspaceId = 'folder'): AgentSessionStatusSummary {
  return {
    sessionId,
    workspaceId,
    agent: 'codex',
    hostExecutionOwned: true,
    status: 'working',
    latestPrompt: '',
    updatedAt: 1,
    workPhase: { phase: 'analysis', source: 'journal-tool', sequence: 1, itemId: 'read' }
  }
}
function publish() {
  act(() => {
    for (const listener of host.listeners) {
      listener()
    }
  })
}

describe('host scoped conversation tab phase selector', () => {
  it('isolates session updates and retains last phase on disconnection', () => {
    host.sessions.set('A', summary('A'))
    host.sessions.set('B', summary('B'))
    const renders = { A: 0, B: 0 }
    function View({ sessionId }: { sessionId: 'A' | 'B' }) {
      renders[sessionId]++
      const evidence = useConversationTabPhase('folder', sessionId)
      return (
        <div data-session={sessionId}>
          {evidence.phase}:{evidence.observation}
        </div>
      )
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() =>
      root.render(
        <>
          <View sessionId="A" />
          <View sessionId="B" />
        </>
      )
    )
    cleanups.push(() => root.unmount())
    const initialB = renders.B
    host.sessions.set('A', {
      ...summary('A'),
      workPhase: { phase: 'implementation', source: 'journal-diff', sequence: 2, itemId: 'edit' }
    })
    publish()
    expect(container.querySelector('[data-session="A"]')?.textContent).toBe('implementation:live')
    expect(renders.B).toBe(initialB)
    host.observation = 'unverifiable'
    publish()
    expect(container.querySelector('[data-session="A"]')?.textContent).toBe(
      'implementation:unverifiable'
    )
    host.observation = 'live'
    const restored = summary('A')
    delete restored.hostExecutionOwned
    host.sessions.set('A', restored)
    publish()
    expect(container.querySelector('[data-session="A"]')?.textContent).toBe('analysis:unverifiable')
    host.sessions.set('A', summary('A', 'other-folder'))
    publish()
    expect(container.querySelector('[data-session="A"]')?.textContent).toBe(':unverifiable')
  })
})
