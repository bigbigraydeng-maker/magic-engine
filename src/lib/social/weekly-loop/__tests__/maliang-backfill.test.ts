import { describe, expect, it } from 'vitest'
import {
  MALIANG_WEEKLY_CAP_DEFAULT_USD,
  backfillVideoUrl,
  maliangWeeklyCapUsd,
  overlayReviews,
  pickBackfillTargets,
  sumWeeklyMaliangSpend,
} from '../maliang-backfill'
import type { WeeklyLoopItem, WeeklyLoopOrderRow } from '../run'
import type { MaliangCheck } from '@/lib/maliang/render-check'

const SUPA = 'https://abc.supabase.co'

function row(id: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return {
    id,
    status: 'published',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: 'u-' + id,
    angle: 'Title ' + id,
    brief: {},
    output: { caption: 'cap ' + id, video_path: 'cts/' + id + '.mp4' },
    review_ref: null,
    published_ref: null,
    ...over,
  }
}

function item(id: string, over: Partial<WeeklyLoopItem> = {}): WeeklyLoopItem {
  return {
    id,
    title: id,
    fact_verdict: 'pass',
    maliang: 'missing',
    questions: [],
    product_key: null,
    excluded_reason: 'unreviewed',
    ...over,
  }
}

describe('maliangWeeklyCapUsd', () => {
  it('reads the configured cap, clamps to the ceiling, and falls back on bad input', () => {
    expect(maliangWeeklyCapUsd({})).toBe(MALIANG_WEEKLY_CAP_DEFAULT_USD)
    expect(maliangWeeklyCapUsd({ weekly_loop: { maliang_weekly_cap_usd: 1.2 } })).toBe(1.2)
    expect(maliangWeeklyCapUsd({ weekly_loop: { maliang_weekly_cap_usd: 99 } })).toBe(5)
    expect(maliangWeeklyCapUsd({ weekly_loop: { maliang_weekly_cap_usd: 0 } })).toBe(
      MALIANG_WEEKLY_CAP_DEFAULT_USD,
    )
    expect(maliangWeeklyCapUsd({ weekly_loop: { maliang_weekly_cap_usd: -1 } })).toBe(
      MALIANG_WEEKLY_CAP_DEFAULT_USD,
    )
    expect(maliangWeeklyCapUsd({ weekly_loop: { maliang_weekly_cap_usd: '1' } })).toBe(
      MALIANG_WEEKLY_CAP_DEFAULT_USD,
    )
    expect(maliangWeeklyCapUsd(null)).toBe(MALIANG_WEEKLY_CAP_DEFAULT_USD)
  })
})

describe('sumWeeklyMaliangSpend', () => {
  it('adds valid spent_usd values and ignores everything else', () => {
    const total = sumWeeklyMaliangSpend([
      { maliang_backfill: { spent_usd: 0.1 } },
      { maliang_backfill: { spent_usd: 0.25 } },
      null,
      { maliang_backfill: { spent_usd: -1 } },
      { maliang_backfill: { spent_usd: 'x' } },
      { other: 1 },
    ])
    expect(total).toBeCloseTo(0.35)
  })

  it('sums each per-review charge entry instead of one lump spent_usd', () => {
    const total = sumWeeklyMaliangSpend([
      { maliang_backfill: { charges_usd: [0.05, 0.05, 0.05, 0.05], spent_usd: 0.05 } },
      { maliang_backfill: { charges_usd: [0.05], spent_usd: 0.25 } },
    ])
    expect(total).toBeCloseTo(0.25)
  })
})

describe('backfillVideoUrl', () => {
  it('builds a public storage url and rejects unusable inputs', () => {
    expect(backfillVideoUrl('cts/a.mp4', SUPA + '/')).toBe(
      'https://abc.supabase.co/storage/v1/object/public/content-factory/cts/a.mp4',
    )
    expect(backfillVideoUrl('', SUPA)).toBeNull()
    expect(backfillVideoUrl(null, SUPA)).toBeNull()
    expect(backfillVideoUrl('cts/a.mp4', undefined)).toBeNull()
    expect(backfillVideoUrl('cts/a.mp4', 'not a url')).toBeNull()
  })
})

