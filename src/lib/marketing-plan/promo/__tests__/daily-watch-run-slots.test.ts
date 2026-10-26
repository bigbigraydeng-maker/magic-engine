/**
 * 每日检查接上「每日计划条数核对」之后的编排测试。
 * 只 mock 看板（buildPromoBoard）和数据库客户端；排期展开、条数核对、缺口判断都是真的。
 * 假库会记录每次读了哪张表、有没有写库。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '../board'
import type { PromoSpec } from '../spec'

const m = vi.hoisted(() => ({
  plans: [] as unknown[],
  dailyRows: [] as unknown[],
  dailyError: null as { message: string } | null,
  reads: [] as string[],
  writes: [] as string[],
  buildPromoBoard: vi.fn(),
}))
vi.mock('../board', () => ({ buildPromoBoard: m.buildPromoBoard }))
import { runPromoPlanWatch } from '../daily-watch-run'

const NOW = new Date('2026-10-15T01:00:00Z')

const spec = (): PromoSpec => ({
  schema: 'promo_v1', goal_id: 'g1', checks: [],
  phases: [{ id: 'p1', name: '阶段', start_date: '2026-10-01', end_date: '2026-12-31', steps: [
    { id: 's1', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 0, reels_per_month: 0 } },
  ] }],
})

function fakeSupabase(): SupabaseClient {
  const from = (table: string) => {
    m.reads.push(table)
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.select = pass; c.in = pass; c.not = pass; c.eq = pass; c.contains = pass; c.order = pass
    const result = table === 'marketing_plans'
      ? { data: m.plans, error: null }
      : { data: m.dailyError ? null : m.dailyRows, error: m.dailyError }
    c.limit = async () => result
    c.then = (resolve: (v: unknown) => unknown) => resolve(result)
    for (const w of ['insert', 'update', 'upsert', 'delete']) c[w] = () => { m.writes.push(w); return c }
    return c
  }
  return { from } as unknown as SupabaseClient
}

const plan = (id: string, clientId: string, status: 'approved' | 'draft' = 'approved'): MarketingPlan => ({
  id, client_id: clientId, title: `计划${id}`, status, plan_data: { promo: spec() }, generation_meta: null,
  updated_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
} as unknown as MarketingPlan)

const board = (over: Partial<PromoBoard> = {}): PromoBoard => ({
  plan_id: 'p', plan_status: 'approved', updated_at: null, has_promo: true, spec_valid: true, issues: [],
  today: '2026-10-15', timezone_known: true, playbook: null, approval: null, next_phase: null,
  reconcile: { window: { start: '2026-10-01', end: '2026-10-07' }, week_index: 3, rows: [], headline: '', blind: false },
  reviewed_this_window: false, content_changed: false, ...over,
})

/** 一份只排到 10-14 的每日计划（今天起未来 7 天一天都没覆盖） */
const expiredDaily = () => ({
  created_at: '2026-10-06T23:00:00Z',
  plan_data: {
    plan_kind: 'campaign_daily_v1', campaign_id: 'camp-1',
    days: [{ date: '2026-10-14', slots: { post: 'PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' } }],
    bundles: [{ date: '2026-10-14', post: { hook: 'h', body: 'b', cta: 'c', image_asset_id: 'i', cta_url: 'https://x' }, story: null, reel: null }],
  },
})

beforeEach(() => {
  m.plans = []; m.dailyRows = []; m.dailyError = null; m.reads = []; m.writes = []
  m.buildPromoBoard.mockReset()
  m.buildPromoBoard.mockResolvedValue(board())
})

describe('已批准 + 已开始的计划：核对未来 7 天每日计划条数', () => {
  it('每日计划最新只排到昨天 → 出 daily_plan_gap，文案写明「最新只排到」，不含星期几', async () => {
    m.plans = [plan('a', 'c1')]; m.dailyRows = [expiredDaily()]
    const { receipt, sources } = await runPromoPlanWatch(fakeSupabase(), NOW)
    const gap = sources.find(s => s.finding.code === 'daily_plan_gap')
    expect(gap).toBeDefined()
    expect(gap?.finding.what).toContain('最新只排到 2026-10-14')
    expect(gap?.finding.what).not.toMatch(/周[一二三四五六日]|星期/)
    expect(receipt.items.map(i => i.code)).toContain('daily_plan_gap')
    expect(m.writes).toEqual([])
  })

  it('读每日计划失败 → 只出 daily_plan_unreadable，不当成缺口', async () => {
    m.plans = [plan('a', 'c1')]; m.dailyError = { message: '库挂了' }
    const { sources } = await runPromoPlanWatch(fakeSupabase(), NOW)
    expect(sources.map(s => s.finding.code)).toEqual(['daily_plan_unreadable'])
  })

  it('一份每日计划都没有 → 缺口，文案是「还没有建过每日计划」，和读失败不同', async () => {
    m.plans = [plan('a', 'c1')]; m.dailyRows = []
    const { sources } = await runPromoPlanWatch(fakeSupabase(), NOW)
    expect(sources).toHaveLength(1)
    expect(sources[0].finding.code).toBe('daily_plan_gap')
    expect(sources[0].finding.what).toContain('还没有建过每日计划')
  })

  it('同一客户两份已批准计划：每日计划只读一次', async () => {
    m.plans = [plan('a', 'c1'), plan('b', 'c1')]; m.dailyRows = [expiredDaily()]
    await runPromoPlanWatch(fakeSupabase(), NOW)
    expect(m.reads.filter(t => t === 'social_plans')).toHaveLength(1)
  })

  it('草稿 / 时区未知 / 计划还没开始 → 不读每日计划', async () => {
    m.plans = [plan('d', 'c1', 'draft')]
    m.buildPromoBoard.mockResolvedValue(board({ plan_status: 'draft' }))
    await runPromoPlanWatch(fakeSupabase(), NOW)
    m.plans = [plan('a', 'c2')]
    m.buildPromoBoard.mockResolvedValue(board({ timezone_known: false }))
    await runPromoPlanWatch(fakeSupabase(), NOW)
    m.buildPromoBoard.mockResolvedValue(board({ reconcile: { window: { start: '', end: '' }, week_index: null, rows: [], headline: '', blind: false } }))
    await runPromoPlanWatch(fakeSupabase(), NOW)
    expect(m.reads.filter(t => t === 'social_plans')).toHaveLength(0)
  })

  it('条数够（未来 7 天排了 3 条帖子）→ 不出缺口', async () => {
    m.plans = [plan('a', 'c1')]
    const days = ['2026-10-16', '2026-10-18', '2026-10-20']
    m.dailyRows = [{
      created_at: '2026-10-14T00:00:00Z',
      plan_data: {
        plan_kind: 'campaign_daily_v1', campaign_id: 'camp-1',
        days: days.map(date => ({ date, slots: { post: 'PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' } })),
        bundles: days.map(date => ({ date, post: { hook: 'h', body: 'b', cta: 'c', image_asset_id: `i${date}`, cta_url: 'https://x' }, story: null, reel: null })),
      },
    }]
    const { sources } = await runPromoPlanWatch(fakeSupabase(), NOW)
    expect(sources.filter(s => s.finding.code.startsWith('daily_plan'))).toEqual([])
  })
})
