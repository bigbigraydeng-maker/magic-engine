import { describe, expect, it } from 'vitest'
import { decideStage } from '../src/plan.mjs'

const base = { sha: 'sha-1', hasActionableFindings: false, ciSuccess: true, maxRounds: 3, markers: [] }

describe('decideStage', () => {
  it('is ready when there are no actionable findings and CI is green', () => {
    expect(decideStage(base)).toEqual({ action: 'ready' })
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
