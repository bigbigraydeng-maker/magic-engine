import { describe, expect, it } from 'vitest'
import {
  matchLaunch,
  type LaunchRef, type PlanRef, type PrescriptionRef, type SiblingRef,
} from '../prescription-launch-check'

const RX = 'rx-1'
const GOAL = 'goal-1'
const CAMP = 'camp-1'

function prescription(over: Partial<PrescriptionRef> = {}): PrescriptionRef {
  return { id: RX, goalId: GOAL, status: 'approved', approvedAt: '2026-10-26T07:20:00.000Z', ...over }
}

function launch(over: Partial<LaunchRef> = {}): LaunchRef {
  return { id: 'act-1', clientId: 'client-1', authorizedAt: '2026-10-26T07:35:00.000Z', campaignId: CAMP, ...over }
}

function plan(over: Partial<PlanRef> = {}): PlanRef {
  return { goalId: GOAL, approvedAt: '2026-10-26T07:10:00.000Z', ...over }
}

function sibling(over: Partial<SiblingRef> = {}): SiblingRef {
  return { id: RX, approvedAt: '2026-10-26T07:20:00.000Z', ...over }
}

describe('prescription launch check relaunch', () => {
  it('picks the earliest launch when the same campaign was launched three times', () => {
    const first = '2026-10-26T07:35:00.000Z'
    const match = matchLaunch({
      prescription: prescription(),
      launches: [
        launch({ id: 'act-1', authorizedAt: first }),
        launch({ id: 'act-2', authorizedAt: '2026-10-26T21:48:00.000Z' }),
        launch({ id: 'act-3', authorizedAt: '2026-10-27T22:18:00.000Z' }),
      ],
      plans: [plan()],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('matched')
    if (match.kind === 'matched') expect(match.launch.authorizedAt).toBe(first)
  })

  it('stays unmatched when two launches have different campaigns', () => {
    const match = matchLaunch({
      prescription: prescription(),
      launches: [
        launch({ id: 'act-1', campaignId: 'camp-1' }),
        launch({ id: 'act-2', campaignId: 'camp-2' }),
      ],
      plans: [plan()],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('unmatched')
    if (match.kind === 'unmatched') expect(match.lines[0]).toContain('对上了不止一条已开投的广告')
  })

  it('still picks the earliest when same-campaign launches are passed in reverse order', () => {
    const first = '2026-10-26T07:35:00.000Z'
    const match = matchLaunch({
      prescription: prescription(),
      launches: [
        launch({ id: 'act-3', authorizedAt: '2026-10-27T22:18:00.000Z' }),
        launch({ id: 'act-2', authorizedAt: '2026-10-26T21:48:00.000Z' }),
        launch({ id: 'act-1', authorizedAt: first }),
      ],
      plans: [plan()],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('matched')
    if (match.kind === 'matched') expect(match.launch.authorizedAt).toBe(first)
  })
})
