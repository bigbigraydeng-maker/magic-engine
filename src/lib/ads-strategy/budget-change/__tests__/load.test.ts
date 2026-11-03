/**
 * 调预算预览取数（第 3 刀 3b）：认不认这个组、当场读 Meta、系列只在「唯一在投组」时能加。
 * Meta 与信封事实解析器用替身；库用内核测试的假件（不连生产库、不碰广告账户）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'

const h = vi.hoisted(() => ({
  live: vi.fn(),
  children: vi.fn(),
  resolve: vi.fn(),
  token: 'tok' as string | null,
}))
vi.mock('@/lib/meta/budget-entity-live', () => ({ getBudgetEntityLive: h.live }))
vi.mock('@/lib/meta/adsets', () => ({ listAdSetsInCampaign: h.children }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => h.token }))
vi.mock('@/lib/capabilities', () => ({ createCapabilities: () => ({}) }))
vi.mock('@/lib/capabilities/ads/envelope-facts', () => ({ createAdsEnvelopeFactsResolver: () => h.resolve }))

import { loadBudgetChange } from '../load'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const NOW = new Date('2026-11-04T00:00:00.000Z')
const scorecardUnits = [
  { level: 'adset', id: '456', adAccountId: 'act_123' },
  { level: 'campaign', id: '789', adAccountId: 'act_123' },
]

function db(units: unknown[] = scorecardUnits) {
  return createFakeSupabase({
    ads_growth_states: [{ client_id: CLIENT, date: '2026-11-03', payload: { scorecard: { units } } }],
    ad_entity_snapshots: [
      { client_id: CLIENT, level: 'adset', entity_id: '456', currency: 'NZD', captured_at: '2026-11-03T00:00:00Z' },
      { client_id: CLIENT, level: 'campaign', entity_id: '789', currency: 'NZD', captured_at: '2026-11-03T00:00:00Z' },
    ],
  })
}

const facts = {
  beforeCents: 10000, accountDailyTotalBeforeCents: 10000, clientDailyTotalBeforeCents: 30000,
  dailyCapCents: 50000, clientDailyCapCents: 50000, learningPhaseApplicable: true, learningStage: null,
  hoursSinceLastChange: 100, adStudyCount: 0, hasRollbackHandler: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.token = 'tok'
  h.live.mockResolvedValue({ id: '456', daily_budget: '10000', updated_time: '2026-10-30T00:00:00+0000', account_id: '123', campaign_id: '789' })
  h.resolve.mockImplementation(async ({ input }: { input: { after_cents: number } }) => ({ request: { kind: 'budget_change', afterCents: input.after_cents }, facts }))
})

describe('loadBudgetChange', () => {
  it('ABO 广告组：读 Meta 当前预算，+10% / +20% 按 PM 放量信封判（学习期读不到也放）', async () => {
    const r = await loadBudgetChange(db(), CLIENT, { level: 'adset', id: '456', adAccountId: 'act_123' }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.plan.currentCents).toBe(10000)
    expect(r.plan.currency).toBe('NZD')
    expect(r.plan.up10).toMatchObject({ allowed: true, afterCents: 11000 })
    expect(r.plan.up20).toMatchObject({ allowed: true, afterCents: 12000 })
    expect(r.plan.capHeadroomCents).toBe(20000)
    expect(r.target).toMatchObject({ scaleAdsetId: '456', campaignId: '789', cycleDate: '2026-11-03' })
    // ABO 不带 campaign_id 去问信封（带了会按 CBO 判）
    expect(h.resolve.mock.calls[0][0].input).not.toHaveProperty('campaign_id')
  })

  it('🔴 不在最新成绩单里 → 409，不读 Meta', async () => {
    const r = await loadBudgetChange(db([]), CLIENT, { level: 'adset', id: '456', adAccountId: 'act_123' }, NOW)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(h.live).not.toHaveBeenCalled()
  })

  it('🔴 Meta 上这个组属于别的广告账户 → 403', async () => {
    h.live.mockResolvedValue({ id: '456', daily_budget: '10000', updated_time: '2026-10-30T00:00:00+0000', account_id: '999' })
    const r = await loadBudgetChange(db(), CLIENT, { level: 'adset', id: '456', adAccountId: 'act_123' }, NOW)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('当场读不到 Meta → 409', async () => {
    h.live.mockResolvedValue(null)
    expect(await loadBudgetChange(db(), CLIENT, { level: 'adset', id: '456', adAccountId: 'act_123' }, NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('系列下两个在投组 → 不能加（写明原因），减照常', async () => {
    h.live.mockResolvedValue({ id: '789', daily_budget: '20000', updated_time: '2026-10-30T00:00:00+0000', account_id: '123' })
    h.children.mockResolvedValue([{ id: 'a', effective_status: 'ACTIVE' }, { id: 'b', effective_status: 'ACTIVE' }])
    const r = await loadBudgetChange(db(), CLIENT, { level: 'campaign', id: '789', adAccountId: 'act_123' }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.plan.up10.allowed).toBe(false)
    expect(r.plan.up10.reasons[0]).toContain('2 个在投广告组')
    expect(r.plan.reduce.allowed).toBe(true)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('系列下只有一个在投组 → 用那个组去问信封，并带上 campaign_id', async () => {
    h.live.mockResolvedValue({ id: '789', daily_budget: '20000', updated_time: '2026-10-30T00:00:00+0000', account_id: '123' })
    h.children.mockResolvedValue([{ id: 'a', effective_status: 'ACTIVE' }, { id: 'b', effective_status: 'PAUSED' }])
    const r = await loadBudgetChange(db(), CLIENT, { level: 'campaign', id: '789', adAccountId: 'act_123' }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.target.scaleAdsetId).toBe('a')
    expect(h.resolve.mock.calls[0][0].input).toMatchObject({ adset_id: 'a', campaign_id: '789', before_cents: 20000, after_cents: 22000 })
  })

  it('信封事实读不到 → 加不了，原因带出处', async () => {
    h.resolve.mockResolvedValue({ unavailable: 'facts:读不到客户日上限' })
    const r = await loadBudgetChange(db(), CLIENT, { level: 'adset', id: '456', adAccountId: 'act_123' }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.plan.up10.allowed).toBe(false)
    expect(r.plan.up10.reasons.join()).toContain('facts:读不到客户日上限')
  })
})
