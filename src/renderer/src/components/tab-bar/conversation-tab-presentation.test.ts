import { describe, expect, it } from 'vitest'
import { resolveConversationTabPresentation } from './conversation-tab-presentation'

const args = {
  covered: true,
  color: null,
  automaticBackgroundEnabled: true,
  automaticWorkPhase: 'verification'
} as const

describe('conversation tab phase presentation', () => {
  it('uses automatic evidence, manual phase, then manual color in order', () => {
    expect(resolveConversationTabPresentation(args).backgroundColor).toBe(
      'var(--conversation-phase-verification-surface)'
    )
    expect(resolveConversationTabPresentation({ ...args, manualWorkPhase: 'planning' }).phase).toBe(
      'planning'
    )
    expect(
      resolveConversationTabPresentation({
        ...args,
        manualWorkPhase: 'planning',
        color: 'var(--primary)'
      }).backgroundColor
    ).toContain('var(--primary) 12%')
  })
  it('disables only automatic backgrounds and degrades unknown old/new peer data', () => {
    expect(
      resolveConversationTabPresentation({ ...args, automaticBackgroundEnabled: false })
        .backgroundColor
    ).toBeUndefined()
    expect(
      resolveConversationTabPresentation({
        ...args,
        automaticBackgroundEnabled: false,
        manualWorkPhase: 'analysis'
      }).phase
    ).toBe('analysis')
    for (const automaticWorkPhase of [undefined, 'future-phase', { phase: 'planning' }]) {
      expect(
        resolveConversationTabPresentation({ ...args, automaticWorkPhase }).backgroundColor
      ).toBeUndefined()
    }
    expect(
      resolveConversationTabPresentation({ ...args, covered: false }).backgroundColor
    ).toBeUndefined()
  })
})
