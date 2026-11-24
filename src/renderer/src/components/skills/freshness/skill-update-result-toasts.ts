import { toast } from 'sonner'
import type {
  BundledSkillInstallResult,
  BundledSkillPlan
} from '../../../../../shared/skills/bundled/bundled-skill-plan'
import {
  bundledSkillOpBackupPaths,
  bundledSkillOpKindPublishes,
  bundledSkillRefusalNotices,
  type BundledSkillRefusalNotice
} from '../../../../../shared/skills/bundled/bundled-skill-backup-refusal'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'
import { collapseHomePath } from '../../../../../shared/skills/bundled/bundled-skill-locations'
import { revealInFileManager } from '@/lib/files/os-open/reveal-in-file-manager'
import type { BundledSkillTarget } from '@/lib/skills/runtime/bundled-skill-target'
import { translate } from '@/i18n/i18n'
import { skillBackupDirectory, skillBackupHost } from './skill-backup-location'

// Sticky toasts for what a skill update moved, kept or couldn't confirm; the automatic update
// has no dialog, so these are its only result.

const SHOWN_PATH_LENGTH = 44

/** One line in a toast: the start of the path, then its end (the backup's own name) after `…`. */
export function middleTruncatePath(path: string, max = SHOWN_PATH_LENGTH): string {
  if (path.length <= max) {
    return path
  }
  const head = Math.floor((max - 1) / 3)
  return `${path.slice(0, head)}…${path.slice(path.length - (max - 1 - head))}`
}

function warnAboutEdits(title: string, description: string): void {
  toast.warning(title, { description, duration: Number.POSITIVE_INFINITY })
}

async function copyRetainedPath(path: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(path)
    toast.success(translate('auto.components.skills.SkillRow.pathCopied', 'Path copied'))
  } catch {
    // The notice stays open, so the user can try again.
  }
}

/**
 * Show in folder where this computer can open the path, Copy path for another host's. The toast
 * may be the only notice of this path, so acting on it never closes it: a failed reveal or copy
 * leaves the path and the action in place, and only Dismiss closes it.
 */
function retainedPathAction(target: BundledSkillTarget, path: string) {
  return target.kind === 'local'
    ? {
        label: translate(
          'auto.components.skills.skillBackupRefusal.showInFolder',
          'Show in folder'
        ),
        onClick: (event: { preventDefault: () => void }) => {
          event.preventDefault()
          void revealInFileManager(path, LOCAL_EXECUTION_HOST_ID)
        }
      }
    : {
        label: translate('auto.components.skills.SkillRow.copyPath', 'Copy path'),
        onClick: (event: { preventDefault: () => void }) => {
          event.preventDefault()
          void copyRetainedPath(path)
        }
      }
}

function dismissAction() {
  return {
    label: translate('auto.components.skills.skillBackupRefusal.dismiss', 'Dismiss'),
    onClick: () => undefined
  }
}

function refusalToastTitle(notice: BundledSkillRefusalNotice): string {
  // A retired copy put back where the user left it.
  if (notice.source === 'in-place') {
    return notice.contentApplied
      ? translate(
          'auto.components.skills.skillBackupRefusal.toastTitleKeptInPlace',
          '{{value0}} updated · Old copy kept as is',
          { value0: notice.skill }
        )
      : translate(
          'auto.components.skills.skillBackupRefusal.toastTitleKeptInPlaceOnly',
          '{{value0}} · Old copy kept as is',
          { value0: notice.skill }
        )
  }
  return notice.contentApplied
    ? translate(
        'auto.components.skills.skillBackupRefusal.toastTitle',
        '{{value0}} updated · Old copy moved aside',
        { value0: notice.skill }
      )
    : translate(
        'auto.components.skills.skillBackupRefusal.toastTitleKept',
        '{{value0}} · Old copy moved aside',
        { value0: notice.skill }
      )
}

/**
 * The automatic flow reports a moved copy, and any copy no later plan may mention (a retired copy
 * put back in place, or a former root's). Other in-place and left-over copies stay in the nudge.
 */
function automaticRefusalNotices(
  result: BundledSkillInstallResult | null
): BundledSkillRefusalNotice[] {
  return bundledSkillRefusalNotices(result).filter(
    (notice) => notice.source === 'moved-aside' || !notice.offeredAgain
  )
}

// Sticky: for an automatic update this toast is the only notice, and for a former root's copy
// no later plan mentions it again.
function warnAboutRefusal(target: BundledSkillTarget, notice: BundledSkillRefusalNotice): void {
  const reason = translate(
    'auto.components.skills.skillBackupRefusal.toastReason',
    "Couldn't back it up: it's on another drive."
  )
  // Only a published copy is an update; a kept copy that was only rechecked is not.
  const title = refusalToastTitle(notice)
  toast.warning(title, {
    description: notice.offeredAgain
      ? reason
      : `${reason} ${translate('auto.components.skills.skillBackupRefusal.toastNoReminder', "Orca won't remind you.")}`,
    duration: Number.POSITIVE_INFINITY,
    action: retainedPathAction(target, notice.path),
    cancel: dismissAction()
  })
}

