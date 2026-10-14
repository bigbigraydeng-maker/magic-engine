import { describe, expect, it } from 'vitest'
import { blockers, evaluateApproval, evaluatePhaseGates, firstPhase, unverified, worstLight, type GateKey } from '../gates'
import { baseSpec, goodFacts as rawFacts, verifiedChecks } from './fixtures'
import type { PromoSpec } from '../spec'

const verifiedAll = (): PromoSpec => baseSpec()
/** 默认带上服务端核实记录；要测"没核实"的用例显式传 manual_checks: [] */
const goodFacts = (o: Parameters<typeof rawFacts>[0] = {}) => rawFacts({ manual_checks: verifiedChecks(), ...o })
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
    const v = evaluateApproval(baseSpec(), goodFacts({ manual_checks: [] }))
    expect(v.can_approve).toBe(false)
    expect(v.blockers.map(b => b.key)).toContain('landing.item_live')
    expect(light(baseSpec(), goodFacts({ manual_checks: [] }))('landing.item_live')).toBe('gray')
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
    const f = goodFacts({ manual_checks: verifiedChecks('2026-01-01T00:00:00Z') })
    expect(light(verifiedAll(), f)('landing.item_live')).toBe('gray')
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

describe('spec.checks 是客户端可写的，不算核实证据', () => {
  it('计划里自带 checks 但服务端没有核实记录 → 落地页仍是灰，不能批准', () => {
    const forged = baseSpec({ checks: verifiedChecks() })
    const f = goodFacts({ manual_checks: [] })
    expect(light(forged, f)('landing.item_live')).toBe('gray')
    expect(evaluateApproval(forged, f).can_approve).toBe(false)
  })
})
