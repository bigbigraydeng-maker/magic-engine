/**
 * slot-gaps 的测试：用真实的 expandPromoSchedule 和真实的 plannedCountsInWindow，只造夹具。
 * 覆盖：数量相等但星期几不同、缺口、整份在窗口之前、空快照、读库失败、期望为 0、
 * reel 无成片仍算排好、形状错误、换计划形状、以及「永不报」的变异检查。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PROMO_PLAYBOOK } from '../playbooks'
import type { PromoSpec } from '../spec'
import type {
  BundleLite,
  DailyPlanRead,
  DailyPlanSnapshotLite,
  DayLite,
  PostBundleLite,
  ReelBundleLite,
  StoryBundleLite,
} from '../daily-plan-read'
import { detectSlotGaps, expectedSlotCounts, slotWindow } from '../slot-gaps'

/** 造一份推广计划：一个阶段，一个 social_cadence 步骤。 */
function mkSpec(postsPerWeek: number, storiesPerWeek: number, reelsPerMonth: number): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal_test',
    checks: [],
    phases: [
      {
        id: 'phase_1',
        name: '阶段一',
        start_date: '2026-10-01',
        end_date: '2026-12-31',
        steps: [
          {
            id: 'step_1',
            kind: 'social_cadence',
            settings: {
              posts_per_week: postsPerWeek,
              stories_per_week: storiesPerWeek,
              reels_per_month: reelsPerMonth,
            },
          },
        ],
      },
    ],
  }
}

/** 造一份两阶段的推广计划（用于「换计划形状」用例）。 */
function mkTwoPhaseSpec(): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal_test',
    checks: [],
    phases: [
      {
        id: 'phase_1',
        name: '阶段一',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        steps: [
          {
            id: 'step_1',
            kind: 'social_cadence',
            settings: { posts_per_week: 2, stories_per_week: 0, reels_per_month: 0 },
          },
        ],
      },
      {
        id: 'phase_2',
        name: '阶段二',
        start_date: '2026-11-01',
        end_date: '2026-12-31',
        steps: [
          {
            id: 'step_2',
            kind: 'social_cadence',
            settings: { posts_per_week: 2, stories_per_week: 0, reels_per_month: 0 },
          },
        ],
      },
    ],
  }
}

/** 内容齐全的 post bundle。 */
function mkPostBundle(): PostBundleLite {
  return {
    hook: 'hook',
    body: 'body',
    cta: 'cta',
    image_asset_id: 'asset_1',
    cta_url: 'https://example.com',
  }
}

/** 内容齐全的 story bundle（4 帧）。 */
function mkStoryBundle(): StoryBundleLite {
  return {
    frames: [
      { order: 1, copy: 'a' },
      { order: 2, copy: 'b' },
      { order: 3, copy: 'c' },
      { order: 4, copy: 'd' },
    ],
  }
}

/** 内容齐全的 reel bundle（无成片也算齐全）。 */
function mkReelBundle(): ReelBundleLite {
  return {
    brief: 'brief',
    script: 'script',
    caption: 'caption',
    source_asset_ids: [],
    media_status: 'NO_MEDIA',
  }
}

/** 造一份每日计划快照：planned 里给出「哪天排了哪几类」。 */
function mkSnap(
  campaign: string,
  createdAt: string,
  planned: Record<string, Array<'post' | 'story' | 'reel'>>,
): DailyPlanSnapshotLite {
  const days: DayLite[] = []
  const bundles: BundleLite[] = []
  for (const date of Object.keys(planned).sort()) {
    const kinds = planned[date]
    const slots = {
      post: kinds.includes('post') ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
      story: kinds.includes('story') ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
      reel: kinds.includes('reel') ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
    }
    days.push({ date, slots })
    bundles.push({
      date,
      post: kinds.includes('post') ? mkPostBundle() : null,
      story: kinds.includes('story') ? mkStoryBundle() : null,
      reel: kinds.includes('reel') ? mkReelBundle() : null,
    })
  }
  return {
    campaign_id: campaign,
    created_at: createdAt,
    days,
    bundles,
  }
}

