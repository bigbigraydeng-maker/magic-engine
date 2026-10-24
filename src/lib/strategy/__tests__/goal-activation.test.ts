import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  activateGoal,
  assessGoalActivation,
  BASELINE_UNKNOWN_KEY,
  BASELINE_UNKNOWN_LABEL,
  type GoalActivationSubject,
} from '../goals'

const REASON = '本周期以成交笔数验收，不拿点击当结果。'

function ready(overrides: Partial<GoalActivationSubject> = {}): GoalActivationSubject {
  return {
    intent: 'sales',
    primary_metric_key: 'signups_count',
    primary_metric_label: '报名/预订数',
    baseline_value: 0,
    supporting_metrics: [],
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    fde_reasoning: REASON,
    ...overrides,
  }
}

function mockDb(
  goal: Record<string, unknown> | null,
  updateError: { message: string } | null = null,
) {
  const eq = vi.fn().mockResolvedValue({ error: updateError })
  const update = vi.fn(() => ({ eq }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: goal, error: null })
  const selectEq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq: selectEq }))
  const from = vi.fn(() => ({ select, update }))
  return { client: { from } as unknown as SupabaseClient, update }
}

describe('assessGoalActivation', () => {
  it('accepts a complete sales goal, including a declared baseline of 0', () => {
    expect(assessGoalActivation(ready())).toBeNull()
  })

  it('accepts a numeric string baseline, including "0"', () => {
    expect(assessGoalActivation(ready({ baseline_value: '12.5' }))).toBeNull()
    expect(assessGoalActivation(ready({ baseline_value: '0' }))).toBeNull()
  })

  it('accepts an explicit baseline-unknown mark when the number is missing', () => {
    const byKey = assessGoalActivation(ready({
      baseline_value: null,
      supporting_metrics: [{ key: BASELINE_UNKNOWN_KEY, label: 'placeholder' }],
    }))
    const byLabel = assessGoalActivation(ready({
      baseline_value: null,
      supporting_metrics: [{ key: 'note', label: ` ${BASELINE_UNKNOWN_LABEL} ` }],
    }))
    expect(byKey).toBeNull()
    expect(byLabel).toBeNull()
  })

  it('lists every missing item, and does not treat a blank baseline as 0', () => {
    const refusal = assessGoalActivation(ready({
      primary_metric_key: ' ',
      primary_metric_label: '',
      baseline_value: null,
      period_start: '',
      period_end: null,
      fde_reasoning: '   ',
    }))
    expect(refusal).toMatchObject({
      ok: false,
      missing: ['primary_metric', 'period', 'baseline', 'reason'],
    })
    expect(refusal?.sales_metric).toBeUndefined()
    expect(refusal?.error).toContain('缺：主指标、周期起止、基线（数值或「基线未知」）、理由')
  })

  it('reports only the items that are actually missing', () => {
    const refusal = assessGoalActivation(ready({ fde_reasoning: '待定' }))
    expect(refusal?.missing).toEqual(['reason'])
    expect(refusal?.error).toBe('不能改为进行中，缺：理由')
  })

  it('rejects a period that does not end after it starts', () => {
    expect(assessGoalActivation(ready({
      period_start: '2026-03-31',
      period_end: '2026-03-01',
    }))?.missing).toEqual(['period'])
    expect(assessGoalActivation(ready({
      period_start: '2026-03-01',
      period_end: '2026-03-01',
    }))?.missing).toEqual(['period'])
    expect(assessGoalActivation(ready({
      period_start: 'not-a-date',
      period_end: '2026-03-31',
    }))?.missing).toEqual(['period'])
  })

  it('rejects a placeholder or too-short reason', () => {
    expect(assessGoalActivation(ready({ fde_reasoning: 'unknown.' }))?.missing).toEqual(['reason'])
    expect(assessGoalActivation(ready({ fde_reasoning: '12345678' }))?.missing).toEqual(['reason'])
    expect(assessGoalActivation(ready({ fde_reasoning: null }))?.missing).toEqual(['reason'])
  })

  it.each([
    'seo_gsc_clicks_28d',
    'leads_count',
    'messaging_started',
    'form_submissions',
    'phone_calls',
    'fb_link_clicks',
    'inquiry_count',
  ])('rejects sales primary metric %s', key => {
    const refusal = assessGoalActivation(ready({
      primary_metric_key: key,
      primary_metric_label: '自定义',
    }))
    expect(refusal?.missing).toEqual([])
    expect(refusal?.sales_metric).toBe('click_or_lead')
    expect(refusal?.error).toContain(`销售目标的主指标不能是点击或线索（${key}）`)
  })

  it('rejects a sales goal whose label is a click or lead metric', () => {
    const refusal = assessGoalActivation(ready({
      primary_metric_key: 'custom_metric',
      primary_metric_label: '新增线索/询盘',
    }))
    expect(refusal?.sales_metric).toBe('click_or_lead')
    expect(refusal?.error).toContain('custom_metric')
  })

  it('allows click and lead metrics when the intent is not sales', () => {
    expect(assessGoalActivation(ready({
      intent: 'acquisition',
      primary_metric_key: 'leads_count',
      primary_metric_label: '新增线索/询盘',
    }))).toBeNull()
    expect(assessGoalActivation(ready({
      intent: 'awareness',
      primary_metric_key: 'seo_gsc_clicks_28d',
      primary_metric_label: '谷歌搜索点击（近 28 天）',
    }))).toBeNull()
  })

  it('does not treat sale, revenue, or traffic metrics as click or lead', () => {
    for (const key of ['signups_count', 'monthly_revenue', 'organic_traffic', 'leadership_index']) {
      expect(assessGoalActivation(ready({
        primary_metric_key: key,
        primary_metric_label: '自定义结果',
      }))).toBeNull()
    }
  })

  it('returns missing items and the sales refusal together', () => {
    const refusal = assessGoalActivation(ready({
      primary_metric_key: 'leads_count',
      primary_metric_label: '新增线索/询盘',
      fde_reasoning: '',
      baseline_value: 'nope',
    }))
    expect(refusal?.missing).toEqual(['baseline', 'reason'])
    expect(refusal?.sales_metric).toBe('click_or_lead')
    expect(refusal?.error).toContain('缺：基线')
    expect(refusal?.error).toContain('leads_count')
  })
})

