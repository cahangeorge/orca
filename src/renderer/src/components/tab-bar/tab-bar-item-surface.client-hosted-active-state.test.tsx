// @vitest-environment happy-dom

import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceVisibleTabType } from '../../../../shared/tab-types'
import {
  clearClientHostedBrowserRowSelection,
  getClientHostedBrowserRowSelection,
  selectClientHostedBrowserRow
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import { getTabDragLabel, getTabLayoutSignature } from './tab-bar-item-model'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TabBarItem } from './tab-bar-item-model'
import type { TabBarProps } from './tab-bar-props'
import type { TabBarRuntimeModel } from './use-tab-bar-runtime-model'
import { renderTabBarItems } from './tab-bar-item-surface'

const ITEMS: TabBarItem[] = [
  {
    type: 'terminal',
    id: 'terminal-1',
    unifiedTabId: 'unified-terminal-1',
    isPinned: false,
    data: {
      id: 'terminal-1',
      ptyId: null,
      worktreeId: 'wt-1',
      title: 'Setup',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    }
  },
  {
    type: 'browser',
    id: 'browser-1',
    unifiedTabId: 'unified-browser-1',
    isPinned: false,
    data: {
      id: 'browser-1',
      worktreeId: 'wt-1',
      url: 'https://example.test/',
      title: 'Example Domain',
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 0
    }
  },
  {
    type: 'editor',
    id: 'file-1',
    unifiedTabId: 'unified-file-1',
    isPinned: false,
    data: {
      id: 'file-1',
      filePath: '/repo/README.md',
      relativePath: 'README.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      isPreview: false,
      isDirty: false,
      mode: 'edit'
    }
  }
]

// Only the fields renderTabBarItems reads; nothing else reaches an isActive decision.
const RUNTIME = {
  resolvedGroupId: 'group-1',
  generatedTabTitlesEnabled: false,
  unifiedTabByVisibleId: new Map(),
  nativeChatEnabled: false,
  tabAgentTypesByTabId: {},
  nativeChatTabWideFallbackUnsafeTabsById: {},
  nativeChatTranscriptIsLocalReadable: false,
  managedBrowserCreationEnabled: false,
  toggleTabViewMode: () => {},
  statusByRelativePath: new Map()
} as unknown as TabBarRuntimeModel

function makeProps(activeTabType: WorkspaceVisibleTabType): TabBarProps {
  return {
    worktreeId: 'wt-1',
    activeTabId: 'terminal-1',
    activeFileId: 'file-1',
    activeBrowserTabId: 'browser-1',
    activeSimulatorTabId: null,
    activeTabType,
    groupActiveTabId: 'unified-terminal-1',
    expandedPaneByTabId: {}
  } as unknown as TabBarProps
}

function activeFlags(
  activeTabType: WorkspaceVisibleTabType,
  activeClientHostedBrowserRowId: string | null
): boolean[] {
  const rendered = renderTabBarItems({
    items: ITEMS,
    props: makeProps(activeTabType),
    runtime: RUNTIME,
    dropIndicatorByVisibleId: new Map(),
    includeTopTabBorder: true,
    activeClientHostedBrowserRowId,
    togglePinned: () => {}
  })
  return rendered.map(
    (node) => (node as React.ReactElement<{ isActive: boolean }>).props.isActive === true
  )
}

afterEach(() => {
  clearClientHostedBrowserRowSelection()
})

/**
 * A client-hosted row covers the pane without moving the group's `activeTabId`, so the strip's two
 * halves would each keep painting an underline — the reported double highlight.
 */
describe('real tabs while a client-hosted row is selected', () => {
  it.each<WorkspaceVisibleTabType>(['terminal', 'browser', 'editor'])(
    'underlines the %s tab the group is actually showing when no row is selected',
    (activeTabType) => {
      expect(activeFlags(activeTabType, null).filter(Boolean)).toHaveLength(1)
    }
  )

  it.each<WorkspaceVisibleTabType>(['terminal', 'browser', 'editor'])(
    'renders the %s tab inactive while a row owns the pane',
    (activeTabType) => {
      expect(activeFlags(activeTabType, 'page-1')).toEqual([false, false, false])
    }
  )
})

