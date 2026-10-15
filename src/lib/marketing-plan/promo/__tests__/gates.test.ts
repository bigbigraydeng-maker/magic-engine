import { describe, expect, it } from 'vitest'
import { blockers, firstPhase, unverified, worstLight, type GateKey } from '../gates'
import { baseSpec, evaluateApproval, evaluatePhaseGates, goodFacts } from './fixtures'
import type { PromoSpec } from '../spec'
import { promoContentHash } from '../content-hash'

const verifiedAll = (): PromoSpec => baseSpec({
  checks: (['landing.item_live', 'content.wording_permission'] as GateKey[]).map(k => ({
    phase_id: 'p1', check_key: k, verified_by: 'fde@example.com', verified_at: '2026-10-28T00:00:00Z', note: '',
  })),
})
const light = (spec: PromoSpec, f = goodFacts()) => {
  const r = evaluatePhaseGates(spec, spec.phases[0], f)
  return (k: GateKey) => r.find(x => x.key === k)?.light
}

describe('evaluatePhaseGates — 全绿路径', () => {
  it('事实齐全且人工核实后：硬门无红无灰，可批准；预算项因没纳入在投预算而是黄', () => {
    const v = evaluateApproval(verifiedAll(), goodFacts())
    expect(v.can_approve).toBe(true)
    expect(v.blockers).toEqual([])
    expect(v.unverified.map(u => u.key)).toContain('ads.budget_within_caps')
  })
})

describe('灰色 = 读不到 / 太旧 / 没核实，硬门灰色不能批准', () => {
  it('没人工核实落地页 → 灰 → 阻止批准', () => {
    const v = evaluateApproval(baseSpec(), goodFacts())
    expect(v.can_approve).toBe(false)
    expect(v.blockers.map(b => b.key)).toContain('landing.item_live')
    expect(light(baseSpec())('landing.item_live')).toBe('gray')
  })

  it('广告设置整个读失败 → 上限 / 结果口径 / 素材全灰（不是红也不是绿）', () => {
    const l = light(verifiedAll(), goodFacts({ config: null }))
    expect(l('ads.cap_set')).toBe('gray')
    expect(l('ads.result_defined')).toBe('gray')
    expect(l('ads.creative_approved')).toBe('gray')
  })

  it('账户快照太旧 → 灰，不能因为"读得到"就判绿', () => {
    const f = goodFacts({ snapshots: { act_1: { account_status: 1, captured_at: '2026-09-01T00:00:00Z' } } })
    expect(light(verifiedAll(), f)('ads.account_usable')).toBe('gray')
  })

  it('账户没有快照 → 灰', () => {
    expect(light(verifiedAll(), goodFacts({ snapshots: {} }))('ads.account_usable')).toBe('gray')
  })

  it('人工核实记录过期 → 灰', () => {
    const s = verifiedAll()
    s.checks[0].verified_at = '2026-01-01T00:00:00Z'
    expect(light(s)('landing.item_live')).toBe('gray')
  })

  it('每日计划读不出来 → 节奏项灰（软门，不阻止）', () => {
    const f = goodFacts({ daily_plan_coverage_days: null })
    expect(light(verifiedAll(), f)('social.cadence_scheduled')).toBe('gray')
    expect(evaluateApproval(verifiedAll(), f).can_approve).toBe(true)
  })
})

describe('红色 = 确定没过', () => {
  it('账户不可投放（状态码 ≠ 1）→ 红', () => {
    const f = goodFacts({ snapshots: { act_1: { account_status: 2, captured_at: '2026-10-29T00:00:00Z' } } })
    expect(light(verifiedAll(), f)('ads.account_usable')).toBe('red')
    expect(evaluateApproval(verifiedAll(), f).can_approve).toBe(false)
  })

  it('没设日预算上限 / 没定结果口径 → 红', () => {
    const f = goodFacts({ config: { daily_budget_cap_cents: null, primary_result: null, creative_pool: [{ ref: 'vid-1', status: 'approved' }] } })
    const l = light(verifiedAll(), f)
    expect(l('ads.cap_set')).toBe('red')
    expect(l('ads.result_defined')).toBe('red')
  })

  it('素材只是候选 / 不在素材池 / 没指定 → 红', () => {
    const cand = goodFacts({ config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'candidate' }] } })
    expect(light(verifiedAll(), cand)('ads.creative_approved')).toBe('red')
    const missing = goodFacts({ config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [] } })
    expect(light(verifiedAll(), missing)('ads.creative_approved')).toBe('red')
    const s = verifiedAll()
    const ads = s.phases[0].steps[0]
    if (ads.kind === 'ads_campaign') ads.settings.creative_refs = []
    expect(light(s)('ads.creative_approved')).toBe('red')
  })

  it('预算超账户上限 → 红', () => {
    const f = goodFacts({ accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 1000, owned_by_client: true }] })
    expect(light(verifiedAll(), f)('ads.budget_within_caps')).toBe('red')
  })

  it('账户不属于该客户 → 红', () => {
    const f = goodFacts({ accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: false }] })
    expect(light(verifiedAll(), f)('ads.account_usable')).toBe('red')
  })
})

