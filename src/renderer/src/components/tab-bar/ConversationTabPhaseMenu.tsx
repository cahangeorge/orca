import {
  CONVERSATION_WORK_PHASES,
  type ConversationWorkPhase
} from '../../../../shared/conversation-work-phase'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { conversationWorkPhaseLabel } from './conversation-tab-presentation'

export function ConversationTabPhaseMenu({
  unifiedTabId,
  manualWorkPhase
}: {
  unifiedTabId: string
  manualWorkPhase?: ConversationWorkPhase | null
}) {
  const setPhase = useAppStore((state) => state.setTabManualWorkPhase)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          setPhase(unifiedTabId, null)
        }}
      >
        {translate('conversation.phase.automatic', 'Automatic (reset phase and color)')}
      </DropdownMenuItem>
      {CONVERSATION_WORK_PHASES.map((phase) => (
        <DropdownMenuItem key={phase} onSelect={() => setPhase(unifiedTabId, phase)}>
          {conversationWorkPhaseLabel(phase)}
          {manualWorkPhase === phase ? ' ✓' : ''}
        </DropdownMenuItem>
      ))}
    </>
  )
}
