// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BundledSkillInstallResult,
  BundledSkillOpOutcome
} from '../../../../../shared/skills/bundled/bundled-skill-plan'
import { summarizeBundledSkillOutcomes } from '../../../../../shared/skills/bundled/bundled-skill-summary'
import type {
  BundledSkillInstall,
  BundledSkillInstallState
} from '@/hooks/skills/installation/use-bundled-skill-install'
import type { BundledSkillInstallActionState } from '@/hooks/skills/installation/use-bundled-skill-install-action'

const HOME = '/Users/sam'
const FORMER = `${HOME}/.gemini/skills/orca-cli`
const EDITED = `${HOME}/.claude/skills/orca-cli`
const LIVE_EDITED = `${HOME}/.cursor/skills/orca-cli`

const putBack: BundledSkillOpOutcome = {
  path: `${HOME}/.agents/skills/orca-cli`,
  kind: 'update',
  status: 'failed',
  error: 'EXDEV',
  contentApplied: true,
  backupRefusal: { path: FORMER, source: 'in-place', onlyNotice: true }
}

function done(ops: BundledSkillOpOutcome[]): BundledSkillInstallState {
  const result: BundledSkillInstallResult = {
    scope: 'global',
    skills: [{ name: 'orca-cli', status: 'ran', ops }]
  }
  return {
    kind: 'done',
    result,
    summary: summarizeBundledSkillOutcomes(result),
    homeDirectory: HOME,
    backupHost: { kind: 'local' }
  }
}

const install = vi.fn(async () => null)
const retry = vi.fn()
let installState: BundledSkillInstallState = done([putBack])
let liveAction: BundledSkillInstallActionState = { kind: 'replace', paths: [LIVE_EDITED] }

vi.mock('@/hooks/skills/installation/use-bundled-skill-install', async () => ({
  ...(await import('@/hooks/skills/installation/bundled-skill-install-attention')),
  useBundledSkillInstall: (): BundledSkillInstall => ({
    state: installState,
    ready: true,
    install,
    retry
  })
}))
vi.mock('@/hooks/skills/installation/use-bundled-skill-install-action', () => ({
  useBundledSkillInstallAction: () => liveAction
}))
vi.mock('@/hooks/skills/runtime/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({ bundledSkillTarget: { kind: 'local' } })
}))
vi.mock('../freshness/SkillFreshnessStatusPill', () => ({
  SkillPlanStatusPill: () => null,
  SkillUnsupportedStatusPill: () => null
}))

// Heavy leaves this check doesn't exercise; the app store alone takes minutes to load here.
vi.mock('@/store/index', () => ({
  useAppStore: Object.assign(() => undefined, { getState: () => ({ runtimeEnvironments: [] }) })
}))
vi.mock('@/lib/files/os-open/reveal-in-file-manager', () => ({ revealInFileManager: vi.fn() }))
vi.mock('./WslAgentSkillSetupPanel', () => ({ WslAgentSkillSetupPanel: () => null }))
vi.mock('./agent-skill-recheck-surface-sync', () => ({
  recheckSurfacesAfterAgentSkillInstall: vi.fn(),
  syncSurfacesAfterAgentSkillRecheck: vi.fn()
}))
vi.mock('@/lib/skills/installation/agent-feature-install-commands', () => ({
  buildAgentFeatureSkillInstallCommand: () => ''
}))
vi.mock('../../../lib/skills/runtime/skill-runtime-command', () => ({
  buildSkillCommandForRuntime: () => ''
}))
vi.mock('@/lib/skills/presentation/skill-freshness-display-status', () => ({
  skillPlanHasDetails: () => false
}))
vi.mock('../../integrations/presentation/integration-status-pill', () => ({
  IntegrationStatusPill: () => null
}))

const { AgentSkillSetupPanel } = await import('./AgentSkillSetupPanel')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function renderPanel(): void {
  render(
    <TooltipProvider>
      <AgentSkillSetupPanel
        variant="row"
        title="Orca skill for agents"
        description="Enables agents to use Orca."
        skillNames={['orca-cli']}
        target={{ kind: 'local' }}
        installed
        loading={false}
        error={null}
        onRecheck={() => undefined}
      />
    </TooltipProvider>
  )
}

const writeClipboardText = vi.fn(async () => undefined)

beforeEach(() => {
  install.mockClear()
  retry.mockClear()
  writeClipboardText.mockClear()
  Reflect.set(window, 'api', { ui: { writeClipboardText } })
  installState = done([putBack])
  liveAction = { kind: 'replace', paths: [LIVE_EDITED] }
})

afterEach(cleanup)

describe('Settings after a run whose only problem was a refused backup', () => {
  it('keeps the receipt and offers the live plan’s Replace with fresh consent, not Retry', async () => {
    renderPanel()
    expect(screen.getAllByTitle(FORMER).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
    const replace = screen.getByRole('button', { name: /Replace with Orca/ })
    await act(async () => {
      fireEvent.click(replace)
    })
    // The paths come from the live plan, never from the old run's saved choices.
    expect(install).toHaveBeenCalledWith(['orca-cli'], [LIVE_EDITED])
    expect(retry).not.toHaveBeenCalled()
  })

  it('offers the live plan’s Update when a location became runnable', async () => {
    liveAction = { kind: 'run' }
    renderPanel()
    const update = screen.getByRole('button', { name: /Update/ })
    await act(async () => {
      fireEvent.click(update)
    })
    expect(install).toHaveBeenCalledWith(['orca-cli'], undefined)
  })

  it('keeps Retry, and holds back fresh actions, when something else also failed', () => {
    installState = done([
      putBack,
      { path: EDITED, kind: 'link', status: 'failed', error: 'EACCES' }
    ])
    renderPanel()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Replace with Orca/ })).toBeNull()
  })

  it('copies the full kept path from the keyboard', async () => {
    renderPanel()
    const copy = screen.getByRole('button', { name: 'Copy path' })
    copy.focus()
    expect(document.activeElement).toBe(copy)
    await act(async () => {
      fireEvent.keyDown(copy, { key: 'Enter' })
      fireEvent.click(copy)
    })
    expect(writeClipboardText).toHaveBeenCalledWith(FORMER)
  })
})
