// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type {
  AgentSessionStatusEvent,
  AgentSessionStatusSummary
} from '../../../../shared/agent-session-wire'
import type { Tab } from '../../../../shared/tab-types'
import type { AppState } from '@/store/types'

const mocks = vi.hoisted(() => ({
  store: null as null | { getState: () => AppState; setState: (state: Partial<AppState>) => void },
  readOutline: vi.fn(),
  subscribeStatus: vi.fn(),
  unsubscribe: vi.fn()
}))
vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/slices/store-test-helpers')
  const useAppStore = createTestStore()
  mocks.store = useAppStore
  return { useAppStore }
})
vi.mock('@/lib/worktree-runtime-owner', () => ({ getRuntimeEnvironmentIdForWorktree: () => null }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  readStructuredAgentSessionConversationOutline: mocks.readOutline,
  callStructuredAgentSession: vi.fn(),
  subscribeStructuredAgentSession: vi.fn(),
  subscribeStructuredAgentSessionStatus: mocks.subscribeStatus
}))
import { StructuredAgentSessionStatusBridge } from './StructuredAgentSessionStatusBridge'
import { resetStructuredAgentSessionStatusFeedsForTests } from '@/runtime/structured-agent-session-status-feed'

const structuredTab = {
  id: 'structured-tab-1',
  worktreeId: 'wt-1',
  groupId: 'group-1',
  contentType: 'agent-session',
  entityId: 'session-1',
  label: 'Codex Chat',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0,
  agentSessionAgent: 'codex'
} satisfies Tab
function summary(overrides: Partial<AgentSessionStatusSummary> = {}): AgentSessionStatusSummary {
  return {
    sessionId: 'session-1',
    workspaceId: 'wt-1',
    agent: 'codex',
    status: 'working',
    hostExecutionOwned: true,
    latestPrompt: 'hello',
    updatedAt: 1,
    ...overrides
  }
}
function feed(): { emit: (event: AgentSessionStatusEvent) => void } {
  const call = mocks.subscribeStatus.mock.calls[0]
  if (!call) {
    throw new Error('status feed not subscribed')
  }
  return { emit: call[1] }
}

function outline(...prompts: string[]) {
  return {
    sessionId: 'session-1',
    cursor: { sequence: 10 },
    omittedEntries: 0,
    entries: prompts.map((preview, sequence) => ({
      itemId: String(sequence),
      sequence,
      preview,
      imageCount: 0
    }))
  }
}

describe('Native Chat generated titles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStructuredAgentSessionStatusFeedsForTests()
    mocks.subscribeStatus.mockResolvedValue({ unsubscribe: mocks.unsubscribe })
    mocks.readOutline.mockResolvedValue(outline('Please fix login retries'))
    mocks.store?.setState({
      agentStatusByPaneKey: {},
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: false },
      unifiedTabsByWorktree: { 'wt-1': [structuredTab] }
    })
  })
  afterEach(() => {
    cleanup()
    resetStructuredAgentSessionStatusFeedsForTests()
  })
  function generatedLabel(): string | null | undefined {
    return mocks.store?.getState().unifiedTabsByWorktree['wt-1']?.[0]?.generatedLabel
  }

  it('generates a short title for an existing Native Chat from the host prompt', async () => {
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() =>
      feed().emit({
        type: 'status',
        session: summary({ latestPrompt: 'Please fix login retries' })
      })
    )
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'))
    act(() =>
      feed().emit({ type: 'status', session: summary({ latestPrompt: 'continue', updatedAt: 2 }) })
    )
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'))
  })

  it('does not generate titles when disabled or overwrite manual names', async () => {
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() =>
      feed().emit({ type: 'status', session: summary({ latestPrompt: 'Fix login retries' }) })
    )
    expect(generatedLabel()).toBeFalsy()
    act(() =>
      mocks.store?.setState({
        unifiedTabsByWorktree: { 'wt-1': [{ ...structuredTab, customLabel: 'My investigation' }] },
        settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
      })
    )
    expect(generatedLabel()).toBeFalsy()
    expect(mocks.store?.getState().unifiedTabsByWorktree['wt-1'][0].customLabel).toBe(
      'My investigation'
    )
  })

  it('generates from cached status when the setting is enabled without a new host event', async () => {
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() =>
      feed().emit({ type: 'status', session: summary({ latestPrompt: 'Fix login retries' }) })
    )
    expect(generatedLabel()).toBeFalsy()
    act(() =>
      mocks.store?.setState({
        settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
      })
    )
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'))
  })

  it('repairs a resumed title using the original conversation instead of an acknowledgement', async () => {
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true },
      unifiedTabsByWorktree: { 'wt-1': [{ ...structuredTab, generatedLabel: 'Da ai acordul' }] }
    })
    mocks.readOutline.mockResolvedValue(outline('Please fix login retries', 'da ai acordul'))
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() => feed().emit({ type: 'status', session: summary({ latestPrompt: 'da ai acordul' }) }))
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'))
    act(() =>
      feed().emit({ type: 'status', session: summary({ latestPrompt: 'continue', updatedAt: 2 }) })
    )
    await waitFor(() => expect(mocks.readOutline).toHaveBeenCalledTimes(1))
  })

  it('does not use the latest acknowledgement when an older host has no outline', async () => {
    mocks.readOutline.mockResolvedValue(null)
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() => feed().emit({ type: 'status', session: summary({ latestPrompt: 'da ai acordul' }) }))
    await waitFor(() => expect(mocks.readOutline).toHaveBeenCalledTimes(1))
    expect(generatedLabel()).toBeFalsy()
  })

  it('retries a transient outline failure once without a new status event', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.readOutline
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(outline('Please fix login retries'))
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() => feed().emit({ type: 'status', session: summary({ latestPrompt: 'continue' }) }))
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'), { timeout: 2000 })
    expect(mocks.readOutline).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledWith(
      'Native Chat automatic title: conversation outline read failed'
    )
    warning.mockRestore()
  })

  it('preserves a manual rename while the outline is pending and generates after clearing it', async () => {
    let finish: (value: ReturnType<typeof outline>) => void = () => {}
    mocks.readOutline.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof outline>>((resolve) => {
          finish = resolve
        })
    )
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    act(() => feed().emit({ type: 'status', session: summary({ latestPrompt: 'continue' }) }))
    await waitFor(() => expect(mocks.readOutline).toHaveBeenCalledTimes(1))
    act(() =>
      mocks.store?.setState({
        unifiedTabsByWorktree: { 'wt-1': [{ ...structuredTab, customLabel: 'Manual' }] }
      })
    )
    await act(async () => finish(outline('Please fix login retries')))
    expect(generatedLabel()).toBeFalsy()
    act(() => mocks.store?.setState({ unifiedTabsByWorktree: { 'wt-1': [structuredTab] } }))
    await waitFor(() => expect(generatedLabel()).toBe('Fix login retries'))
  })

  it('waits for a nonempty prompt before generating a Native Chat title', async () => {
    mocks.store?.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1))
    mocks.readOutline.mockResolvedValue(outline('  '))
    act(() => feed().emit({ type: 'status', session: summary({ latestPrompt: '  ' }) }))
    expect(generatedLabel()).toBeFalsy()
  })
})
