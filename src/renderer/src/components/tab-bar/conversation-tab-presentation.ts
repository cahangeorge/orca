import type { TerminalTabActivityStatus } from './terminal-tab-activity-status'
import {
  isConversationWorkPhase,
  type ConversationWorkPhase
} from '../../../../shared/conversation-work-phase'
import { translate } from '@/i18n/i18n'

export function conversationWorkPhaseLabel(phase: ConversationWorkPhase | undefined): string {
  switch (phase) {
    case 'analysis':
      return translate('conversation.phase.analysis', 'Analysis / exploration')
    case 'planning':
      return translate('conversation.phase.planning', 'Planning')
    case 'implementation':
      return translate('conversation.phase.implementation', 'Implementation')
    case 'verification':
      return translate('conversation.phase.verification', 'Testing / verification')
    case 'finalized':
      return translate('conversation.phase.finalized', 'Objective finalized')
    case undefined:
      return translate('conversation.phase.unknown', 'Unknown phase')
  }
}

export function resolveConversationTabPresentation(args: {
  covered: boolean
  color: string | null
  manualWorkPhase?: ConversationWorkPhase | null
  automaticWorkPhase?: unknown
  automaticBackgroundEnabled: boolean
}): { phase: ConversationWorkPhase | undefined; backgroundColor?: string; color?: string } {
  if (!args.covered) {
    return { phase: undefined }
  }
  const phase =
    (isConversationWorkPhase(args.manualWorkPhase) ? args.manualWorkPhase : undefined) ??
    (args.automaticBackgroundEnabled && isConversationWorkPhase(args.automaticWorkPhase)
      ? args.automaticWorkPhase
      : undefined)
  return {
    phase,
    ...(args.color
      ? {
          backgroundColor: `color-mix(in srgb, ${args.color} 12%, var(--background))`,
          color: 'var(--foreground)'
        }
      : phase
        ? {
            backgroundColor: `var(--conversation-phase-${phase}-surface)`,
            color: `var(--conversation-phase-${phase}-foreground)`
          }
        : {})
  }
}

export function conversationActivityLabel(status: TerminalTabActivityStatus): string {
  switch (status) {
    case 'working':
      return translate('conversation.status.working', 'Working')
    case 'monitoring':
      return translate('conversation.status.monitoring', 'Monitoring')
    case 'permission':
      return translate('conversation.status.waiting', 'Waiting for input')
    case 'done':
      return translate('conversation.status.done', 'Response finished')
    case 'failed':
      return translate('conversation.status.failed', 'Failed')
    case 'interrupted':
      return translate('conversation.status.interrupted', 'Interrupted')
    case 'active':
    case 'inactive':
      return translate('conversation.status.idle', 'Idle / unknown')
  }
}

export function conversationPhaseTooltip(
  phase: ConversationWorkPhase | undefined,
  status: TerminalTabActivityStatus,
  lastKnown: boolean
): string {
  const parts = [conversationWorkPhaseLabel(phase), conversationActivityLabel(status)]
  if (lastKnown) {
    parts.push(translate('conversation.phase.lastKnown', 'Last known phase'))
  }
  if (phase === 'verification') {
    parts.push(
      translate('conversation.phase.verificationMeaning', 'Phase color does not mean checks passed')
    )
  }
  return parts.join(' · ')
}
