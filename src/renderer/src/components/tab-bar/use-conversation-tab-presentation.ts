import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { useAppStore } from '@/store'
import { useConversationTabPhase } from './use-conversation-tab-phase'
import {
  conversationPhaseTooltip,
  resolveConversationTabPresentation
} from './conversation-tab-presentation'
import type { TerminalTabActivityStatus } from './terminal-tab-activity-status'

export function useConversationTabPresentation(
  tab: TerminalTab,
  sessionId: string | undefined,
  agent: TuiAgent | null,
  activityStatus: TerminalTabActivityStatus
) {
  const evidence = useConversationTabPhase(tab.worktreeId, sessionId)
  const automaticBackgroundEnabled = useAppStore(
    (state) => state.settings?.tabAutoPhaseBackground !== false
  )
  const statusIconEnabled = useAppStore((state) => state.settings?.tabAgentStatusIcon !== false)
  const presentation = resolveConversationTabPresentation({
    covered: agent === 'codex',
    color: tab.color,
    manualWorkPhase: tab.manualWorkPhase,
    automaticWorkPhase: evidence.phase,
    automaticBackgroundEnabled
  })
  const visibleActivityStatus =
    agent === 'codex' && sessionId && evidence.observation === 'unverifiable'
      ? 'inactive'
      : activityStatus
  const phaseTooltip = conversationPhaseTooltip(
    presentation.phase,
    visibleActivityStatus,
    evidence.observation === 'unverifiable' && !!evidence.phase && !tab.manualWorkPhase
  )
  return { presentation, statusIconEnabled, visibleActivityStatus, phaseTooltip }
}
