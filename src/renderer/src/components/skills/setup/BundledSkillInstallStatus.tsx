import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BundledSkillUnsupportedReason } from '@/runtime/skills/bundled/runtime-bundled-skills-client'
import { Button } from '../../ui/button'
import {
  skillInstallRefusalBlocks,
  skillInstallResultLine
} from './bundled-skill-setup-result-copy'
import type { SkillRefusalSettingsBlock } from '../freshness/skill-backup-refusal-copy'
import {
  bundledSkillInstallNeedsAttention,
  type BundledSkillInstall
} from '@/hooks/skills/installation/use-bundled-skill-install'
import { summarizeBundledSkillOutcomes } from '../../../../../shared/skills/bundled/bundled-skill-summary'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { skillBackupPaths } from '../freshness/skill-backup-location'
import { SkillBackupPathLine } from '../freshness/SkillBackupPathLine'
import { SkillRetainedPathLine } from '../freshness/SkillPathText'
import { bundledSkillResultOnlyRefused } from '../../../../../shared/skills/bundled/bundled-skill-backup-refusal'

export function BundledSkillInstallStatus(props: {
  install: Pick<BundledSkillInstall, 'state' | 'retry'>
  buttonSize?: 'xs' | 'sm'
  className?: string
  attention?: { retry: () => void; message?: string }
  unsupported?: BundledSkillUnsupportedReason
}): React.JSX.Element | null {
  const t = useTranslate()
  const [showAllSkills, setShowAllSkills] = useState(false)
  const previewAttention =
    props.attention && (props.install.state.kind === 'idle' || props.install.state.kind === 'done')
  const state = props.unsupported
    ? { kind: 'unsupported' as const, reason: props.unsupported }
    : previewAttention
      ? {
          kind: 'failed' as const,
          message:
            props.attention?.message ??
            t('auto.components.skills.skillPlanOpCopy.needsAttention', 'Needs attention')
        }
      : props.install.state
  const retry = previewAttention ? props.attention?.retry : props.install.retry
  if (state.kind === 'idle' || state.kind === 'installing') {
    return null
  }
  // Why the run's state: a refreshed preview (attention, unsupported) replaces the result line,
  // but not the paths the run moved or kept; those stay until the result is dismissed or replaced.
  const ran = props.install.state.kind === 'done' ? props.install.state : null
  const ranSummary = ran ? summarizeBundledSkillOutcomes(ran.result) : null
  const ranBlocks = ran && ranSummary ? skillInstallRefusalBlocks(ran.result, t, ranSummary) : null
  const backupPaths = ran ? skillBackupPaths(ran.result.skills.flatMap((skill) => skill.ops)) : []
  const backupLines = backupPaths.map((path) => (
    <SkillBackupPathLine
      key={path}
      path={path}
      host={ran?.backupHost ?? { kind: 'local' }}
      {...(ran?.homeDirectory ? { homeDirectory: ran.homeDirectory } : {})}
      className="basis-full"
    />
  ))
  // A refused backup is a result, not an error: muted, and no result-bound Retry. The parent offers
  // the live plan's own action instead (a fresh Replace asks for fresh consent), so Retry never
  // reuses an old run's choices. A run that also failed some other way keeps Retry.
  const onlyRefused = ran ? bundledSkillResultOnlyRefused(ran.result) : false
  const showsRun = state === props.install.state
  const retained =
    !showsRun && ranBlocks ? (
      <RefusalBlocks
        blocks={ranBlocks}
        homeDirectory={ran?.homeDirectory}
        showAll={showAllSkills}
        onShowAll={() => setShowAllSkills(true)}
        className="basis-full text-muted-foreground"
      />
    ) : null
  if (state.kind === 'unsupported') {
    return (
      <div className={cn('flex flex-wrap items-baseline gap-2', props.className)}>
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          {state.reason === 'connect-host'
            ? t(
                'auto.components.settings.BundledSkillInstallStatus.connectHost',
                'Connect to this SSH host to install its skills.'
              )
            : t(
                'auto.components.settings.BundledSkillInstallStatus.updateServer',
                'Update Orca on the server to install its skills.'
              )}
        </p>
        {retained}
        {backupLines}
      </div>
    )
  }
  const problem = bundledSkillInstallNeedsAttention(state)
  const blocks = showsRun ? ranBlocks : null
  const message =
    state.kind === 'failed'
      ? state.message
      : skillInstallResultLine(state.result, state.changes, t, ranSummary ?? undefined, ranBlocks)
  const tone = problem && !(showsRun && onlyRefused) ? 'text-destructive' : 'text-muted-foreground'
  return (
    <div className={cn('flex flex-wrap items-baseline gap-2', props.className)}>
      {blocks ? (
        <RefusalBlocks
          blocks={blocks}
          homeDirectory={ran?.homeDirectory}
          showAll={showAllSkills}
          onShowAll={() => setShowAllSkills(true)}
          className={tone}
        />
      ) : (
        <p className={cn('min-w-0 flex-1 whitespace-pre-line text-xs leading-snug', tone)}>
          {message}
        </p>
      )}
      {problem && !(showsRun && onlyRefused) ? (
        <Button type="button" variant="ghost" size={props.buttonSize ?? 'sm'} onClick={retry}>
          <RefreshCw className="size-3.5" />
          {t('auto.components.settings.AgentSkillSetupPanel.retrySetup', 'Retry')}
        </Button>
      ) : null}
      {retained}
      {backupLines}
    </div>
  )
}

const VISIBLE_SKILL_BLOCKS = 3

/** A batch's per-skill states, each skill's kept paths indented and selectable beneath it. */
function RefusalBlocks(props: {
  blocks: readonly SkillRefusalSettingsBlock[]
  homeDirectory?: string
  showAll: boolean
  onShowAll: () => void
  className: string
}): React.JSX.Element {
  const t = useTranslate()
  const visible =
    props.showAll || props.blocks.length <= VISIBLE_SKILL_BLOCKS
      ? props.blocks
      : props.blocks.slice(0, VISIBLE_SKILL_BLOCKS)
  const hidden = props.blocks.length - visible.length
  // A batch indents each skill's lines under its state; one skill's lines sit flush.
  const indent = props.blocks.length > 1 ? 'pl-3' : undefined
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-2 text-xs leading-snug', props.className)}>
      {visible.map((block) => (
        <div key={block.headline} className="flex min-w-0 flex-col gap-1.5">
          <p>{block.headline}</p>
          {block.paths.map(({ path, next }) => (
            <div key={path} className={cn('flex min-w-0 flex-col', indent)}>
              <SkillRetainedPathLine path={path} homeDirectory={props.homeDirectory} />
              {next ? <p className="text-muted-foreground">{next}</p> : null}
            </div>
          ))}
        </div>
      ))}
      {hidden > 0 ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto self-start px-0 text-muted-foreground"
          onClick={props.onShowAll}
        >
          {t(
            'auto.components.settings.BundledSkillInstallStatus.showMoreSkills',
            'Show {{count}} more',
            { count: hidden }
          )}
        </Button>
      ) : null}
    </div>
  )
}
