import { describe, expect, it } from 'vitest'
import {
  combineLaunchAssessments, matchLaunch,
  type LaunchAssessment, type LaunchRef, type PlanRef, type PrescriptionRef, type SiblingRef,
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
    if (match.kind === 'matched') expect(match.launches.map(item => item.authorizedAt)).toEqual([first])
  })

  it('keeps one earliest launch for each different campaign', () => {
    const match = matchLaunch({
      prescription: prescription(),
      launches: [
        launch({ id: 'act-1', campaignId: 'camp-1' }),
        launch({ id: 'act-2', campaignId: 'camp-2', authorizedAt: '2026-10-26T09:00:00.000Z' }),
      ],
      plans: [plan()],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('matched')
    if (match.kind === 'matched') {
      expect(match.launches.map(item => item.campaignId)).toEqual(['camp-1', 'camp-2'])
    }
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
    if (match.kind === 'matched') expect(match.launches.map(item => item.authorizedAt)).toEqual([first])
  })

  it('writes both campaigns into one check and keeps the worse result', () => {
    const view = combineLaunchAssessments([fake('met', 'camp-1'), fake('missed', 'camp-2')])
    const day = view.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')
    expect(day?.verdict).toBe('missed')
    expect(day?.sentence).toContain('第 1 支')
    expect(day?.sentence).toContain('第 2 支')
    expect(day?.sentence).toContain('没达标')
  })
})

function fake(verdict: 'met' | 'missed', campaignId: string): LaunchAssessment {
  const rows = [
    ['launch_check_24h', '24 小时'],
    ['launch_check_48h', '48 小时'],
    ['launch_check_day7', '第 7 天'],
    ['launch_check_day14', '第 14 天'],
  ] as const
  const word = verdict === 'met' ? '达标' : '没达标'
  const checkpoints = rows.map(([kpiMetric, label]) => ({
    kpiMetric, due: true, verdict, sentence: `${label}：${word}。例子。`,
  }))
  return { lines: checkpoints.map(point => point.sentence), checkpoints, campaignId }
}