/** 造一份「槽位标了 PLANNED 但没有 bundle」的快照（形状错误）。 */
function mkShapeErrorSnap(
  campaign: string,
  createdAt: string,
  date: string,
  kind: 'post' | 'story' | 'reel',
): DailyPlanSnapshotLite {
  const slots = {
    post: kind === 'post' ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
    story: kind === 'story' ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
    reel: kind === 'reel' ? ('PLANNED' as const) : ('NOT_PLANNED' as const),
  }
  return {
    campaign_id: campaign,
    created_at: createdAt,
    days: [{ date, slots }],
    bundles: [],
  }
}

const TODAY = '2026-10-15'
const FROM = '2026-10-16'
const TO = '2026-10-22'

describe('slotWindow', () => {
  it('窗口是今天+1 到 今天+7', () => {
    expect(slotWindow(TODAY)).toEqual({ from: FROM, to: TO })
  })
})

describe('expectedSlotCounts', () => {
  it('只数窗口内的 post / story / reel', () => {
    const spec = mkSpec(3, 3, 0)
    const { counts, error } = expectedSlotCounts(spec, DEFAULT_PROMO_PLAYBOOK, FROM, TO)
    expect(error).toBeNull()
    expect(counts.post).toBe(3)
    expect(counts.story).toBe(3)
    expect(counts.reel).toBe(0)
  })
})

