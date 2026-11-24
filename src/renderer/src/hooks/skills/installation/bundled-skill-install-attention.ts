import { bundledSkillResultOnlyRefused } from '../../../../../shared/skills/bundled/bundled-skill-backup-refusal'
import type { BundledSkillInstallState } from './use-bundled-skill-install'

/** A failed request, or a run that left something undone: "Needs attention" with Retry. */
export function bundledSkillInstallNeedsAttention(state: BundledSkillInstallState): boolean {
  return state.kind === 'failed' || (state.kind === 'done' && !state.summary.ok)
}

/**
 * Whether a past result should hold back new install actions. A run whose only problems were
 * refused cross-drive backups is a receipt, not a pending retry: its paths stay on screen and the
 * live plan decides what to offer next (a fresh Replace asks for fresh consent).
 */
export function bundledSkillInstallBlocksFreshAction(state: BundledSkillInstallState): boolean {
  return (
    bundledSkillInstallNeedsAttention(state) &&
    !(state.kind === 'done' && bundledSkillResultOnlyRefused(state.result))
  )
}