describe('硬门 / 软门 身份不随证据变化', () => {
  it('花钱相关的项始终是硬门，且 evidence 只是标注', () => {
    const r = evaluatePhaseGates(verifiedAll(), verifiedAll().phases[0], goodFacts())
    const hard = new Set(r.filter(x => x.hard).map(x => x.key))
    for (const k of ['ads.account_usable', 'ads.cap_set', 'ads.result_defined', 'ads.creative_approved', 'ads.budget_within_caps', 'landing.item_live'] as GateKey[]) {
      expect(hard.has(k)).toBe(true)
    }
    expect(r.every(x => x.evidence === 'unvalidated_default')).toBe(true)
    expect(r.filter(x => !x.hard).map(x => x.key).sort()).toEqual(['content.wording_permission', 'social.cadence_scheduled'])
  })
})

describe('只看用得上的项 & 只有第一阶段阻止批准', () => {
  it('没有广告步骤的阶段不出广告类检查', () => {
    const s = baseSpec()
    const keys = evaluatePhaseGates(s, s.phases[1], goodFacts()).map(r => r.key)
    expect(keys).toEqual([])
  })

  it('第一阶段 = 开始日期最早的阶段，与数组顺序无关', () => {
    const s = baseSpec()
    s.phases.reverse()
    expect(firstPhase(s).id).toBe('p1')
  })

  it('后面阶段即使有红灯也不阻止批准计划', () => {
    const s = verifiedAll()
    s.phases[1].steps = [{ id: 'later-ads', kind: 'ads_campaign', settings: {
      ad_account_id: 'act_none', daily_budget_cents: 1000, audience_ref: 'a', creative_refs: [], placements: [], paused_ranges: [] } }]
    expect(evaluatePhaseGates(s, s.phases[1], goodFacts()).some(r => r.light === 'red')).toBe(true)
    expect(evaluateApproval(s, goodFacts()).can_approve).toBe(true)
  })
})

describe('worstLight / blockers / unverified', () => {
  it('worstLight 取最差：红 > 灰 > 黄 > 绿', () => {
    const r = (l: 'green' | 'yellow' | 'gray' | 'red') => ({ light: l } as never)
    expect(worstLight([r('green'), r('yellow')])).toBe('yellow')
    expect(worstLight([r('yellow'), r('gray')])).toBe('gray')
    expect(worstLight([r('gray'), r('red')])).toBe('red')
    expect(worstLight([])).toBe('green')
  })
  it('软门灰进 unverified 不进 blockers', () => {
    const r = evaluatePhaseGates(baseSpec(), baseSpec().phases[0], goodFacts({ daily_plan_coverage_days: null }))
    expect(blockers(r).every(b => b.hard)).toBe(true)
    expect(unverified(r).some(u => u.key === 'social.cadence_scheduled')).toBe(true)
  })
})

