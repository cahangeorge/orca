import { describe, expect, it } from 'vitest'
import { decisionShadowLaneChoice } from './decision-shadow-types'
import type { DecisionPreflightDraft } from './decision-preflight-types'
import {
  parseDecisionPreflightDraft,
  validateDecisionPreflightSuggestion
} from './decision-preflight-validation'

const lane = { model: 'gpt-6.1-sol', effort: 'medium' }
function draft(): DecisionPreflightDraft {
  return {
    scope: { draftId: 'draft-one', workspaceId: 'folder:one', revision: 0, choicesVersion: 'v1' },
    target: 'local',
    agent: 'codex',
    conversation: 'new',
    text: 'Investigate this public reproducible failure.',
    attachmentCount: 0,
    selfContained: true,
    inputTruncated: false,
    availableLanes: [lane]
  }
}
function suggestion() {
  return {
    scope: draft().scope,
    answers: {
      task_category: { choice: 'debugging', confidence: 0.91 },
      execution_lane: { choice: decisionShadowLaneChoice(lane), confidence: 0.7 }
    }
  }
}

describe('decision preflight draft contract', () => {
  it('accepts a local folder workspace without normalizing the draft text', () => {
    const input = { ...draft(), text: '  Rename x to y.\n' }
    expect(parseDecisionPreflightDraft(input)).toEqual(input)
  })

  it.each([
    null,
    {},
    { ...draft(), permissionPolicy: 'bypass' },
    { ...draft(), scope: { ...draft().scope, revision: -1 } },
    { ...draft(), scope: { ...draft().scope, revision: 0.5 } },
    { ...draft(), scope: { ...draft().scope, revision: Number.MAX_SAFE_INTEGER + 1 } },
    { ...draft(), scope: { ...draft().scope, choicesVersion: '' } },
    { ...draft(), scope: { ...draft().scope, workspaceId: ' bad id ' } },
    { ...draft(), attachmentCount: -1 },
    { ...draft(), selfContained: 'yes' },
    { ...draft(), text: ' '.repeat(20) },
    { ...draft(), text: 'x'.repeat(4097) },
    { ...draft(), availableLanes: [lane, lane] },
    { ...draft(), availableLanes: [{ model: 'gpt-6.1-sol', effort: '' }] },
    {
      ...draft(),
      availableLanes: Array.from({ length: 8 }, (_, i) => ({ model: `m${i}`, effort: 'high' }))
    }
  ])('rejects malformed, oversized or conflicting draft facts (%#)', (input) => {
    expect(parseDecisionPreflightDraft(input)).toBeUndefined()
  })

  it('accepts exactly 4096 characters without truncation', () => {
    expect(parseDecisionPreflightDraft({ ...draft(), text: 'x'.repeat(4096) })?.text).toHaveLength(
      4096
    )
  })
})

describe('decision preflight suggestion validation', () => {
  it('keeps a valid current suggestion explicitly uncalibrated', () => {
    expect(validateDecisionPreflightSuggestion(suggestion(), draft())).toEqual({
      ...suggestion(),
      calibration: 'uncalibrated'
    })
  })

  it.each([
    { draftId: 'draft-two' },
    { workspaceId: 'folder:two' },
    { revision: 1 },
    { choicesVersion: 'v2' }
  ])('rejects a response from an obsolete or different scope (%#)', (change) => {
    const current = { ...draft(), scope: { ...draft().scope, ...change } }
    expect(validateDecisionPreflightSuggestion(suggestion(), current)).toBeUndefined()
  })

  it('rejects a withdrawn lane even if the caller failed to advance choicesVersion', () => {
    const current = { ...draft(), availableLanes: [{ model: 'gpt-6-luna', effort: 'high' }] }
    expect(validateDecisionPreflightSuggestion(suggestion(), current)).toBeUndefined()
  })

  it('does not overwrite an explicit human pick with a pending model suggestion', () => {
    expect(
      validateDecisionPreflightSuggestion(suggestion(), {
        ...draft(),
        explicitSelection: lane
      })
    ).toBeUndefined()
  })

  it('rejects a response after the draft becomes remote or has attachments', () => {
    expect(
      validateDecisionPreflightSuggestion(suggestion(), { ...draft(), target: 'remote' })
    ).toBeUndefined()
    expect(
      validateDecisionPreflightSuggestion(suggestion(), { ...draft(), attachmentCount: 1 })
    ).toBeUndefined()
  })

  it.each([Number.NaN, Infinity, -0.1, 1.1, 'high'])(
    'rejects invalid confidence %s',
    (confidence) => {
      const input = suggestion()
      expect(
        validateDecisionPreflightSuggestion(
          {
            ...input,
            answers: {
              ...input.answers,
              execution_lane: { choice: decisionShadowLaneChoice(lane), confidence }
            }
          },
          draft()
        )
      ).toBeUndefined()
    }
  )

  it('validates a full distribution including the abstention choice', () => {
    const input = {
      ...suggestion(),
      answers: {
        ...suggestion().answers,
        execution_lane: {
          choice: decisionShadowLaneChoice(lane),
          confidence: 0.7,
          probabilities: { [decisionShadowLaneChoice(lane)]: 0.7, needs_context: 0.3 }
        }
      }
    }
    expect(validateDecisionPreflightSuggestion(input, draft())).toBeDefined()
    expect(
      validateDecisionPreflightSuggestion(
        {
          ...input,
          answers: {
            ...input.answers,
            execution_lane: {
              ...input.answers.execution_lane,
              probabilities: { [decisionShadowLaneChoice(lane)]: 0.7, needs_context: 0.5 }
            }
          }
        },
        draft()
      )
    ).toBeUndefined()
  })

  it('accepts needs_context without manufacturing confidence or selecting a model', () => {
    const input = {
      scope: draft().scope,
      answers: {
        task_category: { choice: 'needs_context' },
        execution_lane: { choice: 'needs_context' }
      }
    }
    expect(validateDecisionPreflightSuggestion(input, draft())?.answers).toEqual(input.answers)
  })

  it.each([
    { ...suggestion(), selectedModel: 'gpt-6-astra' },
    { ...suggestion(), scope: { ...draft().scope, ownerId: 'foreign' } },
    {
      ...suggestion(),
      answers: {
        task_category: { choice: 'security_agent' },
        execution_lane: { choice: 'needs_context' }
      }
    },
    {
      ...suggestion(),
      answers: { task_category: { choice: 'docs' }, execution_lane: { choice: 'launch' } }
    }
  ])('rejects malformed envelopes and answers outside the choices (%#)', (input) => {
    expect(validateDecisionPreflightSuggestion(input, draft())).toBeUndefined()
  })
})
