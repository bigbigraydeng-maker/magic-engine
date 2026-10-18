import { describe, expect, it } from 'vitest'
import { parsePromoSpec } from '../spec'

function spec(extra: Record<string, unknown> = {}, phaseExtra: Record<string, unknown> = {}) {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [{ id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14', steps: [], ...phaseExtra }],
    checks: [],
    ...extra,
  }
}

const BUSINESS_CASE = {
  departure_ref: 'dep-1',
  seats_remaining: 12,
  seats_confirmed: true,
  seats_as_of: '2026-11-01',
  retained_per_seat_cents: 50000,
  retention_basis: ['commission'],
  pax_per_booking: 1.5,
  lead_to_booking_rate: 0.03,
  rate_source: 'measured',
  rate_sample_n: 200,
  creative_gap_note: '',
  owner: 'fde@example.com',
}

const EXPERIMENT = {
  hypothesis: '换开头三秒能提高留资',
  held_constant: ['受众', '预算'],
  primary_metric: 'enquiry',
  max_loss_cents: 30000,
  stop_rule: '两周内每条线索成本高于上限就停',
  continue_rule: '每条线索成本低于上限就继续',
  owner: 'fde@example.com',
}

const SALES_HANDOVER = {
  owner: 'sales@example.com',
  response_sla_hours: 24,
  channels: ['phone', 'email'],
  fallback: '没人接就转给值班经理',
}

describe('向后兼容', () => {
  it('不带新字段的旧计划照常解析', () => {
    const r = parsePromoSpec(spec())
    if (!r.ok) throw new Error('应该解析成功')
    // is_experiment 一旦被写进解析结果，所有旧计划的内容指纹都会变
    expect('is_experiment' in r.spec.phases[0]).toBe(false)
  })
})

describe('经营判断卡', () => {
  it('填齐了就能解析', () => {
    const r = parsePromoSpec(spec({}, { business_case: BUSINESS_CASE }))
    if (!r.ok) throw new Error('应该解析成功')
    expect(r.spec.phases[0].business_case?.seats_remaining).toBe(12)
  })

  it('rate_sample_n 不填时默认为 null', () => {
    const { rate_sample_n: _omit, ...withoutSample } = BUSINESS_CASE
    const r = parsePromoSpec(spec({}, { business_case: withoutSample }))
    if (!r.ok) throw new Error('应该解析成功')
    expect(r.spec.phases[0].business_case?.rate_sample_n).toBeNull()
  })

  it('retention_basis 为空数组会被拒', () => {
    const r = parsePromoSpec(spec({}, { business_case: { ...BUSINESS_CASE, retention_basis: [] } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.startsWith('phases.0.business_case.retention_basis'))).toBe(true)
  })

  it('成交率大于 1 会被拒', () => {
    const r = parsePromoSpec(spec({}, { business_case: { ...BUSINESS_CASE, lead_to_booking_rate: 1.5 } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('lead_to_booking_rate'))).toBe(true)
  })

  it('每座留存为 0 会被拒', () => {
    const r = parsePromoSpec(spec({}, { business_case: { ...BUSINESS_CASE, retained_per_seat_cents: 0 } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('retained_per_seat_cents'))).toBe(true)
  })

  it('座位数取数日期格式不对会被拒', () => {
    const r = parsePromoSpec(spec({}, { business_case: { ...BUSINESS_CASE, seats_as_of: '01/11/2026' } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('seats_as_of'))).toBe(true)
  })
})

describe('实验设计卡', () => {
  it('标了做实验但没填卡 → 被拒，并说清楚', () => {
    const r = parsePromoSpec(spec({}, { is_experiment: true }))
    if (r.ok) throw new Error('应该被拒')
    const issue = r.issues.find(i => i.path === 'phases.0.experiment')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('实验')
  })

  it('标了做实验且填了卡 → 通过', () => {
    const r = parsePromoSpec(spec({}, { is_experiment: true, experiment: EXPERIMENT }))
    if (!r.ok) throw new Error('应该解析成功')
    expect(r.spec.phases[0].experiment?.primary_metric).toBe('enquiry')
  })

  it('没标做实验、也没填卡 → 通过', () => {
    const r = parsePromoSpec(spec())
    if (!r.ok) throw new Error('应该解析成功')
    expect(r.spec.phases[0].experiment).toBeUndefined()
  })

  it('主指标不在枚举里会被拒', () => {
    const r = parsePromoSpec(
      spec({}, { is_experiment: true, experiment: { ...EXPERIMENT, primary_metric: 'revenue' } }),
    )
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('primary_metric'))).toBe(true)
  })

  it('最大损失为负会被拒', () => {
    const r = parsePromoSpec(
      spec({}, { is_experiment: true, experiment: { ...EXPERIMENT, max_loss_cents: -1 } }),
    )
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('max_loss_cents'))).toBe(true)
  })
})

describe('销售承接', () => {
  it('填齐了就能解析', () => {
    const r = parsePromoSpec(spec({ sales_handover: SALES_HANDOVER }))
    if (!r.ok) throw new Error('应该解析成功')
    expect(r.spec.sales_handover?.response_sla_hours).toBe(24)
  })

  it('渠道为空数组会被拒', () => {
    const r = parsePromoSpec(spec({ sales_handover: { ...SALES_HANDOVER, channels: [] } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('channels'))).toBe(true)
  })

  it('响应时限为 0 会被拒', () => {
    const r = parsePromoSpec(spec({ sales_handover: { ...SALES_HANDOVER, response_sla_hours: 0 } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('response_sla_hours'))).toBe(true)
  })
})
