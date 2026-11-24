// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BundledSkillInstallResult,
  BundledSkillPlan
} from '../../../../../shared/skills/bundled/bundled-skill-plan'
import type * as SkillBackupLocationModuleNs from './skill-backup-location'

type SkillBackupLocationModule = typeof SkillBackupLocationModuleNs

const HOME = '/Users/sam'
const SKILLS = `${HOME}/.agents/skills`
const FORMER = `${HOME}/.gemini/skills/orca-cli`
const EDITED = `${HOME}/.claude/skills/orca-cli`

const planWithChoice: BundledSkillPlan = {
  scope: 'global',
  homeDirectory: HOME,
  planDigest: 'digest-1',
  skills: [
    {
      name: 'orca-cli',
      digest: 'a'.repeat(64),
      ops: [
        {
          kind: 'leave',
          path: EDITED,
          role: 'agent',
          agents: ['claude'],
          observed: { kind: 'folder', entries: ['SKILL.md:file'], skillDigest: 'b'.repeat(64) },
          reason: 'edited',
          replaceable: true,
          cleanup: []
        }
      ]
    }
  ]
}
const emptyPlan: BundledSkillPlan = {
  scope: 'global',
  homeDirectory: HOME,
  planDigest: 'digest-2',
  skills: []
}
// The run put an old copy back where the user left it; the result is that copy's only notice.
const putBackResult: BundledSkillInstallResult = {
  scope: 'global',
  skills: [
    {
      name: 'orca-cli',
      status: 'ran',
      ops: [
        {
          path: `${SKILLS}/orca-cli`,
          kind: 'update',
          status: 'failed',
          error: 'EXDEV',
          contentApplied: true,
          backupRefusal: { path: FORMER, source: 'in-place', onlyNotice: true }
        }
      ]
    }
  ]
}

const refresh = vi.fn(async () => undefined)
const freshness: {
  targetKey: string
  plan: BundledSkillPlan | null
  unsupported: null
  loading: boolean
  error: null
  refresh: typeof refresh
} = {
  targetKey: 'local',
  plan: planWithChoice,
  unsupported: null,
  loading: false,
  error: null,
  refresh
}

vi.mock('@/hooks/skills/freshness/useSkillFreshness', () => ({
  useSkillFreshness: () => freshness
}))
vi.mock('@/hooks/skills/runtime/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({ bundledSkillTarget: { kind: 'local' } })
}))
vi.mock('./use-reviewed-skill-plan', () => ({
  useReviewedSkillPlan: (_target: unknown, plan: BundledSkillPlan | null) => ({
    plan,
    loading: false,
    error: null
  })
}))
vi.mock('@/hooks/skills/discovery/installed-agent-skill-discovery', () => ({
  notifyInstalledAgentSkillsChanged: vi.fn()
}))
const execute = vi.fn(async (): Promise<BundledSkillInstallResult> => putBackResult)
vi.mock('@/runtime/skills/bundled/runtime-bundled-skills-client', () => ({
  executeBundledSkillsOnTarget: () => execute()
}))
vi.mock('./skill-backup-location', async (importOriginal) => ({
  ...(await importOriginal<SkillBackupLocationModule>()),
  useSkillBackupHost: () => ({ kind: 'local' })
}))

const { SkillFreshnessUpdateDialog } = await import('./SkillFreshnessUpdateDialog')
const { consumeSkillFreshnessUpdateDialogRequest, requestSkillFreshnessUpdateDialog } =
  await import('./skill-freshness-update-dialog')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function renderDialog(): void {
  render(
    <TooltipProvider>
      <SkillFreshnessUpdateDialog />
    </TooltipProvider>
  )
}
const store = await import('./skill-update-run-store')

async function settleRun(result: BundledSkillInstallResult): Promise<void> {
  execute.mockResolvedValueOnce(result)
  await act(async () => {
    await store.startSkillUpdateRun({
      target: { kind: 'local' },
      names: ['orca-cli'],
      planDigest: 'digest-1',
      force: []
    })
  })
}

const keptPath = () => screen.queryAllByTitle(FORMER)

beforeEach(() => {
  freshness.plan = planWithChoice
  freshness.refresh.mockClear()
})

afterEach(() => {
  cleanup()
  consumeSkillFreshnessUpdateDialogRequest()
  store._resetSkillUpdateRunStore()
  vi.useRealTimers()
})

describe('update dialog keeps a result that names the only path to a kept copy', () => {
  it('through Re-check, an empty new plan, and a fresh Replace choice, until dismissed', async () => {
    await settleRun(putBackResult)
    act(() => requestSkillFreshnessUpdateDialog({ kind: 'local' }))
    renderDialog()
    expect(keptPath().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Re-check/ }))
    expect(freshness.refresh).toHaveBeenCalled()
    expect(store.getSkillUpdateRun('local').state).toBe('done')
    expect(keptPath().length).toBeGreaterThan(0)

    // The new plan no longer lists the skill at all.
    freshness.plan = emptyPlan
    cleanup()
    renderDialog()
    expect(keptPath().length).toBeGreaterThan(0)

    // A fresh Replace choice on the refreshed plan keeps the receipt too.
    freshness.plan = planWithChoice
    cleanup()
    renderDialog()
    const replace = screen.getByRole('checkbox')
    fireEvent.click(replace)
    expect(store.getSkillUpdateRun('local').state).toBe('done')
    expect(keptPath().length).toBeGreaterThan(0)

    // A result that needs attention offers Close (Done otherwise); either one dismisses it.
    fireEvent.click(screen.getAllByRole('button', { name: /^(Close|Done)$/ })[0])
    expect(store.getSkillUpdateRun('local').state).toBe('idle')
  })
})

describe('run store success linger', () => {
  it('lets a plain success fade but keeps one that backed up an old copy', async () => {
    vi.useFakeTimers()
    await settleRun({
      scope: 'global',
      skills: [
        {
          name: 'orca-cli',
          status: 'ran',
          ops: [{ path: `${SKILLS}/orca-cli`, kind: 'update', status: 'done' }]
        }
      ]
    })
    await act(async () => {
      vi.advanceTimersByTime(store.SKILL_UPDATE_SUCCESS_LINGER_MS + 10)
    })
    expect(store.getSkillUpdateRun('local').state).toBe('idle')

    const backup = `${HOME}/.agents/.orca-skill-backups/orca-cli-1`
    await settleRun({
      scope: 'global',
      skills: [
        {
          name: 'orca-cli',
          status: 'ran',
          ops: [
            {
              path: `${SKILLS}/orca-cli`,
              kind: 'keep',
              status: 'done',
              backupPath: backup,
              backupPaths: [backup]
            }
          ]
        }
      ]
    })
    await act(async () => {
      vi.advanceTimersByTime(store.SKILL_UPDATE_SUCCESS_LINGER_MS * 3)
    })
    expect(store.getSkillUpdateRun('local').state).toBe('done')
  })
})