describe('client-hosted row while a real tab is activated', () => {
  it.each(ITEMS.map((item, index) => [item.type, index] as const))(
    'retires the row selection when the %s tab is clicked',
    (_type, index) => {
      selectClientHostedBrowserRow({
        worktreeId: 'wt-1',
        browserPageId: 'page-1',
        groupId: 'group-1',
        groupActiveTabIdAtSelection: 'unified-terminal-1'
      })
      const rendered = renderTabBarItems({
        items: ITEMS,
        props: makeProps('terminal'),
        runtime: RUNTIME,
        dropIndicatorByVisibleId: new Map(),
        includeTopTabBorder: true,
        activeClientHostedBrowserRowId: 'page-1',
        togglePinned: () => {}
      })

      const clicked = rendered[index] as React.ReactElement<{
        onActivate: (id: string) => void
      }>
      clicked.props.onActivate('terminal-1')

      expect(getClientHostedBrowserRowSelection()).toBeNull()
    }
  )
})

describe('Native Chat automatic tab titles', () => {
  const chat: TabBarItem = {
    type: 'agent-session',
    id: 'chat-1',
    unifiedTabId: 'chat-1',
    isPinned: false,
    data: {
      id: 'chat-1',
      entityId: 'session-1',
      worktreeId: 'wt-1',
      groupId: 'group-1',
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Codex Chat',
      generatedLabel: 'Fix login retries',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    }
  }

  it.each([true, false])(
    'renders the actual Native Chat tab text when automatic titles are %s',
    (enabled) => {
      const nodes = renderTabBarItems({
        items: [chat],
        props: makeProps('agent-session'),
        runtime: { ...RUNTIME, generatedTabTitlesEnabled: enabled },
        dropIndicatorByVisibleId: new Map(),
        includeTopTabBorder: true,
        activeClientHostedBrowserRowId: null,
        togglePinned: () => {}
      })
      const tab = (nodes[0] as React.ReactElement<{ tab: TerminalTab }>).props.tab
      expect(tab.title).toBe(enabled ? 'Fix login retries' : 'Codex Chat')
      const view = render(<TooltipProvider>{nodes}</TooltipProvider>)
      expect(view.getByText(enabled ? 'Fix login retries' : 'Codex Chat')).toBeTruthy()
      cleanup()
    }
  )

  it('renders a manual Native Chat name ahead of a generated title', () => {
    const nodes = renderTabBarItems({
      items: [{ ...chat, data: { ...chat.data, customLabel: 'My investigation' } }],
      props: makeProps('agent-session'),
      runtime: { ...RUNTIME, generatedTabTitlesEnabled: true },
      dropIndicatorByVisibleId: new Map(),
      includeTopTabBorder: true,
      activeClientHostedBrowserRowId: null,
      togglePinned: () => {}
    })
    const view = render(<TooltipProvider>{nodes}</TooltipProvider>)
    expect(view.getByText('My investigation')).toBeTruthy()
    expect(view.queryByText('Fix login retries')).toBeNull()
    cleanup()
  })

  it('uses the same title for dragging and layout when automatic titles are toggled', () => {
    expect(getTabDragLabel(chat, true)).toBe('Fix login retries')
    expect(getTabDragLabel(chat, false)).toBe('Codex Chat')
    expect(
      getTabLayoutSignature(chat, { generatedTitlesEnabled: true, isExpanded: false })
    ).toContain('Fix login retries')
    if (chat.type !== 'agent-session') {
      throw new Error('expected Native Chat fixture')
    }
    expect(
      getTabDragLabel({ ...chat, data: { ...chat.data, customLabel: 'My investigation' } }, true)
    ).toBe('My investigation')
  })
})
