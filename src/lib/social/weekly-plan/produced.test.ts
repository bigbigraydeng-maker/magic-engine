import { describe, expect, it } from 'vitest'

import { buildWeeklySocialPlan } from './build'
import { emptyReadbackSuggestion } from './readback-suggestion'
import { emptyGoalInput } from './read'
import { applyProducedDrafts, type ProducedDrafts } from './produced'
import type { BuildInput, FlagSignal, StageSignalsInput } from './types'

const ok = (value: number) => ({ state: 'ok' as const, value })
const unread = { state: 'unreadable' as const, value: 0 }
const yes: FlagSignal = { state: 'ok', value: true }
const no: FlagSignal = { state: 'ok', value: false }

function stage(): StageSignalsInput {
  return {
    auth: yes, authLost: no, facts: ok(20), assets: ok(15),
    onTimeWeeks: unread, receipts: unread, periods: unread,
    circuitBreaker: { state: 'unreadable', value: false },
    complaintSpike: { state: 'unreadable', value: false },
  }
}

function input(): BuildInput {
  return {
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    industryKey: 'travel',
    clientConfig: null,
    weeklyQuota: { storyPerWeek: 18, postPerWeek: 4, reelPerWeek: 3 },
    pillarNames: {},
    lockMix: false,
    stage: stage(),
    goal: emptyGoalInput(),
    readbackSuggestion: emptyReadbackSuggestion(),
    themes: { read: 'none', items: [] },
  }
}

function produced(over: Partial<ProducedDrafts> = {}): ProducedDrafts {
  const empty = { requested: 0, drafted: 0, lines: [], skipped: null, error: null }
  return {
    story: { ...empty, requested: 18, skipped: 'no_automatic_story_asset_source' },
    post: {
      ...empty,
      requested: 4,
      drafted: 2,
      lines: [{ date: '2026-11-16', ref: 'p1' }, { date: '2026-11-18', ref: 'p2' }],
    },
    reel: { ...empty, drafted: 1, lines: [{ date: '2026-11-20', ref: 'r1' }] },
    ...over,
  }
}

describe('applyProducedDrafts', () => {
  it('lists the drafts that were actually written instead of the quota-sized slots', () => {
    const quota = buildWeeklySocialPlan(input())
    expect(quota.counts).toEqual({ story: 18, post: 4, reel: 3 })
    const plan = applyProducedDrafts(quota, produced())
    expect(plan.counts).toEqual({ story: 0, post: 2, reel: 1 })
    expect(plan.items.map((item) => [item.format, item.date, item.draftRef])).toEqual([
      ['reel', '2026-11-20', 'r1'],
      ['post', '2026-11-16', 'p1'],
      ['post', '2026-11-18', 'p2'],
    ])
    expect(plan.status).toBe('ready')
    expect(plan.gaps.some((gap) => gap.includes('已经生成的草稿'))).toBe(true)
    expect(plan.gaps.some((gap) => gap.includes('没有可自动取的 Story 成片'))).toBe(true)
  })

  it('keeps the other kinds when one kind failed', () => {
    const plan = applyProducedDrafts(buildWeeklySocialPlan(input()), produced({
      post: { requested: 4, drafted: 1, lines: [{ date: '2026-11-16', ref: 'p1' }], skipped: null, error: 'copy_failed' },
    }))
    expect(plan.status).toBe('incomplete')
    expect(plan.counts).toMatchObject({ reel: 1, post: 1, story: 0 })
    expect(plan.gaps.some((gap) => gap.includes('copy_failed'))).toBe(true)
  })

  it('does not replace a held week', () => {
    const quota = buildWeeklySocialPlan(input())
    const held = applyProducedDrafts({ ...quota, status: 'held' }, produced())
    expect(held.status).toBe('held')
    expect(held.counts).toEqual(quota.counts)
    expect(held.items).toEqual(quota.items)
    expect(held.gaps.at(-1)).toContain('这周暂停')
  })
})
