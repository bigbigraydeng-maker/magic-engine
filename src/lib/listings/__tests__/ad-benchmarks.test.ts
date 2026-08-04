/**
 * 「把实测摆到人眼前，但不许机器拿三条数据自作主张」的三条纪律。
 *
 * 这一批测试对应 2026-08-01 的一次真实判断错误：有人拿「英文学区版每次对话
 * $27.83，全场最贵」去质疑 AI 的卖点排序，那个数字背后是 **1 次对话**。
 * 所以下面三组分别钉死：
 *   ① 实测数据不许改 angle_ranking / buyer_segments
 *   ② 任何成本数必须跟样本量同框，样本为 0 时只说「没有数据」
 *   ③ 够不够格叫「规律」由 pattern-promotion.ts 的 6 套阈值判，本模块不另立一个数
 *
 * 数字取自 Roman HU 账户 2026-07-27~30 的真实投放(ad_daily_insights)。
 */

import { describe, expect, it } from 'vitest'
import {
  applyAdReferenceToDraft,
  benchmarkConfidenceLabel,
  buildAdReference,
  buildGroup,
  formatCostWithSample,
  formatSpendWithSample,
  summariseInsights,
  type AdInsightRow,
  type BuildGroupInput,
} from '../ad-benchmarks'
import { PATTERN_MIN_CONFIRMED_LISTINGS } from '../pattern-promotion'
import { normalizeAiDraft } from '../brief-schema'

// ── 素材 ──────────────────────────────────────────────────────────────────────

/** Ad A · Rangitoto zone hook：$27.83 / 1 次对话 —— 就是被误当成证据的那一条。 */
const AD_A: AdInsightRow[] = [
  { entity_id: 'ad_a', insight_date: '2026-07-28', spend: '20.00', impressions: '800', clicks: '25', leads: 0, messaging_conversations: 1 },
  { entity_id: 'ad_a', insight_date: '2026-07-29', spend: '7.83', impressions: '353', clicks: '10', leads: 0, messaging_conversations: 0 },
]

/** 整个账户 4 天：$153.93 / 10 次对话 / 10 条广告。 */
const ACCOUNT: AdInsightRow[] = [
  ...AD_A,
  { entity_id: 'ad_d', insight_date: '2026-07-28', spend: '47.16', impressions: '1942', clicks: '152', leads: 0, messaging_conversations: 4 },
  { entity_id: 'ad_f', insight_date: '2026-07-30', spend: '21.89', impressions: '943', clicks: '35', leads: 0, messaging_conversations: 3 },
  { entity_id: 'ad_e', insight_date: '2026-07-30', spend: '57.05', impressions: '2724', clicks: '106', leads: 2, messaging_conversations: 0 },
]

function group(over: Partial<BuildGroupInput> = {}) {
  return buildGroup({
    scope: 'this_client',
    rows: ACCOUNT,
    listings: 1,
    clients: 1,
    listingsInAccounts: 1,
    ...over,
  })
}