describe('activateGoal', () => {
  it('writes only status when the contract passes', async () => {
    const db = mockDb({ id: 'goal-1', status: 'draft', ...ready({ baseline_value: '0' }) })
    const result = await activateGoal(db.client, 'goal-1')
    expect(result).toEqual({ ok: true })
    expect(db.update).toHaveBeenCalledTimes(1)
    expect(db.update).toHaveBeenCalledWith({ status: 'active' })
  })

  it('does not write when the contract fails', async () => {
    const db = mockDb({ id: 'goal-1', status: 'draft', ...ready({ fde_reasoning: null }) })
    const result = await activateGoal(db.client, 'goal-1')
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['reason'])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('does not write a goal that is not a draft', async () => {
    const db = mockDb({ id: 'goal-1', status: 'active', ...ready() })
    const result = await activateGoal(db.client, 'goal-1')
    expect(result).toEqual({ ok: false, error: "Cannot activate goal in status 'active'" })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('returns not found without writing', async () => {
    const db = mockDb(null)
    const result = await activateGoal(db.client, 'missing')
    expect(result).toEqual({ ok: false, error: 'Goal not found' })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('returns the database error and does not claim success', async () => {
    const db = mockDb(
      { id: 'goal-1', status: 'draft', ...ready() },
      { message: 'connection refused' },
    )
    const result = await activateGoal(db.client, 'goal-1')
    expect(result).toEqual({ ok: false, error: 'connection refused' })
    expect(db.update).toHaveBeenCalledWith({ status: 'active' })
  })
})
