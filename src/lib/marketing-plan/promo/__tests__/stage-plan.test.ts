import { describe, expect, it } from 'vitest'
import { audienceLadder } from '../audience-ladder'
import { defaultTestDelivery, ratioWarning } from '../delivery-stage'
import { withBudgetRole } from '../form'
import { promoContentHash } from '../content-hash'
import { buildScaleDraft, judgeSwitch, type SwitchEvidence } from '../stage-switch'
import { stageProposalRow } from '../stage-proposal'
import { parsePromoSpec, type PromoSpec } from '../spec'
import { baseSpec } from './fixtures'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

function fresh(over: Partial<SwitchEvidence> = {}): SwitchEvidence {
  return {
    capture: 'fresh',
    asOf: '2026-11-15',
    stableEnd: '2026-11-14',
    datesSeen: 14,
    leads: 30,
    spendMajor: 600,
    targetMajor: 20,
    currency: 'NZD',
    ...over,
  }
}

function marked(stage: 'test' | 'scale' | 'steady', extra: Partial<PromoSpec> = {}): PromoSpec {
  const spec = baseSpec(extra)
  spec.delivery = { stage, goal: '把单次留资成本试到目标以内', started_on: '2026-11-01', test_share: 0.3, proven_share: 0.7 }
  return spec
}

describe('阶段写在原有计划里，旧计划指纹不变', () => {
  it('没写阶段的计划解析后也不出现这个键', () => {
    const parsed = parsePromoSpec(baseSpec())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect('delivery' in parsed.spec).toBe(false)
    expect(promoContentHash(parsed.spec)).toBe(promoContentHash(baseSpec()))
  })

  it('写上阶段会改变指纹，所以必须另批，不会自动算已批准', () => {
    const plain = parsePromoSpec(baseSpec())
    const next = parsePromoSpec(marked('test'))
    expect(plain.ok && next.ok).toBe(true)
    if (!plain.ok || !next.ok) return
    expect(promoContentHash(next.spec)).not.toBe(promoContentHash(plain.spec))
  })

  it('比例对不上只是提醒，计划仍然合法', () => {
    const spec = marked('test')
    const step = spec.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('fixture')
    step.settings.daily_budget_cents = 9000
    expect(parsePromoSpec(spec).ok).toBe(true)
    expect(ratioWarning(spec).level).toBe('warn')
    expect(ratioWarning(spec).text).toContain('不拦住批准')
  })
})

describe('试投证据够了才建议放量', () => {
  it('30 条留资且不高于设置里的目标 → 建议另起草稿', () => {
    const verdict = judgeSwitch(marked('test'), fresh())
    expect(verdict.kind).toBe('propose')
    expect(verdict.text).toContain('不会自动重新批准')
  })

  it('差一条、贵一点、天数不够、目标没填、快照过期，都不建议', () => {
    expect(judgeSwitch(marked('test'), fresh({ leads: 29 })).kind).toBe('hold')
    expect(judgeSwitch(marked('test'), fresh({ spendMajor: 630 })).kind).toBe('hold')
    expect(judgeSwitch(marked('test'), fresh({ asOf: '2026-11-14', stableEnd: '2026-11-13', datesSeen: 13 })).kind).toBe('hold')
    expect(judgeSwitch(marked('test'), fresh({ targetMajor: null })).kind).toBe('unreadable')
    expect(judgeSwitch(marked('test'), fresh({ capture: 'stale' })).kind).toBe('unreadable')
    expect(judgeSwitch(marked('test'), fresh({ capture: 'incomplete' })).kind).toBe('unreadable')
    const scaled = judgeSwitch(marked('scale'), fresh())
    expect(scaled.kind).toBe('scale_hold')
    if (scaled.kind === 'scale_hold') expect(scaled.text).toContain('不改预算')
    expect(judgeSwitch(marked('steady'), fresh()).kind).toBe('steady')
    expect(judgeSwitch(baseSpec(), fresh()).kind).toBe('not_marked')
  })

  it('新草稿是放量，每日金额不动，也不带批准记录', () => {
    const source = marked('test')
    const snapshot = structuredClone(source)
    const built = buildScaleDraft(source, '2026-11-15')
    expect(source).toEqual(snapshot)
    expect(built.spec.delivery?.stage).toBe('scale')
    expect(built.spec.phases[0].steps[0]).toEqual(source.phases[0].steps[0])
    expect(built.spec.checks).toEqual([])
    const plan = { id: 'plan-1', client_id: 'client-1', title: '春季', status: 'approved', plan_data: { social: {}, blog: { monthly_count: 0, topics: [] }, kpis: {}, tasks: [], promo: source }, start_date: '2026-11-01', end_date: '2026-11-30', generation_meta: { approval_receipt: { approved_at: '2026-11-01T00:00:00Z' } } } as MarketingPlan
    const row = stageProposalRow(plan, built.spec, '2026-11-15T00:00:00.000Z')
    expect(row.status).toBe('draft')
    expect(row.approved_at).toBeNull()
    expect(row.generation_meta).not.toHaveProperty('approval_receipt')
    expect(row.plan_data.tasks).toEqual([])
  })
})

describe('受众顺序只是建议', () => {
  const banned = /华人|中国人|华裔|Chinese|ethnicity/i

  it('顺序是广泛、兴趣、相似受众，种子含已报价，不按族裔，也不新建', () => {
    const view = audienceLadder({ stage: 'test', countries: ['NZ'], qualified: 'ready', quoted: 'included' })
    const text = `${view.note} ${view.rungs.map(rung => `${rung.title} ${rung.detail}`).join(' ')}`
    expect(view.rungs.map(rung => rung.title)).toEqual(['广泛', '兴趣', '相似受众'])
    expect(view.rungs.find(rung => rung.suggested)?.title).toBe('广泛')
    expect(text).toContain('已报价')
    expect(text).toContain('不会在广告后台新建')
    expect(text).not.toMatch(banned)
  })

  it('没有合格客人，或已报价被排除时，放量不停在相似受众', () => {
    const empty = audienceLadder({ stage: 'scale', countries: ['NZ'], qualified: 'empty', quoted: 'absent' })
    const excluded = audienceLadder({ stage: 'scale', countries: ['NZ'], qualified: 'ready', quoted: 'excluded' })
    expect(empty.rungs.find(rung => rung.suggested)?.title).toBe('兴趣')
    expect(excluded.rungs.find(rung => rung.suggested)?.title).toBe('兴趣')
    expect(excluded.rungs[2].detail).toContain('已报价')
  })
})

describe('预算角色留空时不留空键', () => {
  it('选回「还没标」会把键删掉', () => {
    const spec = marked('test')
    const step = spec.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('fixture')
    const markedStep = withBudgetRole(step, 'test')
    const cleared = withBudgetRole(markedStep, undefined)
    expect(cleared.settings.budget_role).toBeUndefined()
    expect('budget_role' in cleared.settings).toBe(false)
  })

  it('新草稿默认从试投开始', () => {
    expect(defaultTestDelivery('2026-11-01').stage).toBe('test')
  })
})
