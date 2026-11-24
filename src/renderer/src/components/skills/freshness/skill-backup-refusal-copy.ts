import type {
  BundledSkillInstallResult,
  BundledSkillOutcome
} from '../../../../../shared/skills/bundled/bundled-skill-plan'
import {
  bundledSkillOutcomeRefusalNotices,
  bundledSkillOutcomeUpdatedSomething,
  type BundledSkillRefusalNotice
} from '../../../../../shared/skills/bundled/bundled-skill-backup-refusal'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** The path is never part of a sentence: it sits on its own line between `reason` and `next`. */
export type SkillRefusalLines = { reason: string; path: string; next: string }

export function skillRefusalLines(
  notice: BundledSkillRefusalNotice,
  t: Translate = translate
): SkillRefusalLines {
  switch (notice.source) {
    case 'in-place':
      return {
        reason: t(
          'auto.components.skills.skillBackupRefusal.inPlaceReason',
          "Can't back it up: it's on another drive."
        ),
        path: notice.path,
        // A retired copy put back in place may never be planned again, so retrying won't find it.
        next: notice.offeredAgain
          ? t(
              'auto.components.skills.skillBackupRefusal.tryAgain',
              'Move it out of the skills folder, then try again.'
            )
          : t(
              'auto.components.skills.skillBackupRefusal.noReminder',
              "Move it out of the skills folder. Orca won't remind you."
            )
      }
    case 'leftover':
      return {
        reason: t(
          'auto.components.skills.skillBackupRefusal.leftoverReason',
          "Can't back up the left-over copy: it's on another drive."
        ),
        path: notice.path,
        next: t(
          'auto.components.skills.skillBackupRefusal.tryAgain',
          'Move it out of the skills folder, then try again.'
        )
      }
    case 'moved-aside':
      return {
        reason: t(
          'auto.components.skills.skillBackupRefusal.movedAsideReason',
          "Couldn't back up the old copy: it's on another drive."
        ),
        path: notice.path,
        next: notice.offeredAgain
          ? t(
              'auto.components.skills.skillBackupRefusal.keepIt',
              'Move it out of the skills folder to keep it.'
            )
          : t(
              'auto.components.skills.skillBackupRefusal.noReminder',
              "Move it out of the skills folder. Orca won't remind you."
            )
      }
  }
}

type RefusalSummary = {
  name: string
  notices: BundledSkillRefusalNotice[]
  updated: boolean
  movedAside: boolean
  /** A retired copy put back where the user left it; no later plan may mention it. */
  putBack: boolean
  keptInPlace: number
}

function summarize(outcome: BundledSkillOutcome): RefusalSummary | null {
  const notices = bundledSkillOutcomeRefusalNotices(outcome)
  if (notices.length === 0) {
    return null
  }
  return {
    name: outcome.name,
    notices,
    updated: bundledSkillOutcomeUpdatedSomething(outcome),
    movedAside: notices.some((notice) => notice.source === 'moved-aside'),
    putBack: notices.some((notice) => notice.source === 'in-place' && !notice.offeredAgain),
    keptInPlace: notices.filter((notice) => notice.source === 'in-place').length
  }
}

function updatedHeadline(summary: RefusalSummary, t: Translate): string {
  if (summary.movedAside) {
    return t(
      'auto.components.skills.skillBackupRefusal.updatedMovedAside',
      'Updated · Old copy moved aside'
    )
  }
  if (summary.putBack) {
    return t(
      'auto.components.skills.skillBackupRefusal.updatedOldKept',
      'Updated · Old copy kept as is'
    )
  }
  if (summary.keptInPlace > 0) {
    return summary.keptInPlace === 1
      ? t('auto.components.skills.skillBackupRefusal.updatedOneKept', 'Updated · 1 copy kept as is')
      : t(
          'auto.components.skills.skillBackupRefusal.updatedCopiesKept',
          'Updated · {{count}} copies kept as is',
          { count: summary.keptInPlace }
        )
  }
  return t(
    'auto.components.skills.skillBackupRefusal.updatedLeftoverKept',
    'Updated · Left-over copy kept'
  )
}