describe('pickBackfillTargets', () => {
  it('picks only unreviewed items whose fact verdict passed', () => {
    const items = [
      item('a'),
      item('b', { fact_verdict: 'fail' }),
      item('c', { excluded_reason: 'maliang_fail', maliang: 'fail' }),
      item('d', { excluded_reason: null }),
    ]
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const { targets, skipped } = pickBackfillTargets({
      items,
      rows,
      brandName: 'Brand',
      supabaseUrl: SUPA,
      spentUsd: 0,
      capUsd: 0.5,
      maxPerRun: 6,
    })
    expect(targets.map((t) => t.id)).toEqual(['a'])
    expect(skipped).toEqual({})
    expect(targets[0].readUpdatedAt).toBe('u-a')
    expect(targets[0].videoUrl).toContain('cts/a.mp4')
    expect(targets[0].input.title).toBe('Title a')
    expect(targets[0].input.expectedCaptions).toContain('cap a')
  })

  it('skips items with no video and items with no row', () => {
    const items = [item('a'), item('b')]
    const rows = [row('a', { output: { caption: 'x' } })]
    const { targets, skipped } = pickBackfillTargets({
      items,
      rows,
      brandName: 'Brand',
      supabaseUrl: SUPA,
      spentUsd: 0,
      capUsd: 0.5,
      maxPerRun: 6,
    })
    expect(targets).toEqual([])
    expect(skipped).toEqual({ no_video: 1, row_missing: 1 })
  })

  it('stops at the per-run cap', () => {
    const items = [item('a'), item('b'), item('c'), item('d')]
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const { targets, skipped } = pickBackfillTargets({
      items,
      rows,
      brandName: 'Brand',
      supabaseUrl: SUPA,
      spentUsd: 0,
      capUsd: 5,
      maxPerRun: 2,
    })
    expect(targets.length).toBe(2)
    expect(skipped).toEqual({ run_cap: 2 })
  })

  it('stops when the weekly budget would be exceeded', () => {
    const items = [item('a'), item('b'), item('c'), item('d')]
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const { targets, skipped } = pickBackfillTargets({
      items,
      rows,
      brandName: 'Brand',
      supabaseUrl: SUPA,
      spentUsd: 0.4,
      capUsd: 0.5,
      maxPerRun: 6,
    })
    expect(targets.length).toBe(2)
    expect(skipped).toEqual({ budget: 2 })
  })

  it('makes no calls when the budget is already used up', () => {
    const items = [item('a'), item('b'), item('c')]
    const rows = [row('a'), row('b'), row('c')]
    const { targets, skipped } = pickBackfillTargets({
      items,
      rows,
      brandName: 'Brand',
      supabaseUrl: SUPA,
      spentUsd: 0.5,
      capUsd: 0.5,
      maxPerRun: 6,
    })
    expect(targets).toEqual([])
    expect(skipped).toEqual({ budget: 3 })
  })
})

describe('overlayReviews', () => {
  it('stamps checks into matching rows without mutating inputs', () => {
    const rows = [row('a'), row('b')]
    const check: MaliangCheck = {
      status: 'pass',
      checked_at: '2026-11-04T00:00:00Z',
      video_url: 'v',
      reasons: [],
      frames: [],
      model: 'm',
    }
    const result = overlayReviews(rows, { a: check })
    const stamped = result[0].output as Record<string, unknown>
    const stampedCheck = stamped.maliang_check as Record<string, unknown>
    expect(stampedCheck.status).toBe('pass')
    expect(stamped.machine_reviewed).toBe(true)
    expect(stamped.caption).toBe('cap a')
    expect(result[1]).toBe(rows[1])
    const original = rows[0].output as Record<string, unknown>
    expect(original.maliang_check).toBeUndefined()
  })
})
