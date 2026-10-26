import { describe, expect, it } from 'vitest'
import { findStep, hasPromoField, nextPhaseFrom, parsePromoSpec, phaseOnDate, readPromoSpec } from '../spec'
import { baseSpec } from './fixtures'

describe('parsePromoSpec', () => {
  it('合法结构通过，并补默认值', () => {
    const res = parsePromoSpec(baseSpec())
    expect(res.ok).toBe(true)
  })

  it('缺 goal_id / 日期格式错 / 没有阶段 → 不通过', () => {
    const bad = { ...baseSpec(), goal_id: '' }
    expect(parsePromoSpec(bad).ok).toBe(false)
    const badDate = baseSpec()
    badDate.phases[0].start_date = '11/01/2026'
    expect(parsePromoSpec(badDate).ok).toBe(false)
    expect(parsePromoSpec({ ...baseSpec(), phases: [] }).ok).toBe(false)
  })

  it('阶段编号重复、步骤编号跨阶段重复 → 不通过', () => {
    const dupPhase = baseSpec()
    dupPhase.phases[1].id = 'p1'
    expect(parsePromoSpec(dupPhase).ok).toBe(false)
    const dupStep = baseSpec()
    dupStep.phases[1].steps = [{ id: 's-ads', kind: 'blog_article', settings: { topic: 't', primary_keyword: null, due_date: '2026-11-20' } }]
    const res = parsePromoSpec(dupStep)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.some(i => i.message.includes('步骤编号重复'))).toBe(true)
  })

  it('阶段日期重叠 / 结束早于开始 → 不通过', () => {
    const overlap = baseSpec()
    overlap.phases[1].start_date = '2026-11-10'
    expect(parsePromoSpec(overlap).ok).toBe(false)
    const reversed = baseSpec()
    reversed.phases[0].end_date = '2026-10-01'
    expect(parsePromoSpec(reversed).ok).toBe(false)
  })

  it('博客日期不在所属阶段内 → 不通过', () => {
    const s = baseSpec()
    s.phases[1].steps = [{ id: 'b1', kind: 'blog_article', settings: { topic: 't', primary_keyword: null, due_date: '2026-11-02' } }]
    expect(parsePromoSpec(s).ok).toBe(false)
  })

  it('人工核实记录指向不存在的阶段 → 不通过', () => {
    const s = baseSpec({ checks: [{ phase_id: 'nope', check_key: 'landing.item_live', verified_by: 'a', verified_at: '2026-10-29T00:00:00Z', note: '' }] })
    expect(parsePromoSpec(s).ok).toBe(false)
  })

  it('广告日预算必须是正整数', () => {
    const s = baseSpec()
    const ads = s.phases[0].steps[0]
    if (ads.kind === 'ads_campaign') ads.settings.daily_budget_cents = 0
    expect(parsePromoSpec(s).ok).toBe(false)
    if (ads.kind === 'ads_campaign') ads.settings.daily_budget_cents = 12.5
    expect(parsePromoSpec(s).ok).toBe(false)
  })

  it('暂停区间结束早于开始 → 不通过', () => {
    const s = baseSpec()
    const ads = s.phases[0].steps[0]
    if (ads.kind === 'ads_campaign') ads.settings.paused_ranges = [{ from: '2026-11-05', to: '2026-11-02' }]
    expect(parsePromoSpec(s).ok).toBe(false)
  })
})

describe('readPromoSpec / hasPromoField', () => {
  it('旧计划（没有 promo）→ null / false', () => {
    expect(readPromoSpec({ tasks: [] })).toBeNull()
    expect(hasPromoField({ tasks: [] })).toBe(false)
    expect(readPromoSpec(null)).toBeNull()
  })
  it('畸形 promo → readPromoSpec 返回 null（按未批准），但 hasPromoField 仍为 true', () => {
    expect(readPromoSpec({ promo: { schema: 'promo_v1' } })).toBeNull()
    expect(hasPromoField({ promo: { schema: 'promo_v1' } })).toBe(true)
  })
  it('合法 promo 读得出来', () => {
    expect(readPromoSpec({ promo: baseSpec() })?.goal_id).toBe('goal-1')
  })
})

describe('阶段查找', () => {
  const spec = baseSpec()
  it('phaseOnDate / nextPhaseFrom', () => {
    expect(phaseOnDate(spec, '2026-11-05')?.id).toBe('p1')
    expect(phaseOnDate(spec, '2026-10-01')).toBeNull()
    expect(nextPhaseFrom(spec, '2026-10-01')?.id).toBe('p1')
    expect(nextPhaseFrom(spec, '2026-11-20')?.id).toBe('p2')
    expect(nextPhaseFrom(spec, '2026-12-31')).toBeNull()
  })
  it('findStep', () => {
    expect(findStep(spec, 'p1', 's-ads')?.kind).toBe('ads_campaign')
    expect(findStep(spec, 'p2', 's-ads')).toBeNull()
  })
})
