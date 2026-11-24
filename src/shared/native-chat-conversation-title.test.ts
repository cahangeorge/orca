import { describe, expect, it } from 'vitest'
import { deriveNativeChatConversationTitle } from './native-chat-conversation-title'
import type { AgentSessionConversationOutline } from './agent-session-conversation-outline'

function outline(...prompts: string[]): AgentSessionConversationOutline {
  return {
    sessionId: 'session',
    cursor: { epoch: 'test', sequence: 10 },
    omittedEntries: 0,
    entries: prompts.map((preview, sequence) => ({
      itemId: String(sequence),
      sequence,
      preview,
      imageCount: 0
    }))
  }
}
describe('Native Chat conversation title', () => {
  it('uses the first substantive message, not the latest continuation', () => {
    expect(
      deriveNativeChatConversationTitle(
        outline('Please fix login retries', 'continue', 'da ai acordul')
      )
    ).toBe('Fix login retries')
  })
  it('skips Romanian/English acknowledgements and context-only messages', () => {
    expect(
      deriveNativeChatConversationTitle(
        outline(
          '# AGENTS.md instructions',
          'da, ai acordul',
          'continuă',
          'yes',
          'Please fix login retries'
        )
      )
    ).toBe('Fix login retries')
  })
  it('does not invent a title without a subject', () => {
    expect(deriveNativeChatConversationTitle(outline('', 'da', 'continuă', 'go ahead'))).toBeNull()
  })
  it('does not mistake a trimmed outline for the original conversation', () => {
    expect(
      deriveNativeChatConversationTitle({
        ...outline('continue fixing retries'),
        omittedEntries: 4
      })
    ).toBeNull()
  })
})
