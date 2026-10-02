/** @vitest-environment happy-dom */
import type * as TerminalActivityModule from './terminal-tab-activity-status'
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SortableTab from './SortableTab'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const state = vi.hoisted(() => ({
  settings: { tabAutoPhaseBackground: true, tabAgentStatusIcon: true },
  phase: 'implementation',
  status: 'working',
  unread: false
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))
vi.mock('./use-conversation-tab-phase', () => ({
  useConversationTabPhase: () => ({ phase: state.phase, observation: 'live' })
}))
vi.mock('@/lib/use-tab-agent', () => ({ useTabAgent: () => 'codex' }))
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {} })
}))
vi.mock('./terminal-tab-activity-status', async (original) => ({
  ...(await original<typeof TerminalActivityModule>()),
  resolveTerminalTabActivityStatus: () => state.status,
  terminalTabHasUnreadActivity: () => state.unread
}))
vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
vi.mock('./SortableTabContextMenu', () => ({ SortableTabContextMenu: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

const noop = () => {}
const props: ComponentProps<typeof SortableTab> = {
  tab: {
    id: 'tab',
    worktreeId: 'folder',
    ptyId: null,
    title: 'Stable conversation',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    launchAgent: 'codex'
  },
  unifiedTabId: 'tab',
  groupId: 'group',
  tabCount: 2,
  hasTabsToRight: true,
  hasTabsToLeft: false,
  isActive: true,
  isPinned: false,
  isExpanded: false,
  onActivate: noop,
  onClose: noop,
  onCloseOthers: noop,
  onCloseToRight: noop,
  onCloseToLeft: noop,
  onSetCustomTitle: noop,
  onSetTabColor: noop,
  onTogglePin: noop,
  onToggleExpand: noop,
  dragData: {
    kind: 'tab',
    worktreeId: 'folder',
    groupId: 'group',
    unifiedTabId: 'tab',
    visibleTabId: 'tab',
    tabType: 'terminal',
    label: 'Stable conversation',
    color: null
  }
}
const mounted: (() => void)[] = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) {
    act(unmount)
  }
  state.settings.tabAutoPhaseBackground = true
  state.settings.tabAgentStatusIcon = true
  state.status = 'working'
  state.phase = 'implementation'
  state.unread = false
})
function render(overrides: Partial<ComponentProps<typeof SortableTab>> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<SortableTab {...props} {...overrides} />))
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  return {
    container,
    update: () => act(() => root.render(<SortableTab {...props} {...overrides} />))
  }
}

describe('real conversation tab DOM', () => {
  it('changes whole-tab phase independently of response status and stable title', () => {
    const { container, update } = render()
    const tab = container.querySelector('[data-testid="sortable-tab"]')
    expect(tab?.getAttribute('data-conversation-phase')).toBe('implementation')
    expect(tab?.getAttribute('style')).toContain('--conversation-phase-implementation-surface')
    expect(container.querySelector('[data-agent-spinner]')).not.toBeNull()
    state.phase = 'verification'
    state.status = 'done'
    update()
    expect(tab?.getAttribute('data-conversation-phase')).toBe('verification')
    expect(tab?.getAttribute('data-tab-title')).toBe('Stable conversation')
    expect(container.querySelector('.lucide-circle-check')).not.toBeNull()
    expect(container.querySelector('[data-agent-icon="codex"]')).not.toBeNull()
    expect(tab?.getAttribute('data-active')).toBe('true')
  })
  it('keeps manual color across automatic toggle and removes decorative dot', () => {
    state.settings.tabAutoPhaseBackground = false
    const { container } = render({
      tab: { ...props.tab, color: 'var(--primary)', manualWorkPhase: 'planning' },
      isPinned: true,
      isActive: false,
      dropIndicator: 'left'
    })
    const tab = container.querySelector('[data-testid="sortable-tab"]')
    expect(
      renderToStaticMarkup(
        <SortableTab {...props} tab={{ ...props.tab, color: 'var(--primary)' }} />
      )
    ).toContain('color-mix')
    expect(tab?.getAttribute('data-pinned')).toBe('true')
    expect(container.querySelector('span.rounded-full:not([data-agent-spinner])')).toBeNull()
    expect(container.querySelector('[data-agent-spinner]')).not.toBeNull()
  })
  it('disables automatic background and status glyphs independently', () => {
    state.settings.tabAutoPhaseBackground = false
    const { container, update } = render()
    expect(
      container.querySelector('[data-conversation-phase]')?.getAttribute('style') ?? ''
    ).not.toContain('background-color')
    expect(container.querySelector('[data-agent-spinner]')).not.toBeNull()
    state.settings.tabAgentStatusIcon = false
    state.unread = true
    update()
    expect(container.querySelector('[data-agent-spinner]')).toBeNull()
    expect(container.querySelector('[data-testid="tab-activity-bell"]')).toBeNull()
    expect(container.querySelector('[data-agent-icon="codex"]')).not.toBeNull()
  })
})
