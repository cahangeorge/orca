import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { Tab } from '../../../../shared/tab-types'
import { buildMirroredAgentTabs } from './terminal-surfaces'

const snapshot: RuntimeMobileSessionTabsResult = {
  worktree: 'folder',
  publicationEpoch: 'epoch',
  snapshotVersion: 1,
  activeGroupId: 'group',
  activeTabId: null,
  activeTabType: null,
  tabs: [
    {
      type: 'agent-session',
      id: 'host-tab',
      title: 'Stable',
      sessionId: 'session',
      agent: 'codex',
      isActive: false,
      color: 'var(--primary)',
      manualWorkPhase: 'planning'
    }
  ]
}
function build(current: Tab[] = [], next = snapshot) {
  return buildMirroredAgentTabs(next, new Map(), 'group', 0, current, 1)[0].unifiedTab
}

describe('mirrored conversation phase overrides', () => {
  it('adopts host metadata on first load and preserves atomic automatic reset through stale snapshots', () => {
    const first = build()
    expect(first.manualWorkPhase).toBe('planning')
    const reset = { ...first, color: null, manualWorkPhase: null }
    const repeated = build([reset])
    expect(repeated.color).toBeNull()
    expect(repeated.manualWorkPhase).toBeNull()
    expect(repeated.label).toBe('Stable')
  })
  it('keeps manual phase when an old host omits optional metadata', () => {
    const first = build()
    const old: RuntimeMobileSessionTabsResult = {
      ...snapshot,
      tabs: [
        {
          type: 'agent-session',
          id: 'host-tab',
          title: 'Stable',
          sessionId: 'session',
          agent: 'codex',
          isActive: false
        }
      ]
    }
    expect(build([first], old).manualWorkPhase).toBe('planning')
  })
})
