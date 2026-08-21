import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY, type GoalRow } from '@/types/strategy'
import { VerdictPanel } from '../VerdictPanel'

void React

function makeGoal(primaryMetricKey: string): GoalRow {
  return {
    id: 'goal-1', client_id: 'client-1', intent: 'awareness', awareness_subtype: 'new_market',
    sub_type: 'new_market', title: 'GEO visibility lift', primary_metric_key: primaryMetricKey,
    primary_metric_label: 'AI 合格提及覆盖', primary_metric_unit: 'qualified queries / pinned cohort',
    baseline_value: 1, target_value: 4, target_direction: 'increase', supporting_metrics: [],
    period_start: '2026-08-22', period_end: '2026-09-05', budget_amount: null,
    budget_currency: null, status: 'active', verdict: null, verdict_at: null,
    verdict_summary: null, fde_reasoning: null, is_beta: true,
    created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z', created_by: null,
  }
}

afterEach(cleanup)

describe('VerdictPanel governed Verification gate', () => {
  it('blocks manual and early verdicts for the GEO verification metric', () => {
    render(<VerdictPanel
      goal={makeGoal(GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY)}
      onJudged={vi.fn()}
    />)

    expect(screen.getByText('Governed Verification required')).toBeInTheDocument()
    expect(screen.getByText(/incomplete evidence remains UNKNOWN/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit Verdict' })).not.toBeInTheDocument()
  })

  it('keeps the existing manual verdict path for non-verification metrics', () => {
    render(<VerdictPanel goal={makeGoal('orders_count')} onJudged={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Submit Verdict' })).toBeInTheDocument()
  })
})
