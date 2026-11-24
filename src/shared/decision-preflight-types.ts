import type { DecisionShadowAnswers, DecisionShadowLane } from './decision-shadow-types'

export type DecisionPreflightScope = {
  draftId: string
  workspaceId: string
  revision: number
  choicesVersion: string
}
export type DecisionPreflightDraft = {
  scope: DecisionPreflightScope
  target: 'local' | 'remote' | 'web' | 'mobile'
  agent: 'codex' | 'claude'
  conversation: 'new' | 'active' | 'resume'
  text: string
  attachmentCount: number
  selfContained: boolean
  inputTruncated: boolean
  availableLanes: readonly DecisionShadowLane[]
  explicitSelection?: DecisionShadowLane
}
export type DecisionPreflightSkipReason =
  | 'invalid_input'
  | 'unsupported_target'
  | 'unsupported_agent'
  | 'existing_conversation'
  | 'attachments'
  | 'command'
  | 'truncated'
  | 'needs_context'
  | 'no_available_lane'
  | 'invalid_selection'
export type DecisionPreflightRulesResult =
  | { state: 'skipped'; scope?: DecisionPreflightScope; reason: DecisionPreflightSkipReason }
  | { state: 'selected'; scope: DecisionPreflightScope; selection: DecisionShadowLane }
  | { state: 'needs_context'; scope: DecisionPreflightScope; reason: 'unresolved' }
export type DecisionPreflightSuggestion = {
  scope: DecisionPreflightScope
  answers: DecisionShadowAnswers
  calibration: 'uncalibrated'
}
