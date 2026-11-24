import type { DecisionShadowAnswers } from '../../shared/decision-shadow-types'
export type DecisionShadowProviderInput = {
  text: string
  context?: string
  taskCategoryChoices: readonly string[]
  executionLaneChoices: readonly string[]
  choicesVersion: string
}
export type DecisionShadowProvider = {
  id: string
  modelRevision: string
  evaluate(input: DecisionShadowProviderInput, signal: AbortSignal): Promise<unknown>
}
/** Simulated integration evidence only; this never runs OpenDecider Nano. */
export function createSimulatedDecisionShadowProvider(): DecisionShadowProvider {
  return {
    id: 'simulated-fixture',
    modelRevision: 'fixture-1',
    async evaluate(input, signal): Promise<DecisionShadowAnswers> {
      if (signal.aborted) {
        throw new Error('cancelled')
      }
      return {
        task_category: { choice: 'implementation', confidence: 0.61 },
        execution_lane: {
          choice: input.executionLaneChoices[0] ?? 'needs_context',
          confidence: 0.43
        }
      }
    }
  }
}
