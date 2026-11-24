import type { DecisionPreflightRulesResult } from './decision-preflight-types'
import {
  decisionPreflightExclusion,
  parseDecisionPreflightDraft
} from './decision-preflight-validation'

export function evaluateDecisionPreflightRules(value: unknown): DecisionPreflightRulesResult {
  const draft = parseDecisionPreflightDraft(value)
  if (!draft) {
    return { state: 'skipped', reason: 'invalid_input' }
  }
  const reason = decisionPreflightExclusion(draft)
  if (reason) {
    return { state: 'skipped', scope: draft.scope, reason }
  }
  if (draft.explicitSelection) {
    return { state: 'selected', scope: draft.scope, selection: draft.explicitSelection }
  }
  return { state: 'needs_context', scope: draft.scope, reason: 'unresolved' }
}
