import { describe, expect, it } from 'vitest'
import { DecisionDraftAnalyzeParams, DecisionDraftCancelParams } from './decision-draft-params'
const input = {
  workspaceId: 'w',
  draftId: 'd',
  revision: 0,
  catalogRef: 'catalog',
  choicesVersion: 'v1',
  text: 'Write a focused test',
  attachmentCount: 0,
  selfContained: true,
  inputTruncated: false
}
describe('draft request boundary', () => {
  it('preserves text and accepts bounded explicit selection', () => {
    expect(
      DecisionDraftAnalyzeParams.parse({
        ...input,
        text: '  task  ',
        explicitSelection: { model: 'sol', effort: 'medium' }
      }).text
    ).toBe('  task  ')
  })
  it.each([
    'ownerKey',
    'ownerId',
    'account',
    'path',
    'availableLanes',
    'target',
    'agent',
    'conversation'
  ])('rejects client authority %s', (field) => {
    expect(DecisionDraftAnalyzeParams.safeParse({ ...input, [field]: 'forged' }).success).toBe(
      false
    )
  })
  it.each([
    { text: 'x'.repeat(4097) },
    { text: ' ' },
    { revision: -1 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { draftId: 'two words' },
    { catalogRef: 'x'.repeat(257) },
    { explicitSelection: { model: 'sol', effort: 'medium', extra: true } }
  ])('rejects malformed bounds %j', (change) => {
    expect(DecisionDraftAnalyzeParams.safeParse({ ...input, ...change }).success).toBe(false)
  })
  it('accepts only exact cancel identity', () => {
    const cancel = { workspaceId: 'w', draftId: 'd', revision: 1 }
    expect(DecisionDraftCancelParams.parse(cancel)).toEqual(cancel)
    expect(DecisionDraftCancelParams.safeParse({ ...cancel, choicesVersion: 'v' }).success).toBe(
      false
    )
  })
})
