/**
 * 房子档案的形状校验测试。
 *
 * 两组用例是**变异测试的靶子**,改动 brief-schema.ts 时请拿它们验一遍:
 *
 *   变异 ①「枚举校验永远放行」——把 enumArray 里的 guard 换成 () => true、
 *          或把 isListingAngle / isBuyerSegment 改成永远 true:
 *          下面每一条带「🔴 枚举」标记的用例都必须变红。
 *          放行的后果不是报错,是**跨房子聚合悄悄失效** —— 20 套房里 3 套用了
 *          近义词,「投资客贵不贵」的分母就错了,而且错得没有任何提示。
 *
 *   变异 ②「数字不用带出处」——把 sourcedNumber 里那句 requiredText(source) 去掉:
 *          带「🔴 出处」标记的用例必须变红。ME 为编数字出过两次事故,
 *          而地产的中位价是中介会拿去跟卖家谈的数。
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeAiDraft,
  normalizeAngleRanking,
  normalizeMarketSnapshot,
  normalizeSources,
  normalizeUnitVariants,
  validateBriefPatch,
} from '../brief-schema'
import { BUYER_SEGMENTS, LISTING_ANGLES, LISTING_HESITATIONS } from '../brief-constants'

describe('normalizeAiDraft —— 整体', () => {
  it('空对象也是合法的:什么都没查到 = 全部为空,不是错误', () => {
    const r = normalizeAiDraft({})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.buyer_segments).toEqual([])
    expect(r.value.gaps).toEqual([])
    expect(r.value.market_snapshot.median_price).toBeNull()
  })

  it('不是对象 → 拒绝', () => {
    expect(normalizeAiDraft(null).ok).toBe(false)
    expect(normalizeAiDraft('{}').ok).toBe(false)
    expect(normalizeAiDraft([]).ok).toBe(false)
  })

  it('一份完整的合法 draft 能原样过', () => {
    const r = normalizeAiDraft({
      buyer_segments: ['first_home', 'investor'],
      angle_ranking: [{ angle: 'yield', rank: 1, rationale: '租金回报是这套房最硬的点' }],
      hesitations: ['market_falling'],
      unit_variants: [
        { label: 'Unit 5', size_sqm: 139.7, config: '3 房 + 书房', target_segments: ['upsizer'] },
      ],
      market_snapshot: { median_price: { value: 950000, source: 'https://example.com/a' } },
      facts: { price_method: '议价', nearby: ['步行 8 分钟到火车站'] },
      gaps: ['这个区的平均租金回报没查到'],
      sources: [{ field: 'market_snapshot.median_price', kind: 'cited', url: 'https://example.com/a' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.unit_variants[0].size_sqm).toBe(139.7)
    expect(r.value.facts.price_method).toBe('议价')
  })
})

describe('🔴 枚举:非法取值必须整份拒绝(不是静默丢弃)', () => {
  it('buyer_segments 里混进一个模型自创的词 → 拒绝', () => {
    const r = normalizeAiDraft({ buyer_segments: ['first_home', 'retiree_downsizer'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('retiree_downsizer')
  })

  it('hesitations 里混进自创词 → 拒绝', () => {
    const r = normalizeAiDraft({ hesitations: ['market_falling', 'too_expensive'] })
    expect(r.ok).toBe(false)
  })

  it('angle_ranking 的 angle 自创 → 拒绝', () => {
    const r = normalizeAngleRanking([{ angle: 'renovation_potential', rank: 1 }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('renovation_potential')
  })

  it('unit_variants 里的 target_segments 自创 → 拒绝', () => {
    const r = normalizeUnitVariants([
      { label: 'Unit 3', target_segments: ['first_home', 'nobody'] },
    ])
    expect(r.ok).toBe(false)
  })

  it('sources 的 kind 自创 → 拒绝', () => {
    const r = normalizeSources([{ field: 'facts.school_zone', kind: 'guessed' }])
    expect(r.ok).toBe(false)
  })

  it('人手改(PATCH)走同一批 guard —— 后端不能比 AI 那条路松', () => {
    expect(validateBriefPatch({ buyer_segments: ['made_up'] }).ok).toBe(false)
    expect(validateBriefPatch({ hesitations: ['made_up'] }).ok).toBe(false)
    expect(validateBriefPatch({ angle_ranking: [{ angle: 'made_up', rank: 1 }] }).ok).toBe(false)
    expect(validateBriefPatch({ verdict: 'maybe' }).ok).toBe(false)
    expect(validateBriefPatch({ outcomes: { winning_angle: 'made_up' } }).ok).toBe(false)
    expect(validateBriefPatch({ outcomes: { actual_segments: ['made_up'] } }).ok).toBe(false)
  })

  it('全部合法取值都必须能过(枚举收窄了要立刻发现)', () => {
    expect(normalizeAiDraft({ buyer_segments: [...BUYER_SEGMENTS] }).ok).toBe(true)
    expect(normalizeAiDraft({ hesitations: [...LISTING_HESITATIONS] }).ok).toBe(true)
    const ranked = LISTING_ANGLES.map((angle, i) => ({ angle, rank: i + 1 }))
    expect(normalizeAngleRanking(ranked).ok).toBe(true)
  })
})

describe('🔴 出处:数字没有来源一律不许进库', () => {
  it('median_price 有数没 source → 拒绝,并且提示要写进 gaps', () => {
    const r = normalizeMarketSnapshot({ median_price: { value: 950000 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('gaps')
  })

  it('source 是空字符串也算没有出处', () => {
    expect(normalizeMarketSnapshot({ rental_yield: { value: 4.1, source: '   ' } }).ok).toBe(false)
  })

  it('四个指标每一个都受同一条约束', () => {
    for (const key of ['median_price', 'yoy_change_pct', 'rental_yield', 'area_avg_yield']) {
      expect(normalizeMarketSnapshot({ [key]: { value: 1 } }).ok).toBe(false)
    }
  })

  it('没有数字就不需要出处(空着是正当答案)', () => {
    const r = normalizeMarketSnapshot({ median_price: null, rental_yield: { value: null } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.median_price).toBeNull()
    expect(r.value.rental_yield).toBeNull()
  })

  it('可比成交没出处 → 拒绝', () => {
    const r = normalizeMarketSnapshot({ comparables: [{ address: '12 Example Rd', price: 910000 }] })
    expect(r.ok).toBe(false)
  })

  it('有数有出处 → 放行', () => {
    const r = normalizeMarketSnapshot({
      median_price: { value: 950000, source: 'https://example.com/x' },
      comparables: [{ address: '12 Example Rd', price: 910000, source: 'https://example.com/y' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.median_price?.source).toBe('https://example.com/x')
    expect(r.value.comparables).toHaveLength(1)
  })

  it('标成「有出处」却不给网址 → 拒绝(这一档不能靠嘴说)', () => {
    const r = normalizeSources([{ field: 'facts.school_zone', kind: 'cited' }])
    expect(r.ok).toBe(false)
  })

  it('「AI 判断」和「缺」不需要网址', () => {
    const r = normalizeSources([
      { field: 'facts.school_zone', kind: 'inferred', note: '从周边学校推的' },
      { field: 'market_snapshot.area_avg_yield', kind: 'missing' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toHaveLength(2)
  })
})

describe('卖点排序的结构约束', () => {
  it('同一个卖点排两次 → 拒绝(「第一该打哪条」不能有两个答案)', () => {
    const r = normalizeAngleRanking([
      { angle: 'yield', rank: 1 },
      { angle: 'yield', rank: 2 },
    ])
    expect(r.ok).toBe(false)
  })

  it('rank 必须是 1 起的整数', () => {
    expect(normalizeAngleRanking([{ angle: 'yield', rank: 0 }]).ok).toBe(false)
    expect(normalizeAngleRanking([{ angle: 'yield', rank: 1.5 }]).ok).toBe(false)
    expect(normalizeAngleRanking([{ angle: 'yield' }]).ok).toBe(false)
  })

  it('返回时按 rank 排好序,前端不用再排一遍', () => {
    const r = normalizeAngleRanking([
      { angle: 'location', rank: 3 },
      { angle: 'yield', rank: 1 },
      { angle: 'design', rank: 2 },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map(x => x.angle)).toEqual(['yield', 'design', 'location'])
  })
})

describe('户型:一个页面里的多种配置必须拆得开', () => {
  it('两种配置各存一条,不会被压成一条', () => {
    const r = normalizeUnitVariants([
      { label: 'Units 3 & 11', size_sqm: 108, config: '3 房', target_segments: ['first_home'] },
      { label: 'Units 5/7/9', size_sqm: 139.7, config: '3 房 + 书房 + 内车库', target_segments: ['upsizer'] },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toHaveLength(2)
    expect(r.value[1].size_sqm).toBe(139.7)
  })

  it('没名字的户型 → 拒绝(列表里认不出是哪个)', () => {
    expect(normalizeUnitVariants([{ size_sqm: 108 }]).ok).toBe(false)
  })

  it('面积必须大于 0', () => {
    expect(normalizeUnitVariants([{ label: 'A', size_sqm: 0 }]).ok).toBe(false)
    expect(normalizeUnitVariants([{ label: 'A', size_sqm: -5 }]).ok).toBe(false)
  })
})

describe('validateBriefPatch —— 只动请求里出现过的字段', () => {
  it('空对象 → 拒绝(没有要改的东西)', () => {
    expect(validateBriefPatch({}).ok).toBe(false)
  })

  it('只发一个字段,别的字段不出现在结果里', () => {
    const r = validateBriefPatch({ gaps: ['学区还没确认'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.value)).toEqual(['gaps'])
  })

  it('回填两栏(结果 + 结论)能改', () => {
    const r = validateBriefPatch({
      outcomes: { actual_segments: ['investor'], winning_angle: 'yield', cost_per_qualified: 42.5, notes: '实际来的多是投资客' },
      verdict: 'partly',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.verdict).toBe('partly')
    expect(r.value.outcomes?.cost_per_qualified).toBe(42.5)
  })

  it('每个 lead 的成本是负数 → 拒绝', () => {
    expect(validateBriefPatch({ outcomes: { cost_per_qualified: -1 } }).ok).toBe(false)
  })

  it('人手改也不能塞没出处的数字', () => {
    expect(validateBriefPatch({ market_snapshot: { median_price: { value: 1 } } }).ok).toBe(false)
  })
})
