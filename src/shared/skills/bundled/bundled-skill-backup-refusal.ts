import type {
  BundledSkillBackupRefusal,
  BundledSkillInstallResult,
  BundledSkillOpOutcome,
  BundledSkillOutcome
} from './bundled-skill-plan'

/**
 * A copy Orca left where it was because backing it up would have crossed drives.
 * `path` is on the host that ran the update; nothing there was copied, moved or deleted by the
 * refused step.
 */
export type BundledSkillRefusalNotice = {
  skill: string
  path: string
  source: BundledSkillBackupRefusal['source']
  /** The op published its own new copy or link before the refusal; a rechecked keep did not. */
  contentApplied: boolean
  /** Whether a later plan mentions this copy again; a former agent root's copy is not rediscovered. */
  offeredAgain: boolean
}

export function bundledSkillOpRefusalNotice(
  skill: string,
  op: BundledSkillOpOutcome
): BundledSkillRefusalNotice | null {
  const refusal = op.backupRefusal
  if (!refusal) {
    return null
  }
  return {
    skill,
    path: refusal.path,
    source: refusal.source,
    contentApplied: op.contentApplied === true,
    offeredAgain: refusal.onlyNotice !== true
  }
}

export function bundledSkillOutcomeRefusalNotices(
  outcome: BundledSkillOutcome
): BundledSkillRefusalNotice[] {
  return outcome.ops.flatMap((op) => bundledSkillOpRefusalNotice(outcome.name, op) ?? [])
}

export function bundledSkillRefusalNotices(
  result: BundledSkillInstallResult | null | undefined
): BundledSkillRefusalNotice[] {
  return (result?.skills ?? []).flatMap(bundledSkillOutcomeRefusalNotices)
}

/** Every backup an op completed; older hosts report only `backupPath`. */
export function bundledSkillOpBackupPaths(op: BundledSkillOpOutcome): readonly string[] {
  return op.backupPaths ?? (op.backupPath ? [op.backupPath] : [])
}

const WRITING_KINDS: ReadonlySet<string> = new Set(['write', 'copy', 'link', 'update', 'replace'])

/** Op kinds that put new content at their path; keep, leave and restore publish nothing new. */
export function bundledSkillOpKindPublishes(kind: string): boolean {
  return WRITING_KINDS.has(kind)
}

/**
 * Whether this run put new content anywhere for the skill, including an op that failed after its
 * content landed. A kept copy rechecked as current is not an update.
 */
export function bundledSkillOutcomeUpdatedSomething(outcome: BundledSkillOutcome): boolean {
  return outcome.ops.some(
    (op) =>
      bundledSkillOpKindPublishes(op.kind) && (op.status === 'done' || op.contentApplied === true)
  )
}

/** Everything that went wrong in the run was a refused cross-drive backup; nothing else failed. */
export function bundledSkillResultOnlyRefused(result: BundledSkillInstallResult): boolean {
  const ops = result.skills.flatMap((skill) => (skill.status === 'ran' ? skill.ops : []))
  const failing = ops.filter((op) => op.status === 'failed' || op.status === 'changed')
  return (
    result.skills.every((skill) => skill.status === 'ran') &&
    failing.length > 0 &&
    failing.every((op) => op.backupRefusal)
  )
}

/**
 * The result names a path the user may need: a refused copy or a finished backup. Such a result
 * is its own receipt, so it stays until the user dismisses it or a new run replaces it.
 */
export function bundledSkillResultRetainsPaths(
  result: BundledSkillInstallResult | null | undefined
): boolean {
  return (result?.skills ?? []).some((skill) =>
    skill.ops.some((op) => op.backupRefusal || bundledSkillOpBackupPaths(op).length > 0)
  )
}
