import { describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { projectConversationWorkPhase } from './conversation-work-phase'

function row(
  sequence: number,
  body: AgentJournalRenderItem['body'],
  agentId?: string
): AgentJournalRenderItem {
  return {
    itemId: String(sequence),
    sequence,
    revision: 1,
    observedAt: sequence,
    body,
    ...(agentId ? { agentId } : {})
  }
}
const tool = (sequence: number, name: string, input: unknown) =>
  row(sequence, { kind: 'tool-call', name, input, state: 'running' })

describe('conversation work phase from admitted root journal rows', () => {
  it('projects exploration, structured plan, confirmed diff and verification', () => {
    const rows = [
      tool(1, 'Read', { path: 'a.ts' }),
      row(2, { kind: 'status', text: 'Plan', presentation: 'plan-document' }),
      row(3, {
        kind: 'diff',
        editConfirmed: true,
        path: 'a.ts',
        patch: { head: '+a', digest: 'a', byteLength: 2, truncated: false }
      }),
      tool(4, 'shell', { command: 'pnpm test src/a.test.ts' })
    ]
    expect(
      rows.map((_, index) => projectConversationWorkPhase(rows.slice(0, index + 1))?.phase)
    ).toEqual(['analysis', 'planning', 'implementation', 'verification'])
  })
  it('ignores prose, ambiguous shell, failed edits and child work', () => {
    expect(
      projectConversationWorkPhase([
        row(1, {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: 'test and implement the plan' }]
        }),
        tool(2, 'shell', { command: 'echo "pnpm test"' }),
        tool(3, 'shell', { command: 'false && pnpm test' }),
        row(4, { kind: 'tool-call', name: 'apply_patch', input: {}, state: 'failed' }),
        row(
          5,
          {
            kind: 'diff',
            editConfirmed: true,
            path: 'child.ts',
            patch: { head: '+b', digest: 'b', byteLength: 2, truncated: false }
          },
          'child'
        )
      ])
    ).toBeUndefined()
  })
  it('retains phase across prose and idle, using sequence over arrival or timestamps', () => {
    const verification = tool(5, 'shell', { command: 'pnpm tc:web' })
    expect(
      projectConversationWorkPhase([
        verification,
        tool(2, 'Read', {}),
        row(6, { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'Done' }] })
      ])?.phase
    ).toBe('verification')
    expect(projectConversationWorkPhase([verification, verification])?.phase).toBe('verification')
  })
  it('requires an explicit goal completion and clears it for a new goal', () => {
    const goal = {
      objective: 'ship',
      status: 'complete' as const,
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 1,
      createdAt: 1,
      updatedAt: 2
    }
    expect(
      projectConversationWorkPhase([
        row(1, { kind: 'status', text: '', threadGoal: { state: 'set', goal } })
      ])?.phase
    ).toBe('finalized')
    expect(
      projectConversationWorkPhase([
        row(1, { kind: 'status', text: '', threadGoal: { state: 'set', goal } }),
        row(2, {
          kind: 'status',
          text: '',
          threadGoal: { state: 'set', goal: { ...goal, status: 'active', createdAt: 2 } }
        })
      ])
    ).toBeUndefined()
  })
  it('does not reset on same-goal usage updates or stale goal rows', () => {
    const goal = {
      objective: 'ship',
      status: 'active' as const,
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 1,
      createdAt: 100,
      updatedAt: 100
    }
    const update = (sequence: number, createdAt = 100) =>
      row(sequence, {
        kind: 'status',
        text: '',
        threadGoal: { state: 'set', goal: { ...goal, createdAt, updatedAt: sequence } }
      })
    const edit = row(101, {
      kind: 'diff',
      editConfirmed: true,
      path: 'a.ts',
      patch: { head: '+a', digest: 'a', byteLength: 2, truncated: false }
    })
    expect(
      projectConversationWorkPhase([update(100), edit, update(1, 1), update(102)])?.phase
    ).toBe('implementation')
  })
  it('rejects write-capable shell utilities as exploration', () => {
    for (const command of [
      'sed -i s/a/b/ a.ts',
      'find . -exec rm {} +',
      'echo pytest',
      'pnpm test; false'
    ]) {
      expect(projectConversationWorkPhase([tool(1, 'shell', { command })])).toBeUndefined()
    }
  })

  it('ordered journal streaming stops before old rows once recent evidence is found', () => {
    const old = row(1, { kind: 'message', role: 'assistant', blocks: [] })
    const body = vi.fn(() => ({ kind: 'message', role: 'assistant', blocks: [] }))
    Object.defineProperty(old, 'body', { get: body })
    const recent = tool(2, 'shell', { command: 'pnpm test' })
    const prose = row(3, {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'streaming' }]
    })
    expect(projectConversationWorkPhase([old, recent, prose], true)?.phase).toBe('verification')
    expect(body).not.toHaveBeenCalled()
  })
  it('keeps previous phase when a diff is a preview, failed edit or old journal row', () => {
    const prior = tool(1, 'Read', {})
    for (const editConfirmed of [undefined, false]) {
      const preview = row(2, {
        kind: 'diff',
        editConfirmed,
        path: 'a.ts',
        patch: { head: '+a', digest: 'a', byteLength: 2, truncated: false }
      })
      expect(projectConversationWorkPhase([prior, preview], true)?.phase).toBe('analysis')
    }
  })
})