describe('detectSlotGaps', () => {
  it('数量相等、星期几完全不同 → []', () => {
    // 计划要求 3 帖子 3 快拍；每日计划排了周二、周四、周六（与计划摆法无关），数量相等。
    const spec = mkSpec(3, 3, 0)
    const snap = mkSnap('c1', '2026-10-15T00:00:00Z', {
      '2026-10-20': ['post', 'story'],
      '2026-10-22': ['post', 'story'],
      '2026-10-17': ['post', 'story'],
    })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toEqual([])
  })

  it('要求 3 条帖子只排了 1 条 → 一条 daily_plan_gap，文案含「3 条帖子」且不含「周」「星期」', () => {
    const spec = mkSpec(3, 3, 0)
    const snap = mkSnap('c1', '2026-10-15T00:00:00Z', {
      '2026-10-20': ['post', 'story'],
      '2026-10-22': ['story'],
      '2026-10-17': ['story'],
    })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_gap')
    expect(findings[0].what).toContain('3 条帖子')
    expect(findings[0].what).not.toContain('周')
    expect(findings[0].what).not.toContain('星期')
  })

  it('每日计划最新一份整份在窗口之前 → 缺口 + 文案含「最新只排到 2026-10-14」，且只有一条发现', () => {
    const spec = mkSpec(3, 3, 0)
    const snap = mkSnap('c1', '2026-10-14T00:00:00Z', {
      '2026-10-14': ['post', 'story'],
    })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_gap')
    expect(findings[0].what).toContain('最新只排到 2026-10-14')
  })

  it('read ok 且 snapshots 为空 → 缺口 + 文案含「还没有建过每日计划」，与 read_failed 文案不同', () => {
    const spec = mkSpec(3, 3, 0)
    const read: DailyPlanRead = { status: 'ok', snapshots: [] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_gap')
    expect(findings[0].what).toContain('还没有建过每日计划')
    expect(findings[0].what).not.toContain('读不出来')
  })

  it('read_failed → 恰好一条 daily_plan_unreadable，不含缺口', () => {
    const spec = mkSpec(3, 3, 0)
    const read: DailyPlanRead = { status: 'read_failed', error: 'boom' }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_unreadable')
    expect(findings[0].what).toContain('boom')
  })

  it('期望为 0 → []', () => {
    const spec = mkSpec(0, 0, 0)
    const read: DailyPlanRead = { status: 'ok', snapshots: [] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toEqual([])
  })

  it('reel 无成片仍算排好 → 不报缺口', () => {
    // 阶段够长，reels_per_month > 0；每日计划排了 reel（media_status NO_MEDIA）。
    const spec = mkSpec(0, 0, 4)
    const expected = expectedSlotCounts(spec, DEFAULT_PROMO_PLAYBOOK, FROM, TO)
    expect(expected.error).toBeNull()
    expect(expected.counts.reel).toBeGreaterThan(0)

    // 把窗口内每一天都排上 reel，保证数量够。
    const planned: Record<string, Array<'post' | 'story' | 'reel'>> = {}
    for (let i = 1; i <= 7; i++) {
      const day = `2026-10-${String(15 + i).padStart(2, '0')}`
      planned[day] = ['reel']
    }
    const snap = mkSnap('c1', '2026-10-15T00:00:00Z', planned)
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toEqual([])
  })

  it('形状错误：PLANNED 但没有 bundle → 缺口文案含「草稿内容不全」', () => {
    const spec = mkSpec(3, 3, 0)
    const snap = mkShapeErrorSnap('c1', '2026-10-15T00:00:00Z', '2026-10-20', 'post')
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_gap')
    expect(findings[0].what).toContain('草稿内容不全')
  })

  it('换一个计划形状（posts_per_week=2、两个阶段）结果按条数算', () => {
    const spec = mkTwoPhaseSpec()
    const expected = expectedSlotCounts(spec, DEFAULT_PROMO_PLAYBOOK, FROM, TO)
    expect(expected.error).toBeNull()
    expect(expected.counts.post).toBe(2)

    // 每日计划覆盖满 7 天（到 10-22），但帖子只排了 1 条（另一天只有快拍，用来把覆盖拉到 10-22）
    const snap = mkSnap('c1', '2026-10-15T00:00:00Z', {
      '2026-10-20': ['post'],
      '2026-10-22': ['story'],
    })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const findings = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('daily_plan_gap')
    expect(findings[0].what).toContain('2 条帖子')
  })

  it('变异检查：neverReport 下得到 []，detectSlotGaps 得到非空', () => {
    const neverReport = (): [] => []
    const spec = mkSpec(3, 3, 0)
    const snap = mkSnap('c1', '2026-10-15T00:00:00Z', {
      '2026-10-20': ['post', 'story'],
      '2026-10-22': ['story'],
      '2026-10-17': ['story'],
    })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const input = { title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read }
    expect(neverReport()).toEqual([])
    expect(detectSlotGaps(input).length).toBeGreaterThan(0)
  })

  // ── 周中常态：每日计划是一整份 7 天、每周才排一次，窗口伸到覆盖范围之外不是缺口 ──
  it('每周一整份 7 天快照、今天是周中（只覆盖到 10-18，窗口到 10-22）：条数按覆盖天数折算，不误报', () => {
    const spec = mkSpec(3, 0, 0)
    // 覆盖 10-16 至 10-18 共 3 天；每周 3 条 → 3 天的下限是 floor(3*3/7)=1；排了 1 条帖子 → 够
    const snap = mkSnap('c1', '2026-10-13T00:00:00Z', { '2026-10-16': ['post'], '2026-10-18': ['story'] })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    expect(detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })).toEqual([])
  })
  it('覆盖不足 3 天时不做条数比较（太短）', () => {
    const spec = mkSpec(3, 0, 0)
    const snap = mkSnap('c1', '2026-10-13T00:00:00Z', { '2026-10-16': ['story'], '2026-10-17': ['story'] })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    expect(detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })).toEqual([])
  })
  it('明天起一天都没覆盖才是缺口（每日计划只排到今天）', () => {
    const spec = mkSpec(3, 0, 0)
    const snap = mkSnap('c1', '2026-10-13T00:00:00Z', { '2026-10-15': ['post'] })
    const read: DailyPlanRead = { status: 'ok', snapshots: [snap] }
    const out = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(out).toHaveLength(1)
    expect(out[0].what).toContain('明天起一天都没有排')
  })
  it('短视频不参与比较：只要求短视频时不出任何发现', () => {
    const spec = mkSpec(0, 0, 8)
    const read: DailyPlanRead = { status: 'ok', snapshots: [] }
    expect(detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })).toEqual([])
  })
  it('记录存在但全部读不懂 → 不说「没建过」，走读不到（开发欠账）', () => {
    const spec = mkSpec(3, 0, 0)
    const read: DailyPlanRead = { status: 'ok', snapshots: [], rows_total: 2, rows_unparseable: 2 }
    const out = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('daily_plan_unreadable')
    expect(out[0].what).toContain('读不懂')
    expect(out[0].what).not.toContain('没有建过')
  })
  it('文案不承诺自动补排', () => {
    const spec = mkSpec(3, 0, 0)
    const read: DailyPlanRead = { status: 'ok', snapshots: [] }
    const out = detectSlotGaps({ title: '计划A', today: TODAY, spec, playbook: DEFAULT_PROMO_PLAYBOOK, read })
    expect(out[0].how).toContain('不会自动补')
    expect(out[0].how).not.toContain('让代理')
  })
})
