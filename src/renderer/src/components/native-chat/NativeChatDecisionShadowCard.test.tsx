// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeChatDecisionShadowCard } from './NativeChatDecisionShadowCard'
import { useNativeChatDecisionShadow } from './use-native-chat-decision-shadow'
vi.mock('./use-native-chat-decision-shadow', () => ({ useNativeChatDecisionShadow: vi.fn() }))
afterEach(cleanup)
it('labels simulated recommendations and separate uncalibrated scores without changing Codex options', () => {
  vi.mocked(useNativeChatDecisionShadow).mockReturnValue({
    key: 'local',
    loading: false,
    configuring: false,
    error: false,
    configure: vi.fn(),
    snapshot: {
      mode: 'shadow',
      observations: [
        {
          schemaVersion: 1,
          sessionId: 's',
          ownerId: 'desktop-renderer',
          generation: 'g',
          fence: 1,
          decisionId: 'd',
          clientMessageId: 'c',
          choicesVersion: 'v',
          policyVersion: 'p',
          inputDigest: 'digest',
          inputTruncated: false,
          calibration: 'uncalibrated',
          provider: 'simulated-fixture',
          modelRevision: 'fixture',
          createdAt: 1,
          latencyMs: 42,
          state: 'available',
          deliveryState: 'acknowledged',
          requested: { model: 'gpt-6.1-sol', effort: 'medium' },
          answers: {
            task_category: { choice: 'docs', confidence: 0.61 },
            execution_lane: { choice: '["gpt-6-luna","high"]', confidence: 0.43 }
          }
        }
      ]
    }
  })
  render(<NativeChatDecisionShadowCard target={{ kind: 'local' }} sessionId="s" />)
  expect(
    screen
      .getByRole('region', { name: 'OpenDecider shadow pilot' })
      .getAttribute('data-decision-id')
  ).toBe('d')
  expect(screen.getByText(/Simulated fixture/)).toBeTruthy()
  expect(screen.getByText('Category scores: confidence 0.610')).toBeTruthy()
  expect(screen.getByText('Lane scores: confidence 0.430')).toBeTruthy()
  expect(screen.getByText(/Reported by Codex: Unknown/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Apply|Auto/ })).toBeNull()
  const details = screen.getByRole('button', { name: 'Decision details' })
  fireEvent.click(details)
  expect(details.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Category scores: confidence 0.610')).toBeNull()
  fireEvent.click(details)
  expect(screen.getByText('Category scores: confidence 0.610')).toBeTruthy()
})
