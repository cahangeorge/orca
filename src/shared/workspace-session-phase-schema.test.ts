import { describe, expect, it } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'
import { SetTabProps } from './rpc-contract/session-tabs-schemas-params'

function session(manualWorkPhase: unknown) {
  const base = {
    id: 'tab',
    worktreeId: 'folder',
    color: null,
    manualWorkPhase,
    sortOrder: 0,
    createdAt: 1
  }
  return {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    terminalLayoutsByTabId: {},
    tabsByWorktree: { folder: [{ ...base, ptyId: null, title: 'Stable', customTitle: null }] },
    unifiedTabs: {
      folder: [
        {
          ...base,
          entityId: 'tab',
          groupId: 'group',
          contentType: 'terminal',
          label: 'Stable',
          customLabel: null
        }
      ]
    }
  }
}

describe('persisted and remote manual phase', () => {
  it.each(['planning', null, undefined, 'future-phase'])(
    'roundtrips optional phase and preserves old/future peers (%s)',
    (phase) => {
      const result = parseWorkspaceSession(JSON.parse(JSON.stringify(session(phase))))
      expect(result.ok).toBe(true)
      if (result.ok) {
        const expected = phase === 'future-phase' ? undefined : phase
        expect(result.value.unifiedTabs?.folder[0].manualWorkPhase).toBe(expected)
        expect(result.value.tabsByWorktree.folder[0].manualWorkPhase).toBe(expected)
      }
    }
  )
  it('accepts atomic reset and omits new metadata for an old request', () => {
    const request = { worktree: 'id:folder', tabId: 'tab' }
    expect(SetTabProps.parse(request).manualWorkPhase).toBeUndefined()
    expect(SetTabProps.parse({ ...request, manualWorkPhase: null, color: null })).toMatchObject({
      manualWorkPhase: null,
      color: null
    })
  })
})
