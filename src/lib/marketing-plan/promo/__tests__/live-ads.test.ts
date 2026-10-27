import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { summarizeLiveAds } from '../live-ads'
import { adsRunningFrom, describeLiveAds } from '../live-ads-message'
import type { LiveAdsFact } from '../live-ads-message'

const adset = (id: string, acct: string, status = 'ACTIVE', at = '2026-10-20T06:00:00Z') =>
  ({ entity_id: id, ad_account_id: acct, effective_status: status, capture_reason: 'daily', captured_at: at })
const labels = { act_1: '官方账户', act_2: '主账户' }
const mk = (
  accountInsights: Record<string, { last_day: string | null; spend_2d: number }>,
  accountFacts: Record<string, { currency: string | null; status_code: number | null }> = {},
  snapshotAgeHours: number | null = 0,
) => summarizeLiveAds({
  adsets: [adset('a', 'act_1'), adset('b', 'act_2', 'ACTIVE', '2026-10-19T12:00:00Z'), adset('c', 'act_2', 'PAUSED')],
  accountLabels: labels, accountInsights, accountFacts, today: '2026-10-20', snapshotAgeHours,
})
const ok = (f: LiveAdsFact) => { if (!f.ok) throw new Error('expected ok'); return f }

describe('summarizeLiveAds', () => {
  it('只数 ACTIVE 且没消失的广告组，按账户分开', () => {
    const f = ok(mk({}))
    expect(f.live_adsets).toBe(2)
    expect(f.by_account.map(a => [a.ad_account_id, a.live_adsets])).toEqual([['act_1', 1], ['act_2', 1]])
  })
  it('消失的广告组不算', () => {
    const f = ok(summarizeLiveAds({ adsets: [{ ...adset('a', 'act_1'), capture_reason: 'disappeared' }], today: '2026-10-20' }))
    expect(f.live_adsets).toBe(0)
  })
  it('四种状态：2 天内有花费=spending；花费数据没跟上/缺失=no_spend_data；新数据且 0=idle；欠款=unusable', () => {
    const f = ok(mk({ act_1: { last_day: '2026-10-20', spend_2d: 156.01 }, act_2: { last_day: '2026-10-10', spend_2d: 0 } }, { act_2: { currency: 'NZD', status_code: 3 } }))
    expect(f.by_account.map(a => a.state)).toEqual(['spending', 'unusable'])
    expect(f.spending_adsets).toBe(1)
    expect(ok(mk({ act_1: { last_day: '2026-10-20', spend_2d: 0 } })).by_account.map(a => a.state)).toEqual(['idle', 'no_spend_data'])
    expect(ok(mk({ act_1: { last_day: '2026-10-18', spend_2d: 99 } })).by_account[0].state).toBe('no_spend_data') // 2 天前的数据不算「近 2 天」
  })
})

describe('describeLiveAds', () => {
  it('红字：只列确认有花费的账户，说清「手动开的、ME 没有批准记录」，不再说「请先批准」', () => {
    const m = describeLiveAds(mk({ act_1: { last_day: '2026-10-20', spend_2d: 156.01 }, act_2: { last_day: '2026-10-10', spend_2d: 0 } }, { act_1: { currency: 'NZD', status_code: 1 }, act_2: { currency: 'NZD', status_code: 3 } }))
    expect(m?.level).toBe('red')
    expect(m?.text).toContain('ME 里没有这些广告的批准记录')
    expect(m?.text).not.toContain('手动开的')
    expect(m?.text).toContain('NZ$156.01')
    expect(m?.text).toContain('补走批准流程')
    expect(m?.text).not.toContain('联系统筹')
    expect(m?.text).not.toContain('UTC')
    expect(m?.text).toContain('主账户') // 欠款账户以灰字另说
    expect(m?.text).toContain('不会出广告')
  })
  it('黄字：花费数据没跟上，明说可能已经在花钱，不说「停在」，不当成没事', () => {
    const m = describeLiveAds(mk({ act_1: { last_day: '2026-09-22', spend_2d: 0 } }, { act_2: { currency: 'NZD', status_code: 3 } }))
    expect(m?.level).toBe('amber')
    expect(m?.text).toContain('从 2026-09-22 起没有花费记录')
    expect(m?.text).toContain('可能已经在花钱')
    expect(m?.text).toContain('别当成没事')
    expect(m?.text).not.toContain('停在')
    expect(m?.text).toContain('欠款')
  })
  it('只有欠款账户 → 灰字「不会出广告」', () => {
    const f = summarizeLiveAds({ adsets: [adset('b', 'act_2')], accountLabels: labels, accountFacts: { act_2: { currency: null, status_code: 3 } }, today: '2026-10-20', snapshotAgeHours: 0 })
    expect(describeLiveAds(f)?.level).toBe('grey')
  })
  it('近 2 天没花费 → 灰字', () => {
    const m = describeLiveAds(mk({ act_1: { last_day: '2026-10-20', spend_2d: 0 }, act_2: { last_day: '2026-10-20', spend_2d: 0 } }))
    expect(m?.level).toBe('grey')
  })
  it('快照停摆：0 个在跑但最近一次抓取已 ≥2 天 → 灰字，不读成没事；新鲜时 0 个 → 不出声', () => {
    const stale = ok(summarizeLiveAds({ adsets: [], today: '2026-10-20', snapshotAgeHours: 125 }))
    expect(describeLiveAds(stale)?.text).toContain('已 5 天没更新')
    expect(describeLiveAds(ok(summarizeLiveAds({ adsets: [], today: '2026-10-20', snapshotAgeHours: 0 })))).toBeNull()
  })
  it('没有账户名称时不把 act_ 编号写出来', () => {
    const f = summarizeLiveAds({
      adsets: [adset('a', 'act_42')],
      accountInsights: { act_42: { last_day: '2026-10-20', spend_2d: 10 } },
      accountFacts: { act_42: { currency: 'NZD', status_code: 1 } },
      today: '2026-10-20',
      snapshotAgeHours: 0,
    })
    const text = describeLiveAds(f)?.text ?? ''
    expect(text).not.toMatch(/act_\d/)
    expect(text).toContain('已绑定的广告账户')
    expect(text).toContain('NZ$10.00')
  })
  it('读不到 / null → 不出提示', () => {
    expect(describeLiveAds(null)).toBeNull()
    expect(describeLiveAds({ ok: false, reason: 'x' })).toBeNull()
  })
})

describe('adsRunningFrom（排期表头「目前广告没有投」的闸）', () => {
  const none = (hours: number | null) => ok(summarizeLiveAds({ adsets: [], today: '2026-10-20', snapshotAgeHours: hours }))
  it('快照 8 小时内且没有在跑 → none；超过 8 小时或不知道 → unknown（不写那句）', () => {
    expect(adsRunningFrom(none(2))).toBe('none')
    expect(adsRunningFrom(none(7))).toBe('none')
    expect(adsRunningFrom(none(8))).toBe('unknown')
    expect(adsRunningFrom(none(30))).toBe('unknown')
    expect(adsRunningFrom(none(null))).toBe('unknown')
  })
  it('有在跑 → running；读不到/没权限 → unknown', () => {
    expect(adsRunningFrom(mk({}))).toBe('running')
    expect(adsRunningFrom(null)).toBe('unknown')
    expect(adsRunningFrom({ ok: false, reason: 'x' })).toBe('unknown')
  })
})
