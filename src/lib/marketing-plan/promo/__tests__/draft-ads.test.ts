import { describe, it, expect } from 'vitest'
import { checkAdsBudget } from '../budget-caps'
import { draftAdsStep } from '../draft-ads'
import type { AdsDraftFacts, DailySpendFact, AudiencePoolItem } from '../draft-ads'

/** 造一个虚构的基准夹具 */
function baseFacts(): AdsDraftFacts {
  return {
    today: '2024-06-30',
    headroom: {
      ok: true,
      headroom_minor: 100000,
      delivering_minor: 20000,
      cap_minor: 200000,
      currency: 'CNY',
      as_of: '2024-06-30T00:00:00Z',
    },
    account_delivering_minor: 20000,
    account_cap_minor: 200000,
    committed_minor: 0,
    daily: [],
    insights_as_of: '2024-06-30T00:00:00Z',
    audiences: [],
    audiences_complete: true,
    approved_creatives: [],
    budget_share_of_headroom: 0.5,
    min_audience_size: 1000,
    max_creatives: 3,
  }
}

/** 造一批逐日数据 */
function makeDaily(days: number, spend: number, results: number, status: number | null): DailySpendFact[] {
  const out: DailySpendFact[] = []
  for (let i = 1; i <= days; i++) {
    const d = new Date(Date.UTC(2024, 5, 30))
    d.setUTCDate(d.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    out.push({ date: iso, spend_cents: spend, results, account_status: status })
  }
  return out
}

describe('draftAdsStep 日预算', () => {
  it('headroom.ok=false 时预算 ok:false 且 why_empty 含「读不全」', () => {
    const f = baseFacts()
    f.headroom = { ok: false, reason: '快照缺失' }
    const draft = draftAdsStep(f)
    expect(draft.daily_budget_cents.ok).toBe(false)
    if (draft.daily_budget_cents.ok === false) {
      expect(draft.daily_budget_cents.why_empty).toContain('读不全')
    }
  })

  it('任意情形下预算建议 ≤ headroom_minor − committed_minor', () => {
    for (let i = 0; i < 200; i++) {
      const f = baseFacts()
      const headroom = 1000 + i * 137
      const committed = i * 3
      f.headroom = {
        ok: true,
        headroom_minor: headroom,
        delivering_minor: 0,
        cap_minor: headroom * 2,
        currency: 'CNY',
        as_of: null,
      }
      f.account_cap_minor = null
      f.account_delivering_minor = null
      f.committed_minor = committed
      f.budget_share_of_headroom = 0.5
      const draft = draftAdsStep(f)
      if (draft.daily_budget_cents.ok === true) {
        expect(draft.daily_budget_cents.value).toBeLessThanOrEqual(headroom - committed)
      }
    }
  })

  it('账户上限更紧时取账户口径，committed_minor 被先扣掉', () => {
    const f = baseFacts()
    f.headroom = {
      ok: true,
      headroom_minor: 100000,
      delivering_minor: 0,
      cap_minor: 200000,
      currency: 'CNY',
      as_of: null,
    }
    f.account_cap_minor = 50000
    f.account_delivering_minor = 40000
    f.committed_minor = 5000
    f.budget_share_of_headroom = 1
    const draft = draftAdsStep(f)
    // base = min(100000 - 5000, 50000 - 40000 - 5000) = min(95000, 5000) = 5000
    expect(draft.daily_budget_cents.ok).toBe(true)
    if (draft.daily_budget_cents.ok === true) {
      expect(draft.daily_budget_cents.value).toBe(5000)
    }
  })

  it('7 天结果数 < 20 时 basis 里有「样本不足」且不用它换算', () => {
    const f = baseFacts()
    f.daily = makeDaily(7, 1000, 2, 1)
    const draft = draftAdsStep(f)
    expect(draft.daily_budget_cents.ok).toBe(true)
    if (draft.daily_budget_cents.ok === true) {
      const labels = draft.daily_budget_cents.basis.map((b) => b.value).join('|')
      expect(labels).toContain('样本不足')
    }
  })

  it('daily 里有 account_status=3 的日子和暴冲日时 warnings 写明剔了哪几天', () => {
    const f = baseFacts()
    const rows: DailySpendFact[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.UTC(2024, 5, 30))
      d.setUTCDate(d.getUTCDate() - i)
      const iso = d.toISOString().slice(0, 10)
      rows.push({ date: iso, spend_cents: 1000, results: 5, account_status: 1 })
    }
    // 一天状态异常
    rows[0].account_status = 3
    // 一天暴冲
    rows[1].spend_cents = 100000
    f.daily = rows
    const draft = draftAdsStep(f)
    const joined = draft.warnings.join('|')
    expect(joined).toContain(rows[0].date)
    expect(joined).toContain(rows[1].date)
  })

  it('近 7 天最高真实花费 ≥ 上限 95% 时建议值是未压低时的一半且有「已经压低」warning', () => {
    const f = baseFacts()
    f.headroom = {
      ok: true,
      headroom_minor: 100000,
      delivering_minor: 0,
      cap_minor: 100000,
      currency: 'CNY',
      as_of: null,
    }
    f.account_cap_minor = null
    f.account_delivering_minor = null
    f.committed_minor = 0
    f.budget_share_of_headroom = 0.5
    f.daily = makeDaily(7, 96000, 5, 1)
    const draft = draftAdsStep(f)
    expect(draft.daily_budget_cents.ok).toBe(true)
    if (draft.daily_budget_cents.ok === true) {
      // 未压低 = floor(100000 * 0.5) = 50000；压低 = floor(50000 / 2) = 25000
      expect(draft.daily_budget_cents.value).toBe(25000)
    }
    expect(draft.warnings.join('|')).toContain('已经压低')
  })

  it('daily=null 时仍给预算建议但有「读不到逐日花费」warning，basis 里有「没法换算」', () => {
    const f = baseFacts()
    f.daily = null
    const draft = draftAdsStep(f)
    expect(draft.daily_budget_cents.ok).toBe(true)
    expect(draft.warnings.join('|')).toContain('读不到逐日花费')
    if (draft.daily_budget_cents.ok === true) {
      const joined = draft.daily_budget_cents.basis.map((b) => b.value).join('|')
      expect(joined).toContain('没法换算')
    }
  })
})

