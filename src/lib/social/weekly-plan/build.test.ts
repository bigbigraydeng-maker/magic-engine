import { describe, expect, it } from 'vitest'

import { buildWeeklySocialPlan } from './build'
import { authFromStatuses, emptyGoalInput, readGoalCard, readThemes, readWeeklyQuota } from './read'
import { resolveStage } from './stage-resolve'
import type { BuildInput, FlagSignal, StageSignalsInput } from './types'

const ok = (value: number) => ({ state: 'ok' as const, value })
const unread = { state: 'unreadable' as const, value: 0 }
const yes: FlagSignal = { state: 'ok', value: true }
const no: FlagSignal = { state: 'ok', value: false }
const unreadFlag: FlagSignal = { state: 'unreadable', value: false }

function stage(partial: Partial<StageSignalsInput> = {}): StageSignalsInput {
  return {
    auth: yes,
    authLost: no,
    facts: ok(20),
    assets: ok(15),
    onTimeWeeks: unread,
    receipts: unread,
    periods: unread,
    circuitBreaker: unreadFlag,
    complaintSpike: unreadFlag,
    ...partial,
  }
}

function input(partial: Partial<BuildInput> = {}): BuildInput {
  return {
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    industryKey: 'travel',
    clientConfig: null,
    weeklyQuota: { storyPerWeek: null, postPerWeek: null, reelPerWeek: null },
    pillarNames: {},
    lockMix: false,
    stage: stage(),
    goal: emptyGoalInput(),
    themes: { read: 'none', items: [] },
    ...partial,
  }
}

const CLIENT_MIX = [
  { id: 'travel_mood', post_ratio: 0.4 },
  { id: 'practical_info', post_ratio: 0.25 },
  { id: 'guest_stories', post_ratio: 0.2 },
  { id: 'tour_intro', post_ratio: 0.15 },
  { id: 'expertise_history', post_ratio: 0 },
]

function countGroup(plan: { items: Array<{ contentGroup: string | null }> }, key: string): number {
  return plan.items.filter((item) => item.contentGroup === key).length
}

describe('buildWeeklySocialPlan', () => {
  it('lets a filled weekly quota and mix replace the travel template', () => {
    const plan = buildWeeklySocialPlan(input({
      clientConfig: { content_pillars: CLIENT_MIX },
      weeklyQuota: { storyPerWeek: 18, postPerWeek: 4, reelPerWeek: 3 },
      themes: { read: 'ok', items: [{ id: 'theme-1', label: '中国团' }] },
      goal: readGoalCard({ title: '这个月把中国团讲清楚' }, false),
    }))
    expect(plan.status).toBe('ready')
    expect(plan.counts).toEqual({ story: 18, post: 4, reel: 3 })
    expect(plan.countSources.reel).toBe('client_week')
    expect(plan.countSources.mix).toBe('client_week')
    expect(plan.items).toHaveLength(25)
    expect(countGroup(plan, 'travel_mood')).toBe(10)
    expect(countGroup(plan, 'practical_info')).toBe(6)
    expect(countGroup(plan, 'guest_stories')).toBe(5)
    expect(countGroup(plan, 'tour_intro')).toBe(4)
    expect(countGroup(plan, 'expertise_history')).toBe(0)
    expect(plan.items.filter((item) => item.format === 'story').every((item) => item.reason.includes('不卖货'))).toBe(true)
    expect(plan.items.every((item) => item.theme === '中国团')).toBe(true)
    expect(plan.primarySignal).toBe('on_time_cadence')
    expect(JSON.stringify(plan)).not.toMatch(/target|followers|reach/)
  })

  it('uses the travel template when the client left the weekly counts empty and the stage is not claimed', () => {
    const plan = buildWeeklySocialPlan(input())
    expect(plan.stage).toBeNull()
    expect(plan.counts).toEqual({ story: 7, post: 3, reel: 2 })
    expect(plan.countSources.reel).toBe('industry')
    expect(plan.gaps.some((gap) => gap.includes('没有下结论') || gap.includes('读不到'))).toBe(true)
  })

  it('uses the cold-start counts when a readable signal is still in the starting stage', () => {
    const plan = buildWeeklySocialPlan(input({ stage: stage({ facts: ok(5) }) }))
    expect(plan.stage).toBe('starting')
    expect(plan.counts).toEqual({ story: 7, post: 3, reel: 1 })
    expect(countGroup(plan, 'tour_intro')).toBe(3)
  })

  it('holds the week when publish auth was lost', () => {
    const plan = buildWeeklySocialPlan(input({
      stage: stage({ auth: no, authLost: yes, facts: ok(50), assets: ok(50), onTimeWeeks: ok(12) }),
      weeklyQuota: { storyPerWeek: 18, postPerWeek: 4, reelPerWeek: 3 },
    }))
    expect(plan.status).toBe('held')
    expect(plan.items).toHaveLength(0)
  })

  it('does not invent a theme or a group when those reads fail', () => {
    const plan = buildWeeklySocialPlan(input({
      lockMix: true,
      weeklyQuota: { storyPerWeek: 1, postPerWeek: 1, reelPerWeek: 1 },
      themes: { read: 'unreadable', items: [] },
    }))
    expect(plan.items.every((item) => item.theme === null && item.contentGroup === null)).toBe(true)
    expect(plan.items[0].reason).toContain('不编主题')
    expect(plan.gaps.some((gap) => gap.includes('没有内容比例'))).toBe(true)
  })

  it('refuses a week over the slot cap instead of dropping the extra rows', () => {
    const plan = buildWeeklySocialPlan(input({
      weeklyQuota: { storyPerWeek: 30, postPerWeek: 8, reelPerWeek: 8 },
    }))
    expect(plan.status).toBe('incomplete')
    expect(plan.items).toHaveLength(0)
  })

  it('uses logistics groups for a logistics client and not the travel mix', () => {
    const plan = buildWeeklySocialPlan(input({ industryKey: 'logistics' }))
    expect(plan.items.some((item) => item.contentGroup === 'how_to_ship')).toBe(true)
    expect(plan.items.some((item) => item.contentGroup === 'travel_mood')).toBe(false)
  })
})

