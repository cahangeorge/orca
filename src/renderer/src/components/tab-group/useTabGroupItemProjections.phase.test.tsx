/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  useTabGroupItemProjections,
  type TabGroupWorktreeSnapshot
} from './useTabGroupItemProjections'
import type { ConversationWorkPhase } from '../../../../shared/conversation-work-phase'

function snapshot(manualWorkPhase?: ConversationWorkPhase | null): TabGroupWorktreeSnapshot {
  return {
    groups: [{ id: 'group', worktreeId: 'folder', activeTabId: 'tab', tabOrder: ['tab'] }],
    unifiedTabs: [
      {
        id: 'tab',
        entityId: 'tab',
        groupId: 'group',
        worktreeId: 'folder',
        contentType: 'terminal',
        label: 'Stable title',
        customLabel: null,
        color: null,
        sortOrder: 0,
        createdAt: 1,
        manualWorkPhase
      }
    ],
    terminalTabs: [
      {
        id: 'tab',
        worktreeId: 'folder',
        ptyId: null,
        title: 'Stable title',
        customTitle: null,
        color: null,
        sortOrder: 0,
        createdAt: 1,
        launchAgent: 'codex',
        manualWorkPhase: 'planning'
      }
    ],
    openFiles: [],
    browserTabs: [],
    expandedPaneByTabId: {},
    terminalLayoutsByTabId: {},
    generatedTabTitlesEnabled: true,
    mobileEmulatorEnabled: false
  }
}

describe('real group projection phase metadata', () => {
  it('carries manual phase changes and explicit reset into the rendered tab model', () => {
    const { result, rerender } = renderHook(
      ({ worktreeState }) =>
        useTabGroupItemProjections({
          groupId: 'group',
          worktreeId: 'folder',
          worktreeState
        }),
      { initialProps: { worktreeState: snapshot('implementation') } }
    )
    expect(result.current.terminalTabs[0].manualWorkPhase).toBe('implementation')
    rerender({ worktreeState: snapshot('verification') })
    expect(result.current.terminalTabs[0].manualWorkPhase).toBe('verification')
    rerender({ worktreeState: snapshot(null) })
    expect(result.current.terminalTabs[0].manualWorkPhase).toBeNull()
    rerender({ worktreeState: snapshot() })
    expect(result.current.terminalTabs[0].manualWorkPhase).toBe('planning')
    expect(result.current.terminalTabs[0].title).toBe('Stable title')
  })
})
