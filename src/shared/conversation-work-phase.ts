import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { isRootAgentJournalItem } from './agent-session-journal-producer'

export const CONVERSATION_WORK_PHASES = [
  'analysis',
  'planning',
  'implementation',
  'verification',
  'finalized'
] as const
export type ConversationWorkPhase = (typeof CONVERSATION_WORK_PHASES)[number]
export type ConversationWorkPhaseEvidence = {
  phase: ConversationWorkPhase
  source: 'journal-tool' | 'journal-plan' | 'journal-diff' | 'journal-goal'
  itemId: string
  sequence: number
}

export function isConversationWorkPhase(value: unknown): value is ConversationWorkPhase {
  return CONVERSATION_WORK_PHASES.some((phase) => phase === value)
}

function commandPhase(input: unknown): ConversationWorkPhase | undefined {
  if (
    !input ||
    typeof input !== 'object' ||
    !('command' in input) ||
    typeof input.command !== 'string'
  ) {
    return undefined
  }
  const command = input.command.trim()
  // Compound shell expressions and quoted payloads are not evidence of a check starting.
  if (/[;&|`\n<>]|\$\(/.test(command)) {
    return undefined
  }
  if (
    /^(?:(?:pnpm|npm|bun) (?:run )?(?:test(?::[\w-]+)?|tc(?::[\w-]+)?|typecheck|lint|check(?::[\w-]+)?|build(?::[\w-]+)?)|(?:npx |pnpm exec |bunx )?(?:vitest|jest|playwright|pytest|tsc)|(?:cargo|go) test|python(?:3)? -m pytest)(?:\s|$)/.test(
      command
    )
  ) {
    return 'verification'
  }
  if (/^(?:rg|ls|pwd|cat|head|tail|git (?:status|diff|show|log))(?:\s|$)/.test(command)) {
    return 'analysis'
  }
  return undefined
}

const itemPhases = new WeakMap<
  AgentJournalRenderItem,
  Pick<ConversationWorkPhaseEvidence, 'phase' | 'source'> | null
>()

function itemPhase(
  item: AgentJournalRenderItem
): Pick<ConversationWorkPhaseEvidence, 'phase' | 'source'> | undefined {
  const body = item.body
  if (body.kind === 'diff' && body.editConfirmed === true) {
    return { phase: 'implementation', source: 'journal-diff' }
  }
  if (body.kind === 'status') {
    if (body.threadGoal?.state === 'set' && body.threadGoal.goal.status === 'complete') {
      return { phase: 'finalized', source: 'journal-goal' }
    }
    if (body.presentation === 'plan-document') {
      return { phase: 'planning', source: 'journal-plan' }
    }
  }
  if (body.kind !== 'tool-call') {
    return undefined
  }
  const name = body.name.replace(/^functions\./, '').toLowerCase()
  if (name === 'update_plan') {
    return { phase: 'planning', source: 'journal-plan' }
  }
  if (
    [
      'read',
      'search',
      'list',
      'web_search',
      'websearch',
      'read_file',
      'list_dir',
      'search_files'
    ].includes(name)
  ) {
    return { phase: 'analysis', source: 'journal-tool' }
  }
  if (['shell', 'exec', 'exec_command', 'commandexecution'].includes(name)) {
    const phase = commandPhase(body.input)
    return phase ? { phase, source: 'journal-tool' } : undefined
  }
  // An attempted patch alone does not prove files changed; Codex emits a diff on success.
  return undefined
}

function cachedItemPhase(item: AgentJournalRenderItem) {
  let phase = itemPhases.get(item)
  if (phase === undefined) {
    phase = itemPhase(item) ?? null
    itemPhases.set(item, phase)
  }
  return phase
}

function orderedConversationWorkPhase(
  items: readonly AgentJournalRenderItem[]
): ConversationWorkPhaseEvidence | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!isRootAgentJournalItem(item)) {
      continue
    }
    const goal = item.body.kind === 'status' ? item.body.threadGoal : undefined
    if (goal?.state === 'cleared') {
      return undefined
    }
    if (goal?.state === 'set' && goal.goal.status === 'active') {
      let previousGoal: typeof goal | { state: 'cleared' } | undefined
      for (let prior = index - 1; prior >= 0; prior--) {
        const candidate = items[prior]
        if (
          isRootAgentJournalItem(candidate) &&
          candidate.body.kind === 'status' &&
          candidate.body.threadGoal
        ) {
          previousGoal = candidate.body.threadGoal
          break
        }
      }
      if (
        previousGoal?.state !== 'set' ||
        previousGoal.goal.createdAt !== goal.goal.createdAt ||
        previousGoal.goal.objective !== goal.goal.objective ||
        previousGoal.goal.status === 'complete'
      ) {
        return undefined
      }
    }
    const phase = cachedItemPhase(item)
    if (phase) {
      return { ...phase, itemId: item.itemId, sequence: item.sequence }
    }
  }
  return undefined
}

/** Replayed reduced rows are already scoped and deduplicated by the journal owner. */
export function projectConversationWorkPhase(
  items: readonly AgentJournalRenderItem[],
  ordered = false
): ConversationWorkPhaseEvidence | undefined {
  if (ordered) {
    return orderedConversationWorkPhase(items)
  }
  let evidence: ConversationWorkPhaseEvidence | undefined
  let boundary = -1
  let goalIdentity: string | undefined
  let goalStatus: string | undefined
  let goalSequence = -1
  for (const item of items) {
    if (!isRootAgentJournalItem(item)) {
      continue
    }
    const goal = item.body.kind === 'status' ? item.body.threadGoal : undefined
    const identity =
      goal?.state === 'set' ? `${goal.goal.createdAt}:${goal.goal.objective}` : undefined
    const resetsGoal =
      goal?.state === 'cleared' ||
      (goal?.state === 'set' &&
        goal.goal.status === 'active' &&
        (identity !== goalIdentity || goalStatus === 'complete'))
    if (goal && item.sequence > goalSequence) {
      goalSequence = item.sequence
      goalIdentity = identity
      goalStatus = goal.state === 'set' ? goal.goal.status : undefined
    }
    if (resetsGoal && item.sequence >= goalSequence && item.sequence > boundary) {
      boundary = item.sequence
      if (evidence && evidence.sequence <= boundary) {
        evidence = undefined
      }
    }
    const next = cachedItemPhase(item)
    if (next && item.sequence > boundary && (!evidence || item.sequence > evidence.sequence)) {
      evidence = { ...next, itemId: item.itemId, sequence: item.sequence }
    }
  }
  return evidence
}