function reference(over: Partial<Parameters<typeof buildAdReference>[0]> = {}) {
  return buildAdReference({
    similarity: { price_band: '1m_1_5m', suburb: 'Rothesay Bay', property_type: 'house' },
    own: { scope: 'this_client', rows: ACCOUNT, listings: 1, clients: 1, listingsInAccounts: 2 },
    peers: null,
    evidence: { confirmedListings: 0, distinctClients: 0, consecutiveReversals: 0 },
    now: new Date('2026-08-01T00:00:00Z'),
    ...over,
  })
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────

describe('汇总实测', () => {
  it('花费 / 对话 / 广告条数 / 天数都数得对', () => {
    const t = summariseInsights(ACCOUNT)
    expect(t.spend).toBeCloseTo(153.93, 2)
    expect(t.conversations).toBe(10)   // 8 次私信 + 2 个表单 lead
    expect(t.ads).toBe(4)
    expect(t.days).toBe(3)
  })

  it('numeric 从库里回来是字符串，也要能加', () => {
    expect(summariseInsights(AD_A).spend).toBeCloseTo(27.83, 2)
  })

  it('空数组 = 全 0，不炸', () => {
    expect(summariseInsights([])).toEqual({ spend: 0, conversations: 0, impressions: 0, clicks: 0, ads: 0, days: 0 })
  })

  it('表单 lead 和私信对话都算「有人举手」', () => {
    const rows: AdInsightRow[] = [
      { entity_id: 'x', insight_date: '2026-07-01', spend: 10, impressions: 1, clicks: 1, leads: 3, messaging_conversations: 2 },
    ]
    expect(summariseInsights(rows).conversations).toBe(5)
  })
})

describe('一组实测', () => {
  it('每次对话多少钱 = 花费 ÷ 对话数', () => {
    expect(group()?.cost_per_conversation).toBeCloseTo(15.39, 2)
  })

  it('没花过钱也没对话 → 返回 null，不返回一组 0', () => {
    // 一组全 0 摆在页面上，人会读成「投了但没效果」，而事实是根本没投过。
    expect(group({ rows: [] })).toBeNull()
  })

  it('花了钱但一次对话都没有 → 每次对话多少钱是 null，不是 0', () => {
    const rows: AdInsightRow[] = [
      { entity_id: 'x', insight_date: '2026-07-01', spend: 50, impressions: 100, clicks: 2, leads: 0, messaging_conversations: 0 },
    ]
    const g = group({ rows })
    expect(g?.spend).toBe(50)
    expect(g?.cost_per_conversation).toBeNull()
  })

  it('账户里还挂着别的房源 → 标出「拆不开」', () => {
    expect(group({ listings: 1, listingsInAccounts: 2 })?.mixed_with_other_listings).toBe(true)
    expect(group({ listings: 1, listingsInAccounts: 1 })?.mixed_with_other_listings).toBe(false)
  })

  it('粒度只有「客户账户」一档 —— 广告跟单套房之间没有结构化对应关系', () => {
    expect(group()?.granularity).toBe('client_account')
  })
})

// ── 纪律 ②：数字必须跟样本量同框 ─────────────────────────────────────────────

describe('纪律②：成本数必须跟样本量同框', () => {
  it('每次对话多少钱后面永远缝着「基于 N 次对话」', () => {
    const g = buildGroup({ scope: 'this_client', rows: AD_A, listings: 1, clients: 1, listingsInAccounts: 1 })
    const text = formatCostWithSample(g)
    expect(text).toContain('$27.83')
    expect(text).toContain('基于 1 次对话')   // 🔴 去掉样本量这条就红
  })

  it('$27.83 那条正是被误当成证据的数 —— 它必须自带「1 次对话」这个刺眼的分母', () => {
    expect(formatCostWithSample(
      buildGroup({ scope: 'this_client', rows: AD_A, listings: 1, clients: 1, listingsInAccounts: 1 }),
    )).toBe('$27.83 · 基于 1 次对话')
  })

  it('样本量为 0 → 明说没有数据，绝不吐一个孤零零的成本数', () => {
    const rows: AdInsightRow[] = [
      { entity_id: 'x', insight_date: '2026-07-01', spend: 50, impressions: 10, clicks: 1, leads: 0, messaging_conversations: 0 },
    ]
    const text = formatCostWithSample(group({ rows }))
    expect(text).toContain('没有数据')
    expect(text).not.toContain('$')
  })

  it('没有这一组 → 没有数据', () => {
    expect(formatCostWithSample(null)).toBe('没有数据')
  })

  it('花费也带样本量（几条广告 / 几天）', () => {
    const text = formatSpendWithSample(group())
    expect(text).toContain('$153.93')
    expect(text).toContain('4 条广告')
    expect(text).toContain('3 天')
  })
})

// ── 纪律 ③：6 套阈值只有一个来源 ─────────────────────────────────────────────

describe('纪律③：攒够 6 套同类才叫规律', () => {
  it('阈值就是 pattern-promotion.ts 那一个数，本模块不另写', () => {
    expect(reference().pattern.min_listings).toBe(PATTERN_MIN_CONFIRMED_LISTINGS)
    expect(PATTERN_MIN_CONFIRMED_LISTINGS).toBe(6)
  })

  it('5 套 → 仍然只是「单轮观察，样本不足」', () => {
    // 🔴 把阈值从 6 改成 1，这条就红。
    const p = reference({ evidence: { confirmedListings: 5, distinctClients: 2, consecutiveReversals: 0 } }).pattern
    expect(p.tier).toBe('unverified')
    expect(benchmarkConfidenceLabel(p)).toContain('单轮观察，样本不足')
    expect(benchmarkConfidenceLabel(p)).toContain('攒够 6 套')
  })

  it('1 套 → 一样是单轮观察（$27.83 那次误判的本体）', () => {
    const p = reference({ evidence: { confirmedListings: 1, distinctClients: 1, consecutiveReversals: 0 } }).pattern
    expect(benchmarkConfidenceLabel(p)).toContain('单轮观察，样本不足')
  })

  it('6 套 + 2 个客户 → 才升格成可参考的规律', () => {
    const p = reference({ evidence: { confirmedListings: 6, distinctClients: 2, consecutiveReversals: 0 } }).pattern
    expect(p.tier).toBe('general_pattern')
    expect(benchmarkConfidenceLabel(p)).toContain('可以当规律参考')
    expect(benchmarkConfidenceLabel(p)).not.toContain('样本不足')
  })

  it('6 套但全来自同一个客户 → 只当这个客户的规律', () => {
    const p = reference({ evidence: { confirmedListings: 6, distinctClients: 1, consecutiveReversals: 0 } }).pattern
    expect(p.tier).toBe('client_pattern')
    expect(benchmarkConfidenceLabel(p)).toContain('只当这个客户的规律')
  })

  it('连续 3 套打脸 → 哪怕 20 套也打回待验证，并说清是被打回的', () => {
    const p = reference({ evidence: { confirmedListings: 20, distinctClients: 5, consecutiveReversals: 3 } }).pattern
    expect(p.tier).toBe('unverified')
    expect(p.demoted).toBe(true)
    expect(benchmarkConfidenceLabel(p)).toContain('跟当初判断相反')
  })
})

// ── 整块 ──────────────────────────────────────────────────────────────────────

describe('整块参考数据', () => {
  it('三个维度齐全 → 同类判得了', () => {
    expect(reference().similarity.resolvable).toBe(true)
  })

  it('房型没填 → 同类判不了，说出来而不是拿两个维度凑', () => {
    const b = reference({
      similarity: { price_band: '1m_1_5m', suburb: 'Rothesay Bay', property_type: null },
      peers: { scope: 'similar_listings', rows: ACCOUNT, listings: 3, clients: 2, listingsInAccounts: 3 },
    })
    expect(b.similarity.resolvable).toBe(false)
    expect(b.peers).toBeNull()
    expect(b.limitations.join('\n')).toContain('判不了')
  })

  it('限制里永远写着「不是按卖点角度拆的」', () => {
    expect(reference().limitations.join('\n')).toContain('不是按卖点角度拆开的')
  })

  it('账户里混着别的房源 → 限制里明说拆不开', () => {
    expect(reference().limitations.join('\n')).toContain('拆不开')
  })

  it('一点数据都没有 → 明说「不是投了没效果」', () => {
    const b = reference({ own: { scope: 'this_client', rows: [], listings: 1, clients: 1, listingsInAccounts: 1 } })
    expect(b.own).toBeNull()
    expect(b.limitations.join('\n')).toContain('不是「投了没效果」')
  })
})

// ── 纪律 ①：实测数据不许改判断 ───────────────────────────────────────────────

describe('纪律①：实测数据只显示，绝不改排序', () => {
  const draft = normalizeAiDraft({
    buyer_segments: ['wfh_family', 'first_home'],
    angle_ranking: [
      { angle: 'school_zone', rank: 1, rationale: '学区是这套房的本质卖点' },
      { angle: 'move_in_ready', rank: 2, rationale: '即可入住' },
      { angle: 'price_flexible', rank: 3, rationale: '价格可谈' },
    ],
    hesitations: ['market_falling'],
    unit_variants: [],
    market_snapshot: {},
    facts: {},
    gaps: [],
    sources: [],
  })
  if (!draft.ok) throw new Error(draft.error)
  const content = draft.value

  it('挂上参考数据后，卖点排序一个字都没动', () => {
    // 这份参考数据「说」学区最贵 —— 恰恰是当初误导人的那个信号。
    const out = applyAdReferenceToDraft(content, reference())
    expect(out.content.angle_ranking).toEqual(content.angle_ranking)
    expect(out.content.angle_ranking[0].angle).toBe('school_zone')   // 🔴 在这里重排就红
  })

  it('买家类型也没动', () => {
    const out = applyAdReferenceToDraft(content, reference())
    expect(out.content.buyer_segments).toEqual(['wfh_family', 'first_home'])
  })

  it('参考数据原样挂在旁边，是单独一栏', () => {
    const ref = reference()
    const out = applyAdReferenceToDraft(content, ref)
    expect(out.ad_reference).toBe(ref)
    expect(out.content).not.toHaveProperty('ad_reference')
  })

  it('没有参考数据时也不动内容', () => {
    const out = applyAdReferenceToDraft(content, null)
    expect(out.content).toEqual(content)
    expect(out.ad_reference).toBeNull()
  })

  it('AI 自己吐一份 ad_reference 也进不来 —— 这一栏只能由系统算', () => {
    const sneaky = normalizeAiDraft({
      buyer_segments: ['investor'],
      angle_ranking: [{ angle: 'yield', rank: 1, rationale: '按我们的投放数据，收益率这条最便宜' }],
      hesitations: [],
      unit_variants: [],
      market_snapshot: {},
      facts: {},
      gaps: [],
      sources: [],
      ad_reference: { own: { cost_per_conversation: 1 } },
    })
    expect(sneaky.ok).toBe(true)
    if (sneaky.ok) expect(sneaky.value).not.toHaveProperty('ad_reference')
  })
})