describe('draftAdsStep 受众', () => {
  it('audiences=null 时 why_empty 是「读不到这个客户的受众池」', () => {
    const f = baseFacts()
    f.audiences = null
    const draft = draftAdsStep(f)
    expect(draft.audience_ref.ok).toBe(false)
    if (draft.audience_ref.ok === false) {
      expect(draft.audience_ref.why_empty).toBe('读不到这个客户的受众池')
    }
  })

  it('空数组且 complete=true 时 why_empty 是「还没有可用的受众池」', () => {
    const f = baseFacts()
    f.audiences = []
    f.audiences_complete = true
    const draft = draftAdsStep(f)
    expect(draft.audience_ref.ok).toBe(false)
    if (draft.audience_ref.ok === false) {
      expect(draft.audience_ref.why_empty).toBe('这个客户名下还没有可用的受众池')
    }
  })

  it('空数组且 complete=false 时 why_empty 是「没读全」', () => {
    const f = baseFacts()
    f.audiences = []
    f.audiences_complete = false
    const draft = draftAdsStep(f)
    expect(draft.audience_ref.ok).toBe(false)
    if (draft.audience_ref.ok === false) {
      expect(draft.audience_ref.why_empty).toBe('受众快照没读全，不能判断是真没有受众还是没读到')
    }
  })

  it('全小于门槛时 why_empty 是「没有人数读得到且达到门槛」', () => {
    const f = baseFacts()
    const items: AudiencePoolItem[] = [
      { ref: 'a', name: 'A', size_lower: 10, last_used_on: null, as_of: null },
      { ref: 'b', name: 'B', size_lower: 20, last_used_on: null, as_of: null },
    ]
    f.audiences = items
    f.min_audience_size = 1000
    const draft = draftAdsStep(f)
    expect(draft.audience_ref.ok).toBe(false)
    if (draft.audience_ref.ok === false) {
      expect(draft.audience_ref.why_empty).toBe('受众池里没有人数读得到且达到门槛的受众')
    }
  })

  it('选中时取最近用过的', () => {
    const f = baseFacts()
    const items: AudiencePoolItem[] = [
      { ref: 'old', name: 'Old', size_lower: 5000, last_used_on: '2024-01-01', as_of: null },
      { ref: 'new', name: 'New', size_lower: 5000, last_used_on: '2024-06-01', as_of: null },
      { ref: 'never', name: 'Never', size_lower: 5000, last_used_on: null, as_of: null },
    ]
    f.audiences = items
    f.min_audience_size = 1000
    const draft = draftAdsStep(f)
    expect(draft.audience_ref.ok).toBe(true)
    if (draft.audience_ref.ok === true) {
      expect(draft.audience_ref.value).toBe('new')
    }
  })
})