/** Update dialog row headline for a skill with a refused backup; null when nothing was refused. */
export function skillRefusalRowHeadline(
  outcome: BundledSkillOutcome,
  t: Translate = translate
): string | null {
  const summary = summarize(outcome)
  if (!summary) {
    return null
  }
  if (summary.updated) {
    return summary.movedAside || summary.keptInPlace > 0
      ? updatedHeadline(summary, t)
      : t('auto.components.skills.skillPlanOpCopy.updated', 'Updated')
  }
  return t('auto.components.skills.skillBackupRefusal.keptAsIs', 'Kept as is')
}

function settingsHeadline(summary: RefusalSummary, t: Translate): string {
  if (summary.updated) {
    return updatedHeadline(summary, t)
  }
  // The main copy was only rechecked as current; a retired copy went back where the user left it.
  if (summary.putBack && !summary.movedAside) {
    return t(
      'auto.components.skills.skillBackupRefusal.upToDateOldKept',
      'Up to date · Old copy kept as is'
    )
  }
  if (summary.keptInPlace > 0) {
    return t(
      'auto.components.skills.skillBackupRefusal.keptOnAnotherDrive',
      'Kept as is · On another drive'
    )
  }
  // A current copy was only rechecked, then a retired copy's backup was refused.
  if (summary.movedAside) {
    return t(
      'auto.components.skills.skillBackupRefusal.upToDateMovedAside',
      'Up to date · Old copy moved aside'
    )
  }
  return t(
    'auto.components.skills.skillBackupRefusal.keptLeftoverKept',
    'Kept as is · Left-over copy kept'
  )
}

/** A retained path, and what to do about it when no later plan may mention that copy again. */
export type SkillRefusalSettingsPath = { path: string; next?: string }

/** One skill's Settings result: its short state, then each retained path on its own line. */
export type SkillRefusalSettingsBlock = { headline: string; paths: SkillRefusalSettingsPath[] }

/**
 * Settings result after a refused backup. A batch with more than one skill to report gets a block
 * per skill, refused skills first, so one skill's state never stands for another's. `otherSkill`
 * gives a non-refused skill's state, or null when it has nothing to report. Null without a refusal.
 */
export function skillRefusalSettingsBlocks(
  result: BundledSkillInstallResult,
  t: Translate = translate,
  otherSkill: (outcome: BundledSkillOutcome) => string | null = () => null
): SkillRefusalSettingsBlock[] | null {
  const refused = result.skills.flatMap((outcome) => summarize(outcome) ?? [])
  if (refused.length === 0) {
    return null
  }
  const refusedNames = new Set(refused.map((summary) => summary.name))
  const others = result.skills.flatMap((outcome) => {
    if (refusedNames.has(outcome.name)) {
      return []
    }
    const headline = otherSkill(outcome)
    return headline ? [{ headline: `${outcome.name}: ${headline}`, paths: [] }] : []
  })
  // Why per path: one skill can hold a copy no plan mentions again beside one a retry still finds.
  const blocks = refused.map((summary): SkillRefusalSettingsBlock => ({
    headline: settingsHeadline(summary, t),
    paths: summary.notices.map((notice) => ({
      path: notice.path,
      ...(!notice.offeredAgain && {
        next: t(
          'auto.components.skills.skillBackupRefusal.noReminder',
          "Move it out of the skills folder. Orca won't remind you."
        )
      })
    }))
  }))
  if (blocks.length === 1 && others.length === 0) {
    return blocks
  }
  return [
    ...blocks.map((block, index) => ({
      ...block,
      headline: `${refused[index].name}: ${block.headline}`
    })),
    ...others
  ]
}

/** Plain-text form of the blocks; a batch indents each skill's paths under its state. */
export function skillRefusalSettingsText(blocks: readonly SkillRefusalSettingsBlock[]): string {
  const indent = blocks.length > 1 ? '  ' : ''
  return blocks
    .flatMap((block) => [
      block.headline,
      ...block.paths.flatMap(({ path, next }) => [
        `${indent}${path}`,
        ...(next ? [`${indent}${next}`] : [])
      ])
    ])
    .join('\n')
}

export function skillRefusalSettingsLine(
  result: BundledSkillInstallResult,
  t: Translate = translate,
  otherSkill?: (outcome: BundledSkillOutcome) => string | null
): string | null {
  const blocks = skillRefusalSettingsBlocks(result, t, otherSkill)
  return blocks ? skillRefusalSettingsText(blocks) : null
}
