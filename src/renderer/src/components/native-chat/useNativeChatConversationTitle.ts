import { useEffect, useRef } from 'react'
import { deriveNativeChatConversationTitle } from '../../../../shared/native-chat-conversation-title'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { readStructuredAgentSessionConversationOutline } from '@/runtime/structured-agent-session-client'
import { useAppStore } from '@/store'
import { patchTab } from '@/store/slices/tab-group-state'
import type { StructuredTab } from './structured-agent-session-tabs'

export function useNativeChatConversationTitle(
  tab: StructuredTab,
  target: RuntimeClientTarget,
  enabled: boolean,
  hasConversation: boolean,
  latestPrompt: string | undefined
): void {
  const resolved = useRef<RuntimeClientTarget | null>(null)
  useEffect(() => {
    if (
      !enabled ||
      !hasConversation ||
      tab.customLabel?.trim() ||
      tab.quickCommandLabel?.trim() ||
      resolved.current === target
    ) {
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retried = false
    const read = () => {
      void readStructuredAgentSessionConversationOutline(target, tab.entityId)
        .then((outline) => {
          if (cancelled || !outline || outline.sessionId !== tab.entityId) {
            return
          }
          const generatedLabel = deriveNativeChatConversationTitle(outline)
          if (!generatedLabel) {
            return
          }
          let accepted = false
          useAppStore.setState((state) => {
            const current = state.unifiedTabsByWorktree[tab.worktreeId]?.find(
              (candidate) => candidate.id === tab.id && candidate.entityId === tab.entityId
            )
            if (
              !current ||
              current.customLabel?.trim() ||
              current.quickCommandLabel?.trim() ||
              state.settings?.tabAutoGenerateTitle !== true
            ) {
              return state
            }
            accepted = true
            return patchTab(state.unifiedTabsByWorktree, tab.id, { generatedLabel }) ?? state
          })
          if (accepted) {
            resolved.current = target
          }
        })
        .catch(() => {
          if (cancelled) {
            return
          }
          console.warn('Native Chat automatic title: conversation outline read failed')
          if (!retried) {
            retried = true
            retryTimer = setTimeout(read, 1000)
          }
        })
    }
    read()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [
    enabled,
    hasConversation,
    latestPrompt,
    target,
    tab.id,
    tab.entityId,
    tab.worktreeId,
    tab.customLabel,
    tab.quickCommandLabel
  ])
}
