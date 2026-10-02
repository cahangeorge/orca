import type { ConversationWorkPhase } from '../../../../../shared/conversation-work-phase'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import { patchTab, findTabAndWorktree } from '../tab-group-state'
import { patchTerminalTabRow } from './tabs-host-mirroring'
import type { TabsSliceGet, TabsSliceSet } from './tabs-slice-contract'

export function createTabWorkPhaseAction(set: TabsSliceSet, get: TabsSliceGet) {
  return (tabId: string, manualWorkPhase: ConversationWorkPhase | null): void => {
    const found = findTabAndWorktree(get().unifiedTabsByWorktree, tabId)
    if (
      !found ||
      (found.tab.contentType !== 'terminal' && found.tab.contentType !== 'agent-session')
    ) {
      return
    }
    const patch = { manualWorkPhase, ...(manualWorkPhase === null ? { color: null } : {}) }
    set((state) => ({
      ...patchTab(state.unifiedTabsByWorktree, tabId, patch),
      ...patchTerminalTabRow(state.tabsByWorktree, found.tab.entityId, patch)
    }))
    if (resolveTerminalWorktreeRoute(get(), found.worktreeId)?.runtimeEnvironmentId) {
      void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
        setWebRuntimeTabProps({ worktreeId: found.worktreeId, tabId, ...patch })
      )
    }
  }
}
