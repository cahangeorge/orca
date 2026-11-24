import {
  sanitizeDecisionShadowText as sanitize,
  decisionShadowExclusion as exclusion
} from './decision-shadow-input'
import { createHash, randomUUID } from 'node:crypto'
import {
  DECISION_SHADOW_CATEGORIES,
  DECISION_SHADOW_POLICY_VERSION,
  decisionShadowLaneChoice,
  decisionShadowScopesEqual as sameScope,
  decisionShadowScopeKey,
  isDecisionShadowScope,
  validateDecisionShadowAnswers,
  type DecisionShadowDispatch,
  type DecisionShadowObservation,
  type DecisionShadowReason,
  type DecisionShadowScope
} from '../../shared/decision-shadow-types'
import type {
  DecisionShadowProvider,
  DecisionShadowProviderInput
} from './decision-shadow-provider'

type Session = { scope: DecisionShadowScope; enabled: boolean; configuredAt: number }
type Pending = {
  observation: DecisionShadowObservation
  input?: DecisionShadowProviderInput
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
}
const RETENTION_MS = 7 * 86400_000
export class DecisionShadowObserver {
  private readonly sessions = new Map<string, Session>()
  private readonly retiredScopes = new Map<string, number>()
  private readonly observations: DecisionShadowObservation[] = []
  private readonly queue: Pending[] = []
  private active?: Pending
  private readonly deadlineMs: number
  private readonly maxPending: number

  constructor(
    private readonly provider: DecisionShadowProvider,
    limits: { deadlineMs?: number; maxPending?: number } = {}
  ) {
    this.deadlineMs = limits.deadlineMs ?? 5000
    this.maxPending = limits.maxPending ?? 4
    if (
      !Number.isFinite(this.deadlineMs) ||
      this.deadlineMs <= 0 ||
      !Number.isInteger(this.maxPending) ||
      this.maxPending < 0 ||
      this.maxPending > 4
    ) {
      throw new Error('Invalid decision shadow limits')
    }
  }

  configure(scope: DecisionShadowScope, enabled: boolean): boolean {
    this.prune()
    if (!isDecisionShadowScope(scope) || this.retiredScopes.has(decisionShadowScopeKey(scope))) {
      return false
    }
    const previous = this.sessions.get(scope.sessionId)
    if (!previous && this.sessions.size >= 200) {
      return false
    }
    if (previous && !sameScope(previous.scope, scope)) {
      if (previous.scope.ownerId !== scope.ownerId || scope.fence < previous.scope.fence) {
        return false
      }
      this.cancel(previous.scope, 'replacement')
      this.retiredScopes.set(decisionShadowScopeKey(previous.scope), Date.now())
      if (this.retiredScopes.size > 200) {
        const oldest = this.retiredScopes.keys().next().value
        if (oldest !== undefined) {
          this.retiredScopes.delete(oldest)
        }
      }
    }
    if (!enabled) {
      this.cancel(scope, 'off')
    }
    this.sessions.set(scope.sessionId, { scope: { ...scope }, enabled, configuredAt: Date.now() })
    return true
  }

  observe(input: DecisionShadowDispatch): boolean {
    this.prune()
    const session = this.sessions.get(input.sessionId)
    if (!session?.enabled || !sameScope(session.scope, input)) {
      return false
    }
    if (
      [
        ...this.observations,
        ...this.queue.map((job) => job.observation),
        ...(this.active ? [this.active.observation] : [])
      ].some((item) => sameScope(item, input) && item.clientMessageId === input.clientMessageId)
    ) {
      return false
    }
    const reason = exclusion(input)
    const observation: DecisionShadowObservation = {
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      generation: input.generation,
      fence: input.fence,
      schemaVersion: 1,
      decisionId: randomUUID(),
      clientMessageId: input.clientMessageId,
      choicesVersion: input.choicesVersion,
      policyVersion: DECISION_SHADOW_POLICY_VERSION,
      inputDigest: createHash('sha256').update(input.text).digest('hex'),
      inputTruncated: reason === 'truncated',
      provider: this.provider.id,
      modelRevision: this.provider.modelRevision,
      calibration: 'uncalibrated',
      createdAt: Date.now(),
      state: reason ? 'skipped' : 'pending',
      ...(reason ? { reason } : {}),
      requested: input.requested
        ? { model: input.requested.model, effort: input.requested.effort }
        : undefined,
      reported: input.reported
        ? { model: input.reported.model, effort: input.reported.effort }
        : undefined,
      turnId: input.turnId,
      deliveryState: input.deliveryState
    }
    this.observations.push(observation)
    this.prune()
    if (reason) {
      return true
    }
    if (this.queue.length >= this.maxPending + (this.active ? 0 : 1)) {
      observation.state = 'skipped'
      observation.reason = 'queue_full'
      return true
    }
    const pending: Pending = {
      observation,
      input: {
        text: sanitize(input.text),
        ...(input.context ? { context: sanitize(input.context) } : {}),
        taskCategoryChoices: [...DECISION_SHADOW_CATEGORIES],
        executionLaneChoices: [
          ...new Set(input.availableLanes.map(decisionShadowLaneChoice)),
          'needs_context'
        ],
        choicesVersion: input.choicesVersion
      },
      controller: new AbortController(),
      timer: setTimeout(() => this.finish(pending, 'expired', 'deadline'), this.deadlineMs)
    }
    this.queue.push(pending)
    queueMicrotask(() => this.pump())
    return true
  }

