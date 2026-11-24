import { describe, expect, it } from 'vitest'
import {
  decisionShadowLaneChoice,
  validateDecisionShadowAnswers
} from '../../shared/decision-shadow-types'
const lane = decisionShadowLaneChoice({ model: 'gpt-6.1-sol', effort: 'medium' })
const valid = {
  task_category: { choice: 'docs', confidence: 0.2 },
  execution_lane: { choice: lane, confidence: 0.8 }
}
describe('normalized decision contract', () => {
  it('retains independent scores without treating them as calibrated', () => {
    expect(validateDecisionShadowAnswers(valid, [lane, 'needs_context'])).toEqual(valid)
  })
  it.each([Number.NaN, Infinity, -0.1, 1.1, '0.5'])(
    'rejects invalid finite confidence %s',
    (confidence) => {
      expect(
        validateDecisionShadowAnswers({ ...valid, execution_lane: { choice: lane, confidence } }, [
          lane
        ])
      ).toBeUndefined()
    }
  )
  it('rejects partial, unnormalized and extra-choice probability distributions', () => {
    for (const probabilities of [
      { [lane]: 0.5 },
      { [lane]: 0.9, needs_context: 0.9 },
      { [lane]: 1, unknown: 0 }
    ]) {
      expect(
        validateDecisionShadowAnswers(
          { ...valid, execution_lane: { choice: lane, probabilities } },
          [lane, 'needs_context']
        )
      ).toBeUndefined()
    }
  })
  it('accepts a complete normalized distribution and strips unknown payload fields', () => {
    expect(
      validateDecisionShadowAnswers(
        {
          ...valid,
          execution_lane: {
            choice: lane,
            probabilities: { [lane]: 0.7, needs_context: 0.3 },
            raw: 'private'
          },
          raw: 'private'
        },
        [lane, 'needs_context']
      )
    ).toEqual({
      ...valid,
      execution_lane: { choice: lane, probabilities: { [lane]: 0.7, needs_context: 0.3 } }
    })
  })
  it('rejects truncated and missing question answers', () => {
    expect(
      validateDecisionShadowAnswers({ task_category: valid.task_category }, [lane])
    ).toBeUndefined()
    expect(
      validateDecisionShadowAnswers(
        { ...valid, execution_lane: { ...valid.execution_lane, truncated: true } },
        [lane]
      )
    ).toBeUndefined()
  })
})
