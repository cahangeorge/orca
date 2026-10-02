import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/structured-agent-session-status-feed'

/** Phase belongs to the execution host's scoped session feed, never terminal prose. */
export function useConversationTabPhase(worktreeId: string, sessionId?: string) {
  const environmentId = useAppStore((state) =>
    getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  )
  const feed = useMemo(
    () =>
      getStructuredAgentSessionStatusFeed(
        getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId })
      ),
    [environmentId]
  )
  useEffect(() => (sessionId ? feed.activate() : undefined), [feed, sessionId])
  const phase = useSyncExternalStore(
    feed.subscribe,
    () => {
      const summary = sessionId ? feed.getSnapshot().get(sessionId) : undefined
      return summary?.workspaceId === worktreeId && summary.agent === 'codex'
        ? summary.workPhase?.phase
        : undefined
    },
    () => undefined
  )
  const observation = useSyncExternalStore(
    feed.subscribe,
    () => {
      const summary = sessionId ? feed.getSnapshot().get(sessionId) : undefined
      return sessionId &&
        summary?.workspaceId === worktreeId &&
        summary.agent === 'codex' &&
        summary.hostExecutionOwned
        ? feed.getSessionObservation(sessionId)
        : 'unverifiable'
    },
    () => 'unverifiable' as const
  )
  return { phase, observation }
}
