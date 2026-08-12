import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStage } from '../src/plan.mjs'

const base = { sha: 'sha-1', hasActionableFindings: false, ciSuccess: true, maxRounds: 3, markers: [] }

describe('decideStage', () => {
  it('stops at ready when the merge gate was never evaluated', () => {
    // Absence of an answer is not a yes. If a future caller forgets to pass
    // mergeBlockers, the safe reading is "do not merge", and the reason has to
    // be visible rather than silently absent.
    expect(decideStage(base)).toEqual({ action: 'ready', blockers: ['merge gate not evaluated'] })
  })

  it('stops at ready and reports why when the merge gate found blockers', () => {
    expect(decideStage({ ...base, mergeBlockers: ['pull request is a draft'] })).toEqual({
      action: 'ready',
      blockers: ['pull request is a draft'],
    })
  })

  it('auto-merges only on an explicitly empty blocker list', () => {
    expect(decideStage({ ...base, mergeBlockers: [] })).toEqual({ action: 'auto-merge' })
  })

  it('never auto-merges while CI is not green, however clear the merge gate is', () => {
    // Ordering matters: the CI branch must win over the merge gate, or a green
    // gate computed from stale inputs could ship a red build.
    expect(decideStage({ ...base, ciSuccess: false, mergeBlockers: [] })).toEqual({ action: 'wait-ci' })
  })

  it('never auto-merges while there are actionable findings', () => {
    expect(decideStage({ ...base, hasActionableFindings: true, mergeBlockers: [] })).toEqual({
      action: 'dispatch-fix',
      round: 1,
    })
  })

  it('does not re-merge a sha already marked auto-merged', () => {
    expect(
      decideStage({
        ...base,
        mergeBlockers: [],
        markers: [{ stage: 'auto-merged', sha: base.sha }],
      }),
    ).toMatchObject({ action: 'skip' })
  })

  it('waits when there are no actionable findings but CI is not green', () => {
    expect(decideStage({ ...base, ciSuccess: false })).toEqual({ action: 'wait-ci' })
  })

  it('dispatches round 1 when there are actionable findings and no prior rounds', () => {
    expect(decideStage({ ...base, hasActionableFindings: true })).toEqual({ action: 'dispatch-fix', round: 1 })
  })

  it('counts prior fix-dispatched markers into the next round number', () => {
    const markers = [
      { stage: 'fix-dispatched', pr: 1, sha: 'sha-old-1', round: 1 },
      { stage: 'fix-dispatched', pr: 1, sha: 'sha-old-2', round: 2 },
    ]
    expect(decideStage({ ...base, hasActionableFindings: true, markers })).toEqual({
      action: 'dispatch-fix',
      round: 3,
    })
  })

  it('stops at NEEDS HUMAN REVIEW once 3 fix rounds have already been dispatched', () => {
    const markers = [1, 2, 3].map((round) => ({ stage: 'fix-dispatched', pr: 1, sha: `sha-old-${round}`, round }))
    expect(decideStage({ ...base, hasActionableFindings: true, markers })).toEqual({
      action: 'needs-human',
      round: 4,
    })
  })

  it('never dispatches a 4th round even with more findings on a later sha', () => {
    const markers = [1, 2, 3].map((round) => ({ stage: 'fix-dispatched', pr: 1, sha: `sha-old-${round}`, round }))
    const result = decideStage({ ...base, sha: 'sha-new', hasActionableFindings: true, markers })
    expect(result.action).toBe('needs-human')
  })

  it('skips as a no-op when this exact head sha already has a fix-dispatched marker (duplicate event)', () => {
    const markers = [{ stage: 'fix-dispatched', pr: 1, sha: 'sha-1', round: 1 }]
    expect(decideStage({ ...base, hasActionableFindings: true, markers }).action).toBe('skip')
  })

  it('skips as a no-op when this exact head sha already has a ready marker (duplicate event)', () => {
    const markers = [{ stage: 'ready', pr: 1, sha: 'sha-1' }]
    expect(decideStage({ ...base, markers }).action).toBe('skip')
  })

  it('skips as a no-op when this exact head sha already has a needs-human marker (duplicate event)', () => {
    const markers = [{ stage: 'needs-human', pr: 1, sha: 'sha-1', round: 4 }]
    expect(decideStage({ ...base, hasActionableFindings: true, markers }).action).toBe('skip')
  })

  it('does not skip a different sha even if an earlier sha was already handled', () => {
    const markers = [{ stage: 'ready', pr: 1, sha: 'sha-0' }]
    expect(decideStage({ ...base, sha: 'sha-1', markers }).action).toBe('ready')
  })
})

describe('every action decideStage can return has a handler in handle-review.mjs', () => {
  // Codex finding (PR #931, P1). Deleting a "legacy" case with a scripted
  // slice took the live `dispatch-fix` case out with it, so every review that
  // raised a finding hit `default:` and threw — the whole fix leg dead, and
  // 110 tests green, because the switch was almost uncovered.
  //
  // This pins the two lists together instead of trusting either one: any
  // action decideStage can produce must have a case, and any case must be a
  // real action. It is the cheap version of the coverage that was missing.
  const ACTIONS = ['skip', 'needs-human', 'wait-ci', 'ready', 'auto-merge', 'dispatch-fix']

  const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/handle-review.mjs'), 'utf8')
  const cases = [...source.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1])

  it.each(ACTIONS)('handles %s', (action) => {
    expect(cases).toContain(action)
  })

  it('has no case for an action decideStage never returns', () => {
    expect(cases.filter((c) => !ACTIONS.includes(c))).toEqual([])
  })

  it.each(ACTIONS)('%s is reachable from decideStage', (action) => {
    // Both directions: a case nobody can reach is dead code, and dead code is
    // what got sliced away last time.
    const reachable = [
      decideStage({ ...base, markers: [{ stage: 'ready', sha: base.sha }] }),
      decideStage({ ...base, markers: [{ stage: 'fix-dispatched', sha: 'other' }], hasActionableFindings: true }),
      decideStage({ ...base, hasActionableFindings: true, markers: Array.from({ length: 3 }, () => ({ stage: 'fix-dispatched', sha: 'x' })) }),
      decideStage({ ...base, ciSuccess: false }),
      decideStage({ ...base }),
      decideStage({ ...base, mergeBlockers: [] }),
    ].map((r) => r.action)
    expect(reachable).toContain(action)
  })
})
