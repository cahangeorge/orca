import { z } from 'zod'
import { decisionShadowLaneChoice, validateDecisionShadowAnswers } from './decision-shadow-types'
import type {
  DecisionPreflightDraft,
  DecisionPreflightScope,
  DecisionPreflightSkipReason,
  DecisionPreflightSuggestion
} from './decision-preflight-types'

const identifier = z.string().min(1).max(256).regex(/^\S+$/u)
const nonnegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger)
const scopeSchema = z
  .object({
    draftId: identifier,
    workspaceId: identifier,
    revision: nonnegativeInteger,
    choicesVersion: identifier
  })
  .strict()
const laneSchema = z.object({ model: identifier, effort: identifier }).strict()
const draftSchema = z
  .object({
    scope: scopeSchema,
    target: z.enum(['local', 'remote', 'web', 'mobile']),
    agent: z.enum(['codex', 'claude']),
    conversation: z.enum(['new', 'active', 'resume']),
    text: z
      .string()
      .max(4096)
      .refine((text) => text.trim().length > 0),
    attachmentCount: nonnegativeInteger,
    selfContained: z.boolean(),
    inputTruncated: z.boolean(),
    availableLanes: z
      .array(laneSchema)
      .max(7)
      .refine((lanes) => new Set(lanes.map(decisionShadowLaneChoice)).size === lanes.length),
    explicitSelection: laneSchema.optional()
  })
  .strict()
const suggestionSchema = z.object({ scope: scopeSchema, answers: z.unknown() }).strict()

export function parseDecisionPreflightDraft(value: unknown): DecisionPreflightDraft | undefined {
  const parsed = draftSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function decisionPreflightExclusion(
  draft: DecisionPreflightDraft
): DecisionPreflightSkipReason | undefined {
  if (draft.target !== 'local') {
    return 'unsupported_target'
  }
  if (draft.agent !== 'codex') {
    return 'unsupported_agent'
  }
  if (draft.conversation !== 'new') {
    return 'existing_conversation'
  }
  if (draft.attachmentCount > 0) {
    return 'attachments'
  }
  if (/^\s*(?:\/|\$[a-z][\w-]*)/iu.test(draft.text)) {
    return 'command'
  }
  if (draft.inputTruncated) {
    return 'truncated'
  }
  if (
    !draft.selfContained ||
    /^\s*(?:continue|continu[ăa]|resume|same as|as above|see (?:above|previous))(?=\s|$|[.,;:!?])/iu.test(
      draft.text
    )
  ) {
    return 'needs_context'
  }
  if (!draft.availableLanes.length) {
    return 'no_available_lane'
  }
  if (
    draft.explicitSelection &&
    !draft.availableLanes.some(
      (lane) =>
        lane.model === draft.explicitSelection?.model &&
        lane.effort === draft.explicitSelection?.effort
    )
  ) {
    return 'invalid_selection'
  }
  return undefined
}

export function decisionPreflightScopesEqual(
  left: DecisionPreflightScope,
  right: DecisionPreflightScope
): boolean {
  return (
    left.draftId === right.draftId &&
    left.workspaceId === right.workspaceId &&
    left.revision === right.revision &&
    left.choicesVersion === right.choicesVersion
  )
}

export function validateDecisionPreflightSuggestion(
  value: unknown,
  currentDraft: unknown
): DecisionPreflightSuggestion | undefined {
  const draft = parseDecisionPreflightDraft(currentDraft)
  const parsed = suggestionSchema.safeParse(value)
  if (
    !draft ||
    !parsed.success ||
    draft.explicitSelection ||
    decisionPreflightExclusion(draft) ||
    !decisionPreflightScopesEqual(parsed.data.scope, draft.scope)
  ) {
    return undefined
  }
  const answers = validateDecisionShadowAnswers(parsed.data.answers, [
    ...draft.availableLanes.map(decisionShadowLaneChoice),
    'needs_context'
  ])
  return answers ? { scope: parsed.data.scope, answers, calibration: 'uncalibrated' } : undefined
}