describe('draftAdsStep 素材', () => {
  it('approved_creatives=null 时 why_empty 是「读不到素材池」', () => {
    const f = baseFacts()
    f.approved_creatives = null
    const draft = draftAdsStep(f)
    expect(draft.creative_refs.ok).toBe(false)
    if (draft.creative_refs.ok === false) {
      expect(draft.creative_refs.why_empty).toBe('读不到素材池')
    }
  })

  it('空数组时 why_empty 是「还没有已批准的素材」', () => {
    const f = baseFacts()
    f.approved_creatives = []
    const draft = draftAdsStep(f)
    expect(draft.creative_refs.ok).toBe(false)
    if (draft.creative_refs.ok === false) {
      expect(draft.creative_refs.why_empty).toBe('素材池里还没有已批准的素材')
    }
  })

  it('正常取前 N 个', () => {
    const f = baseFacts()
    f.approved_creatives = ['c1', 'c2', 'c3', 'c4', 'c5']
    f.max_creatives = 3
    const draft = draftAdsStep(f)
    expect(draft.creative_refs.ok).toBe(true)
    if (draft.creative_refs.ok === true) {
      expect(draft.creative_refs.value).toEqual(['c1', 'c2', 'c3'])
    }
  })

  it('公司确认预订只作为人工参考展示，不按原始笔数重排素材', () => {
    const f = baseFacts()
    f.approved_creatives = ['wo-lower-count', 'wo-higher-count']
    f.max_creatives = 1
    f.creative_outcome_reference = {
      status: 'complete',
      window_start: '2026-10-16',
      window_end: '2026-10-22',
      bookings_by_creative_ref: { 'wo-lower-count': 1, 'wo-higher-count': 3 },
      note: '未校正花费、平台结果或频次，不能比较素材效率/优劣。',
    }
    const draft = draftAdsStep(f)
    expect(draft.creative_refs.ok).toBe(true)
    if (draft.creative_refs.ok) {
      expect(draft.creative_refs.value).toEqual(['wo-lower-count'])
      const reference = draft.creative_refs.basis.find(item => item.label === '公司确认预订（人工参考）')
      expect(reference?.value).toContain('wo-lower-count：1 笔')
      expect(reference?.value).toContain('wo-higher-count：3 笔')
      expect(reference?.value).toContain('原素材库顺序保持不变')
      expect(reference?.value).toContain('不能比较素材效率/优劣')
    }
  })

  it('部分覆盖明确不把未映射素材当零，且保持原顺序', () => {
    const f = baseFacts()
    f.approved_creatives = ['wo-known', 'wo-unmapped']
    f.creative_outcome_reference = {
      status: 'partial',
      window_start: '2026-10-16',
      window_end: '2026-10-22',
      bookings_by_creative_ref: { 'wo-known': 2 },
      note: '映射覆盖不完整，未匹配素材不是零；保持原排序。',
    }
    const draft = draftAdsStep(f)
    expect(draft.creative_refs.ok).toBe(true)
    if (draft.creative_refs.ok) {
      expect(draft.creative_refs.value).toEqual(['wo-known', 'wo-unmapped'])
      expect(draft.creative_refs.basis.find(item => item.label === '公司确认预订（人工参考）')?.value).toContain('未匹配素材不是零')
    }
  })
})

describe('draftAdsStep 通用约束', () => {
  it('任何情况 warnings 都含「月预算」那句', () => {
    const f = baseFacts()
    const draft = draftAdsStep(f)
    expect(draft.warnings.join('|')).toContain('月预算')
  })

  it('预算文案里不含「建议加」「建议开投」', () => {
    const f = baseFacts()
    f.daily = makeDaily(7, 1000, 5, 1)
    const draft = draftAdsStep(f)
    const text = JSON.stringify(draft.daily_budget_cents)
    expect(text).not.toContain('建议加')
    expect(text).not.toContain('建议开投')
  })

  it('判别联合：ok:false 的结果没有 value 字段', () => {
    const f = baseFacts()
    f.headroom = { ok: false, reason: 'x' }
    const draft = draftAdsStep(f)
    expect('value' in draft.daily_budget_cents).toBe(false)
  })
})

describe('窗口按真实日历切分（跨月）', () => {
  it('today 在月初时，上个月末的日子仍落在 7 天窗口里', () => {
    const f = baseFacts()
    f.today = '2026-11-03'
    f.daily = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
      .map(date => ({ date, spend_cents: 1000, results: 5, account_status: 1 }))
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(true)
    if (r.daily_budget_cents.ok) {
      const text = r.daily_budget_cents.basis.map(b => `${b.label}:${b.value}`).join('|')
      // 7 天共 35 条结果，应能算出单条成本而不是「样本不足」
      expect(text).toContain('单条成本（7 天）:200')
    }
  })
})

