import { describe, expect, it } from 'vitest'
import type { MarketingPlan } from '../../types'
import { buildBlankDraftInsert } from '../../blank-draft'
import { baseSpec } from './fixtures'
import { pickPlanForPrescription, planLinkedGoalId } from '../plan-pick'

const emptyPlan = {
  social: {},
  blog: { monthly_count: 0, topics: [] },
  kpis: {},
  tasks: [],
}

function plan(over: {
  id: string
  status: 'draft' | 'approved' | 'archived'
  created_at: string
  promo?: unknown
  goalId?: string
}) {
  return {
    id: over.id,
    status: over.status,
    created_at: over.created_at,
    plan_data: over.promo === undefined ? emptyPlan : { ...emptyPlan, promo: over.promo },
    generation_meta: over.goalId ? { blank_draft: { goal_id: over.goalId } } : null,
  }
}

describe('打开挂着当前处方的计划', () => {
  it('新建空白草稿已经挂上目标，推广表单仍是空的', () => {
    const built = buildBlankDraftInsert('client-1', {
      id: 'goal-draft', title: '十月推广', status: 'draft', period_start: '2026-10-01', period_end: '2026-10-31',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.row.plan_data).not.toHaveProperty('promo')
    expect(planLinkedGoalId(built.row)).toBe('goal-draft')
  })

  it('表单里的目标优先于创建时记下的目标', () => {
    expect(planLinkedGoalId({
      plan_data: { ...emptyPlan, promo: baseSpec({ goal_id: 'from-form' }) } as MarketingPlan['plan_data'],
      generation_meta: { blank_draft: { goal_id: 'from-blank' } },
    })).toBe('from-form')
  })

  it('有当前处方时打开挂着它的那一份，不打开更早的另一份', () => {
    const older = plan({
      id: 'old', status: 'approved', created_at: '2026-10-01T00:00:00.000Z',
      promo: baseSpec({ goal_id: 'goal-old' }),
    })
    const newer = plan({
      id: 'new', status: 'draft', created_at: '2026-10-20T00:00:00.000Z', goalId: 'goal-now',
    })
    expect(pickPlanForPrescription([older, newer], 'goal-now')?.id).toBe('new')
    expect(pickPlanForPrescription([newer, older], 'goal-old')?.id).toBe('old')
  })

  it('没有对得上的计划时，仍先看有推广结构的已批准计划', () => {
    const older = plan({
      id: 'old', status: 'approved', created_at: '2026-10-01T00:00:00.000Z',
      promo: baseSpec({ goal_id: 'goal-old' }),
    })
    const archived = plan({
      id: 'gone', status: 'archived', created_at: '2026-10-21T00:00:00.000Z', goalId: 'goal-now',
    })
    expect(pickPlanForPrescription([archived, older], 'goal-now')?.id).toBe('old')
    expect(pickPlanForPrescription([older], null)?.id).toBe('old')
  })
})
