export const DECISION_SHADOW_CATEGORIES = [
  'docs',
  'implementation',
  'debugging',
  'research',
  'review',
  'needs_context'
] as const
export const DECISION_SHADOW_POLICY_VERSION = 'shadow-1'
export type DecisionShadowScope = {
  sessionId: string
  ownerId: string
  generation: string
  fence: number
}
export type DecisionShadowLane = { model: string; effort: string }
export type DecisionShadowDispatch = {
  clientMessageId: string
  text: string
  context?: string
  availableLanes: DecisionShadowLane[]
  choicesVersion: string
  requested?: DecisionShadowLane
  reported?: DecisionShadowLane
  turnId?: string
  deliveryState: 'dispatched' | 'admitted' | 'acknowledged' | 'rejected' | 'unknown'
  activeTurn: boolean
  autonomous: boolean
  inputTruncated?: boolean
} & DecisionShadowScope
export type DecisionShadowAnswer = {
  choice: string
  confidence?: number
  probabilities?: Record<string, number>
}
export type DecisionShadowAnswers = {
  task_category: DecisionShadowAnswer
  execution_lane: DecisionShadowAnswer
}
export type DecisionShadowReason =
  | 'active_turn'
  | 'command'
  | 'needs_context'
  | 'truncated'
  | 'no_available_lane'
  | 'queue_full'
  | 'invalid_response'
  | 'provider_unavailable'
  | 'deadline'
  | 'off'
  | 'stop'
  | 'close'
  | 'replacement'
export type DecisionShadowObservation = {
  schemaVersion: 1
  decisionId: string
  clientMessageId: string
  choicesVersion: string
  policyVersion: string
  inputDigest: string
  inputTruncated: boolean
  calibration: 'uncalibrated'
  provider: string
  modelRevision: string
  createdAt: number
  latencyMs?: number
  state:
    | 'pending'
    | 'available'
    | 'needs_context'
    | 'skipped'
    | 'unavailable'
    | 'expired'
    | 'cancelled'
  reason?: DecisionShadowReason
  answers?: DecisionShadowAnswers
  requested?: DecisionShadowLane
  reported?: DecisionShadowLane
  turnId?: string
  deliveryState: DecisionShadowDispatch['deliveryState']
} & DecisionShadowScope
export function decisionShadowLaneChoice(lane: DecisionShadowLane): string {
  return JSON.stringify([lane.model, lane.effort])
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function score(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}
function answer(value: unknown, choices: readonly string[]): DecisionShadowAnswer | undefined {
  if (!record(value) || typeof value.choice !== 'string' || !choices.includes(value.choice)) {
    return
  }
  if (value.truncated === true) {
    return
  }
  if (value.confidence !== undefined && !score(value.confidence)) {
    return
  }
  let probabilities: Record<string, number> | undefined
  if (value.probabilities !== undefined) {
    if (
      !record(value.probabilities) ||
      Object.keys(value.probabilities).length !== choices.length
    ) {
      return
    }
    probabilities = {}
    let sum = 0
    for (const choice of choices) {
      const probability = value.probabilities[choice]
      if (!score(probability)) {
        return
      }
      probabilities[choice] = probability
      sum += probability
    }
    if (Math.abs(sum - 1) > 0.0001) {
      return
    }
  }
  return {
    choice: value.choice,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
    ...(probabilities ? { probabilities } : {})
  }
}
export function validateDecisionShadowAnswers(
  value: unknown,
  laneChoices: readonly string[]
): DecisionShadowAnswers | undefined {
  if (!record(value)) {
    return
  }
  const task_category = answer(value.task_category, DECISION_SHADOW_CATEGORIES)
  const execution_lane = answer(value.execution_lane, laneChoices)
  return task_category && execution_lane ? { task_category, execution_lane } : undefined
}

export function decisionShadowScopesEqual(a: DecisionShadowScope, b: DecisionShadowScope): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.ownerId === b.ownerId &&
    a.generation === b.generation &&
    a.fence === b.fence
  )
}
export function decisionShadowScopeKey(scope: DecisionShadowScope): string {
  return JSON.stringify([scope.sessionId, scope.ownerId, scope.generation, scope.fence])
}
export function isDecisionShadowScope(scope: DecisionShadowScope): boolean {
  return Boolean(
    scope.sessionId &&
    scope.ownerId &&
    scope.generation &&
    Number.isSafeInteger(scope.fence) &&
    scope.fence >= 0
  )
}