describe('固定提醒不依赖预算建议是否给出', () => {
  it('预算读不全（ok:false）时也要带月预算提醒', () => {
    const f = baseFacts()
    f.headroom = { ok: false, reason: '没读到快照' }
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(false)
    expect(r.warnings.join('')).toContain('月预算')
  })
})

describe('账户上限更紧 / 账户已停投', () => {
  it('账户余量比客户余量更紧时，建议按账户余量算，并在依据里写明', () => {
    const f = baseFacts()
    f.headroom = { ok: true, headroom_minor: 10000, delivering_minor: 5000, cap_minor: 15000, currency: 'NZD', as_of: null }
    f.account_cap_minor = 5200
    f.account_delivering_minor = 5000
    f.committed_minor = 0
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(true)
    if (r.daily_budget_cents.ok) {
      expect(r.daily_budget_cents.value).toBeLessThanOrEqual(200)
      expect(r.daily_budget_cents.basis.some(b => b.label === '账户日上限')).toBe(true)
    }
  })
  it('最近 7 天没有任何结果 → 提醒可能已停投，成本仅供参考', () => {
    const f = baseFacts()
    f.today = '2026-11-20'
    f.daily = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']
      .map(date => ({ date, spend_cents: 1000, results: 5, account_status: 1 }))
    const r = draftAdsStep(f)
    expect(r.warnings.join('')).toContain('可能已停投')
  })
})

describe('账户状态', () => {
  it('账户不是可投放状态 → 提醒批准前检查会亮红', () => {
    const f = baseFacts()
    f.account_status = 3
    expect(draftAdsStep(f).warnings.join('')).toContain('不是可投放状态')
  })
  it('账户状态正常或读不到 → 不加这条提醒', () => {
    const f = baseFacts()
    f.account_status = 1
    expect(draftAdsStep(f).warnings.join('')).not.toContain('不是可投放状态')
    f.account_status = null
    expect(draftAdsStep(f).warnings.join('')).not.toContain('不是可投放状态')
  })
})

describe('客户总上限按「同阶段全账户」扣，账户上限按「同账户」扣', () => {
  it('别的账户的占用只扣客户余量，不扣本账户余量', () => {
    const f = baseFacts()
    f.headroom = { ok: true, headroom_minor: 10000, delivering_minor: 0, cap_minor: 10000, currency: 'NZD', as_of: null }
    f.account_cap_minor = 10000
    f.account_delivering_minor = 0
    f.committed_minor = 0
    f.committed_all_minor = 8000
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(true)
    if (r.daily_budget_cents.ok) expect(r.daily_budget_cents.value).toBeLessThanOrEqual(1000) // 余量 2000 × 0.5
  })
  it('采纳后合计不超客户总上限（往返：用 checkAdsBudget 核对）', () => {
    const f = baseFacts()
    f.headroom = { ok: true, headroom_minor: 10000, delivering_minor: 0, cap_minor: 10000, currency: 'NZD', as_of: null }
    f.committed_minor = 0
    f.committed_all_minor = 8000
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(true)
    if (r.daily_budget_cents.ok) {
      const verdict = checkAdsBudget(
        [
          { id: 'a', kind: 'ads_campaign', settings: { ad_account_id: 'act_b', daily_budget_cents: 8000, audience_ref: 'x', creative_refs: [], placements: [], paused_ranges: [] } },
          { id: 'b', kind: 'ads_campaign', settings: { ad_account_id: 'act_a', daily_budget_cents: r.daily_budget_cents.value, audience_ref: 'x', creative_refs: [], placements: [], paused_ranges: [] } },
        ],
        [{ ad_account_id: 'act_a', currency: 'NZD', daily_cap_cents: null, owned_by_client: true }, { ad_account_id: 'act_b', currency: 'NZD', daily_cap_cents: null, owned_by_client: true }],
        10000,
      )
      expect(verdict.verdict).not.toBe('over')
    }
  })
  it('贴近上限减半后若变成 0，不给 0，直接留空', () => {
    const f = baseFacts()
    f.headroom = { ok: true, headroom_minor: 1, delivering_minor: 0, cap_minor: 10, currency: 'NZD', as_of: null }
    f.budget_share_of_headroom = 1
    f.daily = ['2026-11-05', '2026-11-06'].map(date => ({ date, spend_cents: 10, results: 1, account_status: 1 }))
    f.today = '2026-11-10'
    const r = draftAdsStep(f)
    expect(r.daily_budget_cents.ok).toBe(false)
  })
})
