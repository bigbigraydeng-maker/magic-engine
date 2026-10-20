import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { describeLiveAds, summarizeLiveAds } from '../live-ads'

describe('summarizeLiveAds', () => {
  it('counts only ACTIVE adsets and ignores disappeared', () => {
    const fact = summarizeLiveAds({
      adsets: [
        { entity_id: 'a1', effective_status: 'ACTIVE', capture_reason: 'scheduled', captured_at: '2024-06-01T10:00:00Z' },
        { entity_id: 'a2', effective_status: 'ACTIVE', capture_reason: 'disappeared', captured_at: '2024-06-01T11:00:00Z' },
        { entity_id: 'a3', effective_status: 'PAUSED', capture_reason: 'scheduled', captured_at: '2024-06-01T12:00:00Z' },
        { entity_id: 'a4', effective_status: 'ACTIVE', capture_reason: null, captured_at: '2024-06-01T09:00:00Z' },
      ],
      insights: [],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.live_adsets).toBe(2)
    expect(fact.as_of).toBe('2024-06-01T12:00:00Z')
    expect(fact.currency).toBe('USD')
  })

  it('sums spend_today when latest insight_date equals today', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [
        { insight_date: '2024-06-01', spend: 10 },
        { insight_date: '2024-06-01', spend: 5.5 },
        { insight_date: '2024-05-31', spend: 100 },
      ],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.spend_day).toBe('2024-06-01')
    expect(fact.spend_today).toBe(15.5)
  })

  it('returns spend_today null when latest day is yesterday', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [
        { insight_date: '2024-05-31', spend: 42 },
        { insight_date: '2024-05-30', spend: 7 },
      ],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.spend_day).toBe('2024-05-31')
    expect(fact.spend_today).toBeNull()
  })

  it('handles empty inputs', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [],
      currency: null,
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.live_adsets).toBe(0)
    expect(fact.spend_today).toBeNull()
    expect(fact.spend_day).toBeNull()
    expect(fact.as_of).toBeNull()
    expect(fact.currency).toBeNull()
  })

  it('分账户列出在跑广告组，带账户标签与快照时间', () => {
    const fact = summarizeLiveAds({
      adsets: [
        { entity_id: 'a', ad_account_id: 'act_1', effective_status: 'ACTIVE', capture_reason: 'daily', captured_at: '2026-10-20T06:00:00Z' },
        { entity_id: 'b', ad_account_id: 'act_2', effective_status: 'ACTIVE', capture_reason: 'daily', captured_at: '2026-10-19T12:00:00Z' },
        { entity_id: 'c', ad_account_id: 'act_2', effective_status: 'ACTIVE', capture_reason: 'daily', captured_at: '2026-10-19T12:00:00Z' },
      ],
      insights: [],
      currency: 'NZD',
      today: '2026-10-20',
      accountLabels: { act_1: '官方账户', act_2: '主账户' },
    })
    if (!fact.ok) throw new Error('expected ok')
    expect(fact.live_adsets).toBe(3)
    expect(fact.by_account).toEqual([
      { ad_account_id: 'act_1', label: '官方账户', live_adsets: 1, as_of: '2026-10-20T06:00:00Z', state: 'no_spend_data', last_insight_day: null, spend_3d: 0 },
      { ad_account_id: 'act_2', label: '主账户', live_adsets: 2, as_of: '2026-10-19T12:00:00Z', state: 'no_spend_data', last_insight_day: null, spend_3d: 0 },
    ])
  })

  const mk = (accountInsights: Record<string, { last_day: string | null; spend_3d: number }>) => summarizeLiveAds({
    adsets: [
      { entity_id: 'a', ad_account_id: 'act_1', effective_status: 'ACTIVE', capture_reason: 'daily', captured_at: '2026-10-20T06:00:00Z' },
      { entity_id: 'b', ad_account_id: 'act_2', effective_status: 'ACTIVE', capture_reason: 'daily', captured_at: '2026-10-19T12:00:00Z' },
    ],
    insights: [], currency: 'NZD', today: '2026-10-20', accountLabels: { act_1: '官方账户', act_2: '主账户' }, accountInsights,
  })
  it('三种状态：有花费=spending，花费数据过旧/缺失=no_spend_data，新数据且 0=idle', () => {
    const f = mk({ act_1: { last_day: '2026-10-20', spend_3d: 156.01 }, act_2: { last_day: '2026-10-10', spend_3d: 0 } })
    if (!f.ok) throw new Error('ok')
    expect(f.by_account.map(a => a.state)).toEqual(['spending', 'no_spend_data'])
    expect(f.spending_adsets).toBe(1)
    const g = mk({ act_1: { last_day: '2026-10-20', spend_3d: 0 } })
    if (!g.ok) throw new Error('ok')
    expect(g.by_account.map(a => a.state)).toEqual(['idle', 'no_spend_data'])
  })
  it('描述：只有确认有花费才红字；花费数据过旧是黄字且不说「在花钱」；全 0 灰字', () => {
    const red = describeLiveAds(mk({ act_1: { last_day: '2026-10-20', spend_3d: 156.01 }, act_2: { last_day: '2026-10-10', spend_3d: 0 } }))
    expect(red?.level).toBe('red')
    expect(red?.text).toContain('官方账户 1 个')
    expect(red?.text).not.toContain('主账户')
    const amber = describeLiveAds(mk({}))
    expect(amber?.level).toBe('amber')
    expect(amber?.text).not.toContain('⚠️')
    expect(amber?.text).toContain('没法确认')
    const grey = describeLiveAds(mk({ act_1: { last_day: '2026-10-20', spend_3d: 0 }, act_2: { last_day: '2026-10-20', spend_3d: 0 } }))
    expect(grey?.level).toBe('grey')
    expect(describeLiveAds(null)).toBeNull()
    expect(describeLiveAds({ ok: false, reason: 'x' })).toBeNull()
  })
})