describe('批准前评估所有含广告的阶段', () => {
  // 把 baseSpec 里已有的 p2 改成含广告步骤的阶段，并指定开始日期（NOW=2026-10-30，新鲜度 7 天）
  const withAdsPhase = (startDate: string): PromoSpec => {
    const s = structuredClone(verifiedAll())
    // 第一阶段只留社媒步骤，让红灯只可能来自 p2
    s.phases[0].steps = s.phases[0].steps.filter(st => st.kind === 'social_cadence')
    const p2 = s.phases.find(p => p.id === 'p2')!
    p2.start_date = startDate
    p2.steps = [{
      id: 'p2-ads', kind: 'ads_campaign', settings: {
        ad_account_id: 'act_1', daily_budget_cents: 1000, audience_ref: 'a',
        creative_refs: ['vid-1'], placements: [], paused_ranges: [],
      },
    }]
    return s
  }

  it('a. 第一阶段只有社媒、p2 有广告且到期、素材未批准 → 不能批准，blockers 里有 p2', () => {
    const s = withAdsPhase('2026-11-02')
    const f = goodFacts({ config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'candidate' }] } })
    const v = evaluateApproval(s, f)
    expect(v.can_approve).toBe(false)
    expect(v.blockers.some(b => b.phase_id === 'p2')).toBe(true)
  })

  it('b. 同上但 p2 在三个月后开始 → 不阻塞，进 deferred_blockers', () => {
    const s = withAdsPhase('2026-12-01')
    const f = goodFacts({ config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'candidate' }] } })
    const v = evaluateApproval(s, f)
    expect(v.blockers.length).toBe(0)
    expect(v.can_approve).toBe(true)
    expect(v.deferred_blockers.some(b => b.phase_id === 'p2')).toBe(true)
  })

  it('c. p2 到期且素材已批准、账户快照很旧（灰）→ 不能批准', () => {
    const s = withAdsPhase('2026-11-02')
    const f = goodFacts({
      config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'approved' }] },
      snapshots: { act_1: { account_status: 1, captured_at: '2026-09-01T00:00:00Z' } },
    })
    const v = evaluateApproval(s, f)
    expect(v.can_approve).toBe(false)
    expect(v.blockers.some(b => b.phase_id === 'p2' && b.key === 'ads.account_usable')).toBe(true)
  })

  it('d. results 里每条都带 phase_id；两个阶段都有广告时同一个 key 各出现一次', () => {
    const s = withAdsPhase('2026-11-02')
    // 给第一阶段补回一个广告步骤，让两个阶段都跑广告硬门
    s.phases[0].steps.push({ id: 'p1-ads', kind: 'ads_campaign', settings: {
      ad_account_id: 'act_1', daily_budget_cents: 1000, audience_ref: 'a', creative_refs: ['vid-1'], placements: [], paused_ranges: [] } })
    const v = evaluateApproval(s, goodFacts())
    expect(v.results.every(r => typeof r.phase_id === 'string')).toBe(true)
    const phases = v.results.filter(r => r.key === 'ads.account_usable').map(r => r.phase_id)
    expect(phases).toContain('p1')
    expect(phases).toContain('p2')
  })
})

describe('人工核实绑内容版本', () => {
  const rec = (hash?: string) => ({
    phase_id: 'p1', check_key: 'landing.item_live', verified_by: 'fde@example.com', verified_at: '2026-10-28T00:00:00Z', note: '',
    ...(hash === undefined ? {} : { content_hash: hash }),
  })
  const landing = (spec: PromoSpec, records: ReturnType<typeof rec>[]) =>
    evaluatePhaseGates(spec, spec.phases[0], goodFacts({ manual_checks: records })).find(r => r.key === 'landing.item_live')!

  it('核实时的内容指纹 = 现在的指纹 → 绿', () => {
    const spec = baseSpec()
    expect(landing(spec, [rec(promoContentHash(spec))]).light).toBe('green')
  })
  it('内容在核实之后改过（指纹对不上）→ 灰，写明要重新核实', () => {
    const spec = baseSpec()
    const r = landing(spec, [rec('0000000000000000')])
    expect(r.light).toBe('gray')
    expect(r.reason).toContain('需要重新核实')
  })
  it('旧核实记录没有内容指纹 → 灰（fail-closed）', () => {
    const r = landing(baseSpec(), [rec()])
    expect(r.light).toBe('gray')
    expect(r.reason).toContain('需要重新核实')
  })
  it('同一项有新旧两条：只认指纹对得上的那条', () => {
    const spec = baseSpec()
    const stale = { ...rec('0000000000000000'), verified_at: '2026-10-29T00:00:00Z' }
    expect(landing(spec, [stale, rec(promoContentHash(spec))]).light).toBe('green')
  })
})