function warnAboutRefusals(
  target: BundledSkillTarget,
  notices: readonly BundledSkillRefusalNotice[]
): void {
  if (notices.length === 1) {
    warnAboutRefusal(target, notices[0])
    return
  }
  const allMoved = notices.every((notice) => notice.source === 'moved-aside')
  toast.warning(
    allMoved
      ? translate(
          'auto.components.skills.skillBackupRefusal.toastGroupTitle',
          '{{count}} old copies moved aside',
          { count: notices.length }
        )
      : translate(
          'auto.components.skills.skillBackupRefusal.toastGroupTitleMixed',
          "{{count}} old copies couldn't be backed up",
          { count: notices.length }
        ),
    {
      description: translate(
        'auto.components.skills.skillBackupRefusal.toastGroupReason',
        "They're on another drive."
      ),
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: translate('auto.components.skills.skillBackupRefusal.showDetails', 'Show details'),
        onClick: () => notices.forEach((notice) => warnAboutRefusal(target, notice))
      },
      cancel: dismissAction()
    }
  )
}

/** A write that raced the update is kept aside; never let that pass as a silent success. */
export function reportPreservedEdits(
  target: BundledSkillTarget,
  result: BundledSkillInstallResult | null,
  /** The host's home, so a path under it reads from `~/`; the action still opens the full path. */
  homeDirectory?: string
): void {
  const refusals = automaticRefusalNotices(result)
  if (refusals.length > 0) {
    warnAboutRefusals(target, refusals)
  }
  for (const skill of result?.skills ?? []) {
    for (const op of skill.ops) {
      // A refused backup is reported above; strandedPath alone covers other backup failures.
      if (op.strandedPath && !op.backupRefusal) {
        warnAboutEdits(
          translate(
            'auto.components.skills.skillFreshnessAutoUpdate.strandedTitle',
            "Orca couldn't back up your edits to {{value0}}",
            { value0: skill.name }
          ),
          translate(
            'auto.components.skills.skillFreshnessAutoUpdate.strandedDescription',
            'Your edits are still in {{value0}}. Copy them somewhere safe before updating again.',
            { value0: op.strandedPath }
          )
        )
      }
      // Backups that finished still surface beside a later refusal in the same op. Only an op
      // that published new content may say it updated the skill.
      const published =
        bundledSkillOpKindPublishes(op.kind) && (op.status === 'done' || op.contentApplied === true)
      for (const backupPath of bundledSkillOpBackupPaths(op)) {
        const shown = middleTruncatePath(
          homeDirectory ? collapseHomePath(backupPath, homeDirectory) : backupPath
        )
        // The edits are safe, so this is information, not a warning; the action opens the copy.
        toast.info(
          translate(
            'auto.components.skills.skillFreshnessAutoUpdate.preservedTitle',
            'Your edits to {{value0}} were saved separately',
            { value0: skill.name }
          ),
          {
            description: published
              ? translate(
                  'auto.components.skills.skillFreshnessAutoUpdate.preservedDescription',
                  'Orca updated the skill and saved your edits to {{value0}}.',
                  { value0: shown }
                )
              : translate(
                  'auto.components.skills.skillFreshnessAutoUpdate.preservedBackupOnly',
                  'Orca saved your edits to {{value0}}.',
                  { value0: shown }
                ),
            duration: Number.POSITIVE_INFINITY,
            action: retainedPathAction(target, backupPath),
            cancel: dismissAction()
          }
        )
      }
    }
  }
}

/** A remote host's name; the local title names no host. */
function remoteHostName(target: BundledSkillTarget): string {
  const host = skillBackupHost(target)
  return host.kind === 'remote' ? host.name : ''
}

/** A lost or timed-out reply may follow a committed swap, so its backups must not go unmentioned. */
export function reportUncertainOutcome(
  target: BundledSkillTarget,
  plan: Pick<BundledSkillPlan, 'homeDirectory'>
): void {
  // A refused backup leaves an edited copy beside its skill, so name both places.
  toast.warning(
    target.kind === 'local'
      ? translate(
          'auto.components.skills.skillFreshnessAutoUpdate.uncertainTitleLocal',
          "Couldn't confirm skill updates"
        )
      : translate(
          'auto.components.skills.skillFreshnessAutoUpdate.uncertainTitleShort',
          "Couldn't confirm skill updates on {{value0}}",
          { value0: remoteHostName(target) }
        ),
    {
      description: translate(
        'auto.components.skills.skillFreshnessAutoUpdate.uncertainEditedCopies',
        'Edited copies are in the backup folder or next to their skill.'
      ),
      duration: Number.POSITIVE_INFINITY,
      action: retainedPathAction(target, skillBackupDirectory(plan.homeDirectory)),
      cancel: dismissAction()
    }
  )
}
