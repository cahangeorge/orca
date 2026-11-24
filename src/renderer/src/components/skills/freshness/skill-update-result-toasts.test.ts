import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BundledSkillInstallResult,
  BundledSkillOpOutcome
} from '../../../../../shared/skills/bundled/bundled-skill-plan'

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))
const reveal = vi.fn(async () => undefined)
vi.mock('@/lib/files/os-open/reveal-in-file-manager', () => ({ revealInFileManager: reveal }))
vi.mock('./skill-backup-location', () => ({
  skillBackupDirectory: (home: string) => `${home}/.agents/.orca-skill-backups`,
  skillBackupHost: () => ({ kind: 'local' })
}))

const { middleTruncatePath, reportPreservedEdits, reportUncertainOutcome } =
  await import('./skill-update-result-toasts')
const { toast } = await import('sonner')

const LOCAL = { kind: 'local' } as const
const SKILLS = '/home/u/.agents/skills'
const result = (...ops: BundledSkillOpOutcome[]): BundledSkillInstallResult => ({
  scope: 'global',
  skills: [{ name: 'orca', status: 'ran', ops }]
})
type ToastAction = { label: string; onClick: (event: { preventDefault: () => void }) => void }

function isToastAction(value: unknown): value is ToastAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'onClick' in value &&
    typeof value.onClick === 'function'
  )
}

const shown = (kind: 'warning' | 'info') =>
  vi.mocked(toast[kind]).mock.calls.map(([title, options]) => ({
    title,
    description: typeof options?.description === 'string' ? options.description : undefined,
    action: isToastAction(options?.action) ? options.action.label : undefined
  }))
const warnings = () => shown('warning')
const infos = () => shown('info')

afterEach(() => {
  vi.mocked(toast.warning).mockClear()
  vi.mocked(toast.info).mockClear()
})

