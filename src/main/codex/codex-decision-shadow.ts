import { cancelCodexStructuredTurn } from './codex-structured-prompt-ownership'
import { settleCodexSendsInEndedTurn } from './codex-structured-turn-end-settlement'
import type { CodexDispatchEchoes } from './codex-structured-dispatch-echo'
import { dispatchCodexTurn } from './codex-structured-turn-start'
import type { AgentSessionDispatchOutcome } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type {
  AgentJournalMessageItem,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import type { DecisionShadowDispatch } from '../../shared/decision-shadow-types'
import type {
  CodexSession,
  CodexStructuredSessionAdapterDeps
} from './codex-structured-session-state'
export type CodexDecisionShadowIdentity = { sessionId: string; generation: string; fence: number }
export type CodexDecisionShadowHooks = {
  observe: (input: Omit<DecisionShadowDispatch, 'ownerId'>) => void
  update?: (
    identity: CodexDecisionShadowIdentity,
    clientMessageId: string,
    metadata: Pick<DecisionShadowDispatch, 'deliveryState' | 'turnId'>
  ) => void
  cancel: (identity: CodexDecisionShadowIdentity, reason: 'stop' | 'close') => void
}
export function observeCodexDecisionShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  session: CodexSession,
  input: { sessionId: string; clientMessageId: string; body: AgentJournalMessageItem }
): void {
  if (!hooks) {
    return
  }
  try {
    const catalog = session.catalogAccess?.store.get(session.catalogAccess.fingerprint)
    const model = session.options.get('model')
    const effort = session.options.get('effort')
    const text = input.body.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    hooks.observe({
      sessionId: input.sessionId,
      generation: session.acquisitionGeneration,
      fence: session.fence,
      clientMessageId: input.clientMessageId,
      text,
      activeTurn: session.activeTurnIds === undefined || session.activeTurnIds.size > 0,
      autonomous:
        input.body.sentAs !== 'goal' &&
        input.body.blocks.every((block) => block.type === 'text') &&
        !/\b(?:plan above|current phase|previous (?:task|plan)|as discussed|orchestrat|planul (?:de )?mai sus|faza curent[ăa])\b/i.test(
          text
        ),
      availableLanes:
        catalog?.models.flatMap((entry) =>
          entry.efforts
            .filter(
              (choice) =>
                (entry.id === 'gpt-6-luna' && choice.value === 'high') ||
                (entry.id === 'gpt-6.1-sol' && ['medium', 'high'].includes(choice.value)) ||
                (entry.id === 'gpt-6-astra' && choice.value === 'low')
            )
            .map((choice) => ({ model: entry.id, effort: choice.value }))
        ) ?? [],
      choicesVersion: catalog ? `catalog-${catalog.fetchedAt}` : 'unknown',
      requested: model && effort ? { model, effort } : undefined,
      deliveryState: 'unknown'
    })
  } catch {
    /* Shadow cannot change Codex delivery. */
  }
}
export function cancelCodexShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  sessionId: string,
  session: CodexSession | undefined,
  reason: 'stop' | 'close'
): void {
  if (!session || !hooks) {
    return
  }
  try {
    hooks.cancel(
      { sessionId, generation: session.acquisitionGeneration, fence: session.fence },
      reason
    )
  } catch {
    /* Shadow cannot delay lifecycle cleanup. */
  }
}

export function updateCodexDecisionShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  sessionId: string,
  session: CodexSession,
  clientMessageId: string,
  metadata: Pick<DecisionShadowDispatch, 'deliveryState' | 'turnId'>
): void {
  try {
    hooks?.update?.(
      { sessionId, generation: session.acquisitionGeneration, fence: session.fence },
      clientMessageId,
      metadata
    )
  } catch {
    /* Observation metadata never changes delivery. */
  }
}

export function acknowledgeCodexDecisionShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  sessionId: string,
  session: CodexSession | undefined,
  clientMessageId: string,
  identity: AgentJournalItemIdentity
): void {
  if (session && identity.provider === 'codex') {
    updateCodexDecisionShadow(hooks, sessionId, session, clientMessageId, {
      deliveryState: 'acknowledged',
      turnId: identity.turnId
    })
  }
}
export async function dispatchCodexTurnWithShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  session: CodexSession,
  input: {
    sessionId: string
    clientMessageId: string
    body: AgentJournalMessageItem
    requestedAt?: number
  },
  timeoutMs?: number
): Promise<AgentSessionDispatchOutcome> {
  observeCodexDecisionShadow(hooks, session, input)
  try {
    const outcome = await dispatchCodexTurn(session, input, timeoutMs, (turnId) =>
      updateCodexDecisionShadow(hooks, input.sessionId, session, input.clientMessageId, {
        deliveryState: 'admitted',
        ...(turnId ? { turnId } : {})
      })
    )
    updateCodexDecisionShadow(hooks, input.sessionId, session, input.clientMessageId, {
      deliveryState:
        outcome.state === 'rejected'
          ? 'rejected'
          : outcome.state === 'accepted'
            ? 'acknowledged'
            : outcome.state === 'admitted'
              ? 'admitted'
              : 'unknown'
    })
    return outcome
  } catch (error) {
    updateCodexDecisionShadow(hooks, input.sessionId, session, input.clientMessageId, {
      deliveryState: 'unknown'
    })
    throw error
  }
}

export function codexShadowEchoSettlement(
  deps: CodexStructuredSessionAdapterDeps,
  sessionId: string,
  sessionFor: () => CodexSession | undefined,
  echoes: CodexDispatchEchoes
) {
  return (clientMessageId: string, providerIdentity: AgentJournalItemIdentity): void => {
    if (!echoes.settle(clientMessageId)) {
      return
    }
    acknowledgeCodexDecisionShadow(
      deps.decisionShadow,
      sessionId,
      sessionFor(),
      clientMessageId,
      providerIdentity
    )
    deps.onDispatchSettledLate?.({ sessionId, clientMessageId, providerIdentity })
  }
}
export function settleCodexShadowTurn(
  deps: CodexStructuredSessionAdapterDeps,
  sessionId: string,
  session: CodexSession,
  method: string,
  params: unknown
): void {
  settleCodexSendsInEndedTurn(session, method, params, (settlement) => {
    updateCodexDecisionShadow(deps.decisionShadow, sessionId, session, settlement.clientMessageId, {
      deliveryState: 'rejected'
    })
    deps.onDispatchSettledLate?.({ sessionId, ...settlement })
  })
}
export function cancelCodexTurnWithShadow(
  hooks: CodexDecisionShadowHooks | undefined,
  input: Parameters<typeof cancelCodexStructuredTurn>[0]
) {
  const session = input.sessions.get(input.request.sessionId)
  if (session?.fence === input.request.fence) {
    cancelCodexShadow(hooks, input.request.sessionId, session, 'stop')
  }
  return cancelCodexStructuredTurn(input)
}
