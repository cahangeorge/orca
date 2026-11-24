import { describe, expect, it } from 'vitest'
import type {
  BundledSkillOpOutcome,
  BundledSkillOutcome
} from '../../../../../shared/skills/bundled/bundled-skill-plan'
import {
  skillRefusalLines,
  skillRefusalRowHeadline,
  skillRefusalSettingsLine
} from './skill-backup-refusal-copy'

const SKILLS = '/home/u/.agents/skills'
const outcome = (...ops: BundledSkillOpOutcome[]): BundledSkillOutcome => ({
  name: 'orca',
  status: 'ran',
  ops
})
const settings = (skill: BundledSkillOutcome) =>
  skillRefusalSettingsLine({ scope: 'global', skills: [skill] })
const refused = (
  source: 'in-place' | 'leftover' | 'moved-aside',
  path: string,
  fields: Partial<BundledSkillOpOutcome> = {}
): BundledSkillOpOutcome => ({
  path: `${SKILLS}/orca`,
  kind: 'replace',
  status: 'failed',
  error: 'EXDEV',
  backupRefusal: { path, source },
  ...fields
})
const linked: BundledSkillOpOutcome = {
  path: '/home/u/.claude/skills/orca',
  kind: 'link',
  status: 'done'
}

describe('cross-drive backup refusal copy', () => {
  it('S1: a Replace kept in place', () => {
    const kept = refused('in-place', `${SKILLS}/orca`)
    expect(skillRefusalRowHeadline(outcome(kept))).toBe('Kept as is')
    expect(settings(outcome(kept))).toBe(`Kept as is · On another drive\n${SKILLS}/orca`)
    expect(settings(outcome(kept, linked))).toBe(`Updated · 1 copy kept as is\n${SKILLS}/orca`)
    expect(
      skillRefusalLines({
        skill: 'orca',
        path: `${SKILLS}/orca`,
        source: 'in-place',
        contentApplied: false,
        offeredAgain: true
      })
    ).toEqual({
      reason: "Can't back it up: it's on another drive.",
      path: `${SKILLS}/orca`,
      next: 'Move it out of the skills folder, then try again.'
    })
  })

  it('S1: a retired copy put back in place never promises a retry will find it', () => {
    const former = '/home/u/.gemini/skills/orca'
    expect(
      skillRefusalLines({
        skill: 'orca',
        path: former,
        source: 'in-place',
        contentApplied: true,
        offeredAgain: false
      })
    ).toEqual({
      reason: "Can't back it up: it's on another drive.",
      path: former,
      next: "Move it out of the skills folder. Orca won't remind you."
    })
  })

  it('Settings names a put-back copy the way its toast does', () => {
    const former = '/home/u/.gemini/skills/orca'
    const putBack = (fields: Partial<BundledSkillOpOutcome>) =>
      refused('in-place', former, {
        backupRefusal: { path: former, source: 'in-place', onlyNotice: true },
        ...fields
      })
    expect(settings(outcome(putBack({ kind: 'update', contentApplied: true })))).toBe(
      `Updated · Old copy kept as is\n${former}\nMove it out of the skills folder. Orca won't remind you.`
    )
    expect(settings(outcome(putBack({ kind: 'keep', currentConfirmed: true })))).toBe(
      `Up to date · Old copy kept as is\n${former}\nMove it out of the skills folder. Orca won't remind you.`
    )
  })

  it('Settings says "won\'t remind you" only under the copy it applies to', () => {
    const former = '/home/u/.gemini/skills/orca'
    const kept = `${SKILLS}/orca`
    const line = settings(
      outcome(
        refused('in-place', former, {
          kind: 'update',
          contentApplied: true,
          backupRefusal: { path: former, source: 'in-place', onlyNotice: true }
        }),
        refused('in-place', kept, { path: '/home/u/.claude/skills/orca' })
      )
    )
    expect(line).toBe(
      `Updated · Old copy kept as is\n${former}\nMove it out of the skills folder. Orca won't remind you.\n${kept}`
    )
  })

  it('S2: a left-over copy follows whether the main copy updated', () => {
    const leftover = `${SKILLS}/.orca.orca-old-1`
    const keep = refused('leftover', leftover, { kind: 'keep', currentConfirmed: true })
    expect(skillRefusalRowHeadline(outcome(keep))).toBe('Kept as is')
    expect(settings(outcome(keep))).toBe(`Kept as is · Left-over copy kept\n${leftover}`)
    expect(skillRefusalRowHeadline(outcome(keep, linked))).toBe('Updated')
    expect(settings(outcome(keep, linked))).toBe(`Updated · Left-over copy kept\n${leftover}`)
  })

  it('S3/S4: an old copy moved aside after the update landed', () => {
    const old = `${SKILLS}/.orca.orca-old-1`
    const update = refused('moved-aside', old, {
      kind: 'update',
      contentApplied: true,
      strandedPath: old
    })
    expect(skillRefusalRowHeadline(outcome(update))).toBe('Updated · Old copy moved aside')
    expect(settings(outcome(update))).toBe(`Updated · Old copy moved aside\n${old}`)
  })

  it('S5: a former root copy says Orca will not remind', () => {
    const old = '/home/u/.gemini/skills/.orca.orca-old-1'
    const notice = {
      skill: 'orca',
      path: old,
      source: 'moved-aside' as const,
      contentApplied: true,
      offeredAgain: false
    }
    expect(skillRefusalLines(notice).next).toBe(
      "Move it out of the skills folder. Orca won't remind you."
    )
    expect(skillRefusalLines({ ...notice, offeredAgain: true }).next).toBe(
      'Move it out of the skills folder to keep it.'
    )
  })

  it('never calls a rechecked keep with a refused retirement an update', () => {
    const old = `${SKILLS}/.former-skill.orca-old-1`
    const keep = refused('moved-aside', old, { kind: 'keep', currentConfirmed: true })
    expect(skillRefusalRowHeadline(outcome(keep))).toBe('Kept as is')
    expect(settings(outcome(keep))).toBe(`Up to date · Old copy moved aside\n${old}`)
  })

  it('gives each skill its own state in a mixed batch', () => {
    const kept = refused('in-place', `${SKILLS}/orca`)
    const other: BundledSkillOutcome = {
      name: 'other',
      status: 'ran',
      ops: [{ ...linked, path: '/home/u/.claude/skills/other' }]
    }
    const unchanged: BundledSkillOutcome = {
      name: 'quiet',
      status: 'ran',
      ops: [{ path: `${SKILLS}/quiet`, kind: 'keep', status: 'done' }]
    }
    expect(
      skillRefusalSettingsLine(
        { scope: 'global', skills: [other, unchanged, outcome(kept)] },
        undefined,
        (skill) => (skill.name === 'other' ? 'Linked' : null)
      )
    ).toBe(`orca: Kept as is · On another drive\n  ${SKILLS}/orca\nother: Linked`)
  })

  it('leaves results without a refusal to the existing copy', () => {
    expect(settings(outcome(linked))).toBeNull()
    expect(
      skillRefusalRowHeadline(outcome({ ...linked, status: 'failed', error: 'EXDEV' }))
    ).toBeNull()
  })
})
