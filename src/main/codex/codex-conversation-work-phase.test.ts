import { describe, expect, it } from 'vitest'
import { codexJournalItem, codexStreamingJournalItem } from './codex-structured-item-translation'
import { projectConversationWorkPhase } from '../../shared/conversation-work-phase'
import type { AgentJournalItemBody } from '../../shared/agent-session-journal-types'

function phase(body: AgentJournalItemBody | null) {
  return body
    ? projectConversationWorkPhase(
        [{ itemId: 'patch', revision: 1, sequence: 1, observedAt: 1, body }],
        true
      )?.phase
    : undefined
}

describe('Codex real file change phase evidence', () => {
  it.each(['inProgress', 'failed', 'aborted'])('does not claim implementation for %s', (status) => {
    const translated = codexJournalItem({
      type: 'fileChange',
      id: 'patch',
      status,
      changes: [{ path: 'a.ts', diff: '+a' }]
    })
    expect(phase(translated.body)).toBeUndefined()
  })
  it('requires completed provider status and does not treat stream previews as edits', () => {
    const item = {
      type: 'fileChange',
      id: 'patch',
      status: 'completed',
      changes: [{ path: 'a.ts', diff: '+a' }]
    }
    expect(phase(codexJournalItem(item).body)).toBe('implementation')
    expect(phase(codexStreamingJournalItem(item, '+preview').body)).toBeUndefined()
  })
})
