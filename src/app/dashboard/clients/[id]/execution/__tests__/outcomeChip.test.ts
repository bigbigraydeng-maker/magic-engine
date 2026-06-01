/**
 * OutcomeChip display logic — P12.A.10
 *
 * Tests for formatOutcomeLabel: the pure function that builds the chip text
 * displayed on execution item cards ("✅ Mention rate +25%, confirmed (confidence 0.80)").
 */

import { describe, it, expect } from 'vitest'
import { AUTONOMOUS_GROUP_ID, buildExecutionGroups, formatOutcomeLabel } from '../execution-view-model'

type OutcomeSummary = Parameters<typeof formatOutcomeLabel>[0]
type ExecutionGroupItem = Parameters<typeof buildExecutionGroups>[0][number]

const base: OutcomeSummary = {
  verdict: 'confirmed',
  metric_key: 'geo.query.mention_rate',
  delta: 0.25,
  delta_pct: 25,
  confidence: 0.8,
  computed_at: '2026-05-17T00:00:00Z',
}

describe('formatOutcomeLabel', () => {
  it('confirmed with delta_pct — full label', () => {
    const label = formatOutcomeLabel(base)
    expect(label).toBe('Mention rate +25%, confirmed (confidence 0.80)')
  })

  it('reversed with negative delta_pct', () => {
    const label = formatOutcomeLabel({
      ...base,
      verdict: 'reversed',
      delta_pct: -12,
      delta: -0.12,
      confidence: 0.6,
    })
    expect(label).toBe('Mention rate -12%, reversed (confidence 0.60)')
  })

  it('inconclusive with small delta', () => {
    const label = formatOutcomeLabel({
      ...base,
      verdict: 'inconclusive',
      delta_pct: 1,
      confidence: 0.2,
    })
    expect(label).toBe('Mention rate +1%, inconclusive (confidence 0.20)')
  })

  it('falls back to delta when delta_pct is null', () => {
    const label = formatOutcomeLabel({
      ...base,
      delta_pct: null,
      delta: 0.07,
    })
    expect(label).toBe('Mention rate +0.07, confirmed (confidence 0.80)')
  })

  it('no delta at all — label still renders', () => {
    const label = formatOutcomeLabel({
      ...base,
      delta_pct: null,
      delta: null,
    })
    expect(label).toBe('Mention rate confirmed (confidence 0.80)')
  })

  it('unknown metric_key falls back to raw key', () => {
    const label = formatOutcomeLabel({
      ...base,
      metric_key: 'geo.custom.unknown_metric',
    })
    expect(label).toContain('geo.custom.unknown_metric')
  })

  it('rounds delta_pct to nearest integer', () => {
    const label = formatOutcomeLabel({ ...base, delta_pct: 25.7 })
    expect(label).toContain('+26%')
  })

  it('negative delta shows minus sign without double-negative', () => {
    const label = formatOutcomeLabel({ ...base, delta_pct: -5.3, verdict: 'reversed', confidence: 0.5 })
    expect(label).toContain('-5%')
    expect(label).not.toContain('+-')
  })
})

describe('buildExecutionGroups', () => {
  const itemBase: ExecutionGroupItem = {
    id: 'item-1',
    prescription_id: 'prescription-1',
    client_id: 'client-1',
    finding_id: null,
    dimension: 'seo',
    phase: 1,
    title: 'Fix title',
    description: 'Fix the title',
    fix_type: 'me_auto',
    status: 'pending',
    steps_json: null,
    execution_target: null,
    assigned_to: null,
    due_date: null,
    started_at: null,
    completed_at: null,
    sort_order: 1,
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
    content_post_id: null,
    source: 'diagnostic',
    marketing_plan_id: null,
    logs: [],
    outcome: null,
    linked_post: null,
  }

  it('puts autonomous flywheel actions in the first lane', () => {
    const groups = buildExecutionGroups([
      itemBase,
      {
        ...itemBase,
        id: 'action-1',
        prescription_id: AUTONOMOUS_GROUP_ID,
        title: '生成博客：NZ tours',
        status: 'completed',
        source_kind: 'flywheel_action',
        flywheel_action_id: 'action-1',
      },
    ], [
      {
        id: 'prescription-1',
        status: 'approved',
        supplements_id: null,
        supersedes_id: null,
        generated_at: '2026-05-21T00:00:00Z',
      },
    ])

    expect(groups[0].pid).toBe(AUTONOMOUS_GROUP_ID)
    expect(groups[0].label).toBe('飞轮自主行动')
    expect(groups[0].items).toHaveLength(1)
    expect(groups[1].label).toBe('原处方')
  })
})