  update(
    scope: DecisionShadowScope,
    clientMessageId: string,
    metadata: Pick<DecisionShadowDispatch, 'deliveryState' | 'turnId'>
  ): void {
    if (!this.isEnabled(scope)) {
      return
    }
    const item = this.observations.find(
      (entry) => sameScope(entry, scope) && entry.clientMessageId === clientMessageId
    )
    if (!item) {
      return
    }
    const settled = item.deliveryState === 'acknowledged' || item.deliveryState === 'rejected'
    if (settled && metadata.deliveryState !== item.deliveryState) {
      return
    }
    item.deliveryState = metadata.deliveryState
    if (metadata.turnId !== undefined) {
      item.turnId = metadata.turnId
    }
  }

  isEnabled(scope: DecisionShadowScope): boolean {
    this.prune()
    const session = this.sessions.get(scope.sessionId)
    return Boolean(session?.enabled && sameScope(session.scope, scope))
  }

  read(scope: DecisionShadowScope): DecisionShadowObservation[] {
    this.prune()
    const session = this.sessions.get(scope.sessionId)
    if (!session || !sameScope(session.scope, scope)) {
      return []
    }
    return structuredClone(this.observations.filter((item) => sameScope(item, scope)))
  }

  cancel(scope: DecisionShadowScope, reason: 'off' | 'stop' | 'close' | 'replacement'): void {
    const session = this.sessions.get(scope.sessionId)
    if (!session || !sameScope(session.scope, scope)) {
      return
    }
    session.enabled = false
    for (const pending of [...this.queue, ...(this.active ? [this.active] : [])]) {
      if (sameScope(pending.observation, scope)) {
        this.finish(pending, 'cancelled', reason)
      }
    }
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS
    for (const [key, retiredAt] of this.retiredScopes) {
      if (retiredAt <= cutoff) {
        this.retiredScopes.delete(key)
      }
    }
    for (const [id, session] of this.sessions) {
      if (session.configuredAt <= cutoff) {
        this.cancel(session.scope, 'off')
        this.sessions.delete(id)
      }
    }
    while (
      this.observations.length &&
      (this.observations.length > 200 || this.observations[0].createdAt <= cutoff)
    ) {
      this.observations.shift()
    }
  }

  private finish(
    pending: Pending,
    state: 'expired' | 'cancelled',
    reason: DecisionShadowReason
  ): void {
    if (pending.observation.state !== 'pending') {
      return
    }
    pending.observation.state = state
    pending.observation.reason = reason
    pending.observation.latencyMs = Date.now() - pending.observation.createdAt
    clearTimeout(pending.timer)
    pending.input = undefined
    pending.controller.abort()
    const index = this.queue.indexOf(pending)
    if (index !== -1) {
      this.queue.splice(index, 1)
    }
  }

  private pump(): void {
    if (this.active) {
      return
    }
    const pending = this.queue.shift()
    if (!pending?.input) {
      return
    }
    this.active = pending
    const input = pending.input
    pending.input = undefined
    // Never await provider work on the Codex dispatch or delivery queue.
    void this.evaluate(pending, input)
  }

  private async evaluate(pending: Pending, input: DecisionShadowProviderInput): Promise<void> {
    try {
      const response = await this.provider.evaluate(input, pending.controller.signal)
      if (pending.observation.state !== 'pending') {
        return
      }
      const answers = validateDecisionShadowAnswers(response, input.executionLaneChoices)
      if (!answers) {
        pending.observation.state = 'unavailable'
        pending.observation.reason = 'invalid_response'
      } else {
        pending.observation.answers = answers
        pending.observation.state =
          answers.task_category.choice === 'needs_context' ||
          answers.execution_lane.choice === 'needs_context'
            ? 'needs_context'
            : 'available'
      }
    } catch {
      if (pending.observation.state === 'pending') {
        pending.observation.state = 'unavailable'
        pending.observation.reason = 'provider_unavailable'
      }
    } finally {
      clearTimeout(pending.timer)
      if (pending.observation.state !== 'cancelled' && pending.observation.state !== 'expired') {
        pending.observation.latencyMs = Date.now() - pending.observation.createdAt
      }
      this.active = undefined
      this.pump()
    }
  }
}