describe('stage and readers', () => {
  it('does not treat an unreadable on-time count as zero weeks', () => {
    const resolved = resolveStage(stage())
    expect(resolved.stage).toBeNull()
    expect(resolved.reasons.join('')).toContain('没有按 0')
  })

  it('reads weekly integers and ignores a blank goal or a missing theme', () => {
    expect(readWeeklyQuota({ social_week: { story_per_week: 18, post_per_week: 4, reel_per_week: 3 } }).quota)
      .toEqual({ storyPerWeek: 18, postPerWeek: 4, reelPerWeek: 3 })
    expect(readWeeklyQuota({ social_week: { story_per_week: 1.5 } }).gaps[0]).toContain('没有采用')
    expect(readGoalCard(null, false)).toEqual(emptyGoalInput())
    expect(readGoalCard(null, true).read).toBe('unreadable')
    expect(readThemes([{ id: 't1', title: '线路 A' }], false).items).toEqual([{ id: 't1', label: '线路 A' }])
    expect(authFromStatuses([])).toEqual({
      auth: { state: 'ok', value: false },
      authLost: { state: 'ok', value: false },
    })
    expect(authFromStatuses(['expired']).authLost.value).toBe(true)
  })

  it('reads a full goal card, title-only goal, and no goal without inventing text', () => {
    const full = readGoalCard({
      title: 'Q4 中国团',
      intent: 'sales',
      sub_type: 'launch',
      awareness_subtype: null,
      fde_reasoning: '这周对外强调成团节奏，不讲底价。',
    }, false)
    expect(full.read).toBe('ok')
    expect(full.draftBasis).toEqual([
      '目标标题：Q4 中国团',
      '目标意图：sales',
      '目标类型：launch',
      '战略说明：这周对外强调成团节奏，不讲底价。',
    ])
    const titleOnly = readGoalCard({ title: '稳住咨询量' }, false)
    expect(titleOnly.draftBasis).toEqual(['目标标题：稳住咨询量'])
    expect(readGoalCard(null, false)).toEqual(emptyGoalInput())
    const plan = buildWeeklySocialPlan(input({ goal: full }))
    expect(plan.goal.draftBasis).toEqual(full.draftBasis)
  })
})
