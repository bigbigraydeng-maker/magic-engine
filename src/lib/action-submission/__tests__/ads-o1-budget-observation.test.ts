import { describe, expect, it } from 'vitest'
import {
  O1_BUDGET_OUTCOME_WINDOW_DAYS,
  concludeO1BudgetObservation,
  resolveO1BudgetGoalMetric,
  shiftO1BudgetDate,
  sumO1BudgetMetricPeriod,
  type O1BudgetMetricPeriod,
  type O1BudgetMetricRow,
} from '../ads-o1-budget-observation'

// Offline production-shape fixture only. CTS Tours travel-acquisition values are simulated.
const SIMULATED_CTS_TOURS = {
  metric: resolveO1BudgetGoalMetric('leads_count')!,
  start: '2026-09-01',
  rows: Array.from({ length: O1_BUDGET_OUTCOME_WINDOW_DAYS }, (_, index): O1BudgetMetricRow => ({
    insight_date: shiftO1BudgetDate('2026-09-01', index),
    leads: 10,
    messaging_conversations: 0,
  })),
}

function period(start: string, rows: O1BudgetMetricRow[]): O1BudgetMetricPeriod | null {
  const end = shiftO1BudgetDate(start, rows.length - 1)
  return sumO1BudgetMetricPeriod(rows, SIMULATED_CTS_TOURS.metric, start, end)
}

function conclusion(overrides: Partial<Parameters<typeof concludeO1BudgetObservation>[0]> = {}) {
  const baseline = period(SIMULATED_CTS_TOURS.start, SIMULATED_CTS_TOURS.rows)!
  const afterRows = Array.from({ length: O1_BUDGET_OUTCOME_WINDOW_DAYS }, (_, index): O1BudgetMetricRow => ({
    insight_date: shiftO1BudgetDate('2026-09-29', index),
    leads: 15,
    messaging_conversations: 0,
  }))
  return concludeO1BudgetObservation({
    baseline,
    after: period('2026-09-29', afterRows),
    metric: SIMULATED_CTS_TOURS.metric,
    targetDirection: 'increase',
    baselineFresh: true,
    now: new Date('2026-10-20T00:00:00.000Z'),
    firstReviewAt: '2026-10-01T00:00:00.000Z',
    windowComplete: true,
    receiptVerified: true,
    budgetMatchesThisRun: true,
    ...overrides,
  })
}

describe('O1 budget observation', () => {
  it('keeps an offline simulated CTS Tours adjustment when the inherited KPI improves under existing attribution thresholds', () => {
    const result = conclusion()
    expect(result.conclusion).toBe('keep')
    expect(result.reason).toContain('不代表因果证明')
    expect(result.delta).toBe(70)
  })

  it('requests human restore review for a reversed KPI and never writes a budget', () => {
    const baseline = period(SIMULATED_CTS_TOURS.start, SIMULATED_CTS_TOURS.rows)!
    const afterRows = Array.from({ length: O1_BUDGET_OUTCOME_WINDOW_DAYS }, (_, index): O1BudgetMetricRow => ({
      insight_date: shiftO1BudgetDate('2026-09-29', index), leads: 5, messaging_conversations: 0,
    }))
    const result = conclusion({ after: period('2026-09-29', afterRows) })
    expect(result.conclusion).toBe('request_restore')
    expect(result.reason).toContain('不会自动改预算')
  })

  it('continues observing before the 72-hour first review, with incomplete data, or after an external budget change', () => {
    expect(conclusion({ now: new Date('2026-09-30T23:59:59.000Z') }).conclusion).toBe('continue_observing')
    expect(conclusion({ after: null }).conclusion).toBe('continue_observing')
    expect(conclusion({ budgetMatchesThisRun: false }).conclusion).toBe('continue_observing')
    expect(conclusion({ windowComplete: false }).conclusion).toBe('continue_observing')
    expect(conclusion({ baselineFresh: false }).conclusion).toBe('continue_observing')
  })

  it('does not treat a missing target-day row as zero or evaluate unsupported goals', () => {
    const partialRows = SIMULATED_CTS_TOURS.rows.slice(1)
    expect(period(SIMULATED_CTS_TOURS.start, partialRows)).toBeNull()
    expect(resolveO1BudgetGoalMetric('revenue')).toBeNull()
    expect(conclusion({ metric: null }).conclusion).toBe('continue_observing')
  })
})