describe('automatic update result notices', () => {
  it('reports a retired copy put back in place, with its path action', () => {
    const former = '/home/u/.gemini/skills/orca'
    reportPreservedEdits(
      LOCAL,
      result({
        path: `${SKILLS}/orca`,
        kind: 'update',
        status: 'failed',
        error: 'EXDEV',
        contentApplied: true,
        backupRefusal: { path: former, source: 'in-place', onlyNotice: true }
      })
    )
    expect(warnings()).toEqual([
      {
        title: 'orca updated · Old copy kept as is',
        description: "Couldn't back it up: it's on another drive. Orca won't remind you.",
        action: 'Show in folder'
      }
    ])
  })

  it('reports a put-back beside a kept copy that was only rechecked', () => {
    reportPreservedEdits(
      LOCAL,
      result({
        path: `${SKILLS}/orca`,
        kind: 'keep',
        status: 'failed',
        error: 'EXDEV',
        currentConfirmed: true,
        backupRefusal: {
          path: '/home/u/.claude/skills/former',
          source: 'in-place',
          onlyNotice: true
        }
      })
    )
    expect(warnings().map((warning) => warning.title)).toEqual(['orca · Old copy kept as is'])
  })

  it('leaves an ordinary in-place refusal to the nudge', () => {
    reportPreservedEdits(
      LOCAL,
      result({
        path: `${SKILLS}/orca`,
        kind: 'update',
        status: 'failed',
        error: 'EXDEV',
        backupRefusal: { path: `${SKILLS}/orca`, source: 'in-place' }
      })
    )
    expect(warnings()).toEqual([])
  })

  it('does not call a backup-only keep an update', () => {
    const backup = '/home/u/.agents/.orca-skill-backups/orca-1'
    reportPreservedEdits(
      LOCAL,
      result({
        path: `${SKILLS}/orca`,
        kind: 'keep',
        status: 'done',
        backupPath: backup,
        backupPaths: [backup]
      }),
      '/home/u'
    )
    expect(infos()).toEqual([
      {
        title: 'Your edits to orca were saved separately',
        description: `Orca saved your edits to ${middleTruncatePath('~/.agents/.orca-skill-backups/orca-1')}.`,
        action: 'Show in folder'
      }
    ])
    expect(warnings()).toEqual([])
  })

  it('names every backup an update made, and says it updated the skill', () => {
    const first = '/home/u/.agents/.orca-skill-backups/orca-1'
    const second = '/home/u/.agents/.orca-skill-backups/orca-2'
    reportPreservedEdits(
      LOCAL,
      result({
        path: `${SKILLS}/orca`,
        kind: 'update',
        status: 'done',
        backupPath: first,
        backupPaths: [first, second]
      })
    )
    expect(infos().map((info) => info.description)).toEqual([
      `Orca updated the skill and saved your edits to ${middleTruncatePath(first)}.`,
      `Orca updated the skill and saved your edits to ${middleTruncatePath(second)}.`
    ])
  })

  it('titles a mixed group by what happened to every copy', () => {
    reportPreservedEdits(LOCAL, {
      scope: 'global',
      skills: [
        {
          name: 'orca',
          status: 'ran',
          ops: [
            {
              path: `${SKILLS}/orca`,
              kind: 'update',
              status: 'failed',
              error: 'EXDEV',
              contentApplied: true,
              backupRefusal: { path: `${SKILLS}/.orca.orca-old-1`, source: 'moved-aside' }
            }
          ]
        },
        {
          name: 'other',
          status: 'ran',
          ops: [
            {
              path: `${SKILLS}/other`,
              kind: 'update',
              status: 'failed',
              error: 'EXDEV',
              contentApplied: true,
              backupRefusal: {
                path: '/home/u/.gemini/skills/other',
                source: 'in-place',
                onlyNotice: true
              }
            }
          ]
        }
      ]
    })
    expect(warnings().map((warning) => warning.title)).toEqual([
      "2 old copies couldn't be backed up"
    ])
  })

  it('names no host for a local lost reply and the host for a remote one', () => {
    reportUncertainOutcome(LOCAL, { homeDirectory: '/home/u' })
    expect(warnings().map((warning) => warning.title)).toEqual(["Couldn't confirm skill updates"])
  })

  it('keeps a backup path to one line with its own name at the end', () => {
    const path =
      '/Users/sam/.agents/.orca-skill-backups/orca-cli-orchestration-2026-11-23T18-02-11-512Z'
    const cut = middleTruncatePath(path)
    expect(cut).toHaveLength(44)
    expect(cut.endsWith('2026-11-23T18-02-11-512Z')).toBe(true)
    expect(middleTruncatePath('/short/path')).toBe('/short/path')
  })

  it.each([
    ['local reveal', { kind: 'local' } as const, 'Show in folder'],
    ['remote copy', { kind: 'ssh', targetId: 'box' } as const, 'Copy path']
  ])(
    'keeps the notice open when its %s fails, so the path can still be used',
    async (_, target, label) => {
      const writeClipboardText = vi.fn(async () => {
        throw new Error('clipboard unavailable')
      })
      vi.stubGlobal('window', { api: { ui: { writeClipboardText } } })
      reveal.mockRejectedValueOnce(new Error('launch failed'))
      const former = '/home/u/.gemini/skills/orca'
      reportPreservedEdits(
        target,
        result({
          path: `${SKILLS}/orca`,
          kind: 'update',
          status: 'failed',
          error: 'EXDEV',
          contentApplied: true,
          backupRefusal: { path: former, source: 'in-place', onlyNotice: true }
        })
      )
      const action = vi.mocked(toast.warning).mock.calls[0][1]?.action
      if (!isToastAction(action)) {
        throw new Error('expected a path action')
      }
      expect(action.label).toBe(label)
      const preventDefault = vi.fn()
      action.onClick({ preventDefault })
      await Promise.resolve()
      await Promise.resolve()
      // Sonner closes an acted-on toast unless the action prevents it; this one never closes itself.
      expect(preventDefault).toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      if (target.kind === 'local') {
        expect(reveal).toHaveBeenCalledWith(former, 'local')
      } else {
        expect(writeClipboardText).toHaveBeenCalledWith(former)
      }
      vi.unstubAllGlobals()
    }
  )
})
