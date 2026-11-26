import { describe, expect, it } from 'vitest'

import { BUDGET_CARD_ACTION, PAUSE_CARD_ACTION, type ReviewSource } from '@/lib/flywheel/attribution/executed-review'

import { buildExecutionReviewItem, buildAdsExecutionReviewPanel } from '../ads-execution-review-panel'

const SOURCE: ReviewSource = {
  prescriptionId: 'rx-1',
  version: 1,
  goalId: 'goal-1',
  planId: 'plan-1',
  planHash: 'hash-1',
  approvedOn: '2026-11-01',
}

const NOW_DUE = new Date('2026-02-01T00:00:00.000Z')
const NOW_WAIT = new Date('2026-01-03T00:00:00.000Z')

describe('buildExecutionReviewItem', () => {
  it('shows pending label before the observation window ends', () => {
    const item = buildExecutionReviewItem({
      id: 'action-1',
      action_type: BUDGET_CARD_ACTION,
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        status: 'executed',
        direction: 'down',
        observationWindowDays: 7,
        beforeCents: 2000,
        afterCents: 1600,
        order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 7, adsetId: 'set-a' },
        lock: SOURCE,
      },
      outcome_baseline: null,
      outcome_after: null,
    }, NOW_WAIT)
    expect(item?.phase).toBe('pending')
    expect(item?.phase_label).toBe('第 7 天出结论')
    expect(item?.verdict).toBeNull()
    expect(item?.what_done).toContain('日预算')
  })

  it('maps concluded reviewCase to Chinese verdict labels', () => {
    const item = buildExecutionReviewItem({
      id: 'action-2',
      action_type: BUDGET_CARD_ACTION,
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        status: 'executed',
        direction: 'down',
        observationWindowDays: 7,
        beforeCents: 2000,
        afterCents: 1600,
        order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 7, adsetId: 'set-a' },
        lock: SOURCE,
        reviewCase: {
          verdict: 'useful',
          reason: null,
          text: '结论：有用。',
        },
      },
      outcome_baseline: 10,
      outcome_after: 4,
    }, NOW_DUE)
    expect(item?.phase).toBe('concluded')
    expect(item?.verdict).toBe('useful')
    expect(item?.verdict_label).toBe('有用')
    expect(item?.summary).toContain('有用')
  })

  it('handles pause cards with unsure verdict', () => {
    const item = buildExecutionReviewItem({
      id: 'action-3',
      action_type: PAUSE_CARD_ACTION,
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        status: 'executed',
        before: 'ACTIVE',
        after: 'PAUSED',
        source: SOURCE,
        order: { metric: 'ads.account.spend', direction: 'pause', observationDays: 7, adsetId: 'set-a' },
        reviewCase: {
          verdict: 'unclear',
          reason: '花费本身不分变好或变差',
          text: '结论：看不出。',
        },
      },
      outcome_baseline: null,
      outcome_after: null,
    }, NOW_DUE)
    expect(item?.kind_label).toBe('暂停广告组')
    expect(item?.verdict_label).toBe('看不出')
    expect(item?.reason).toContain('花费')
  })

  it('keeps a before/after pair from one source when the other source is only one-sided', () => {
    const base = {
      action_type: BUDGET_CARD_ACTION,
      executed_at: '2026-01-01T00:00:00.000Z',
      outcome_baseline: 12.4,
      outcome_after: 8.25,
    }
    const payload = {
      status: 'executed',
      direction: 'down',
      observationWindowDays: 7,
      order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 7, adsetId: 'set-a' },
      lock: SOURCE,
    }
    const onlyBefore = buildExecutionReviewItem({
      ...base,
      id: 'mix-before',
      payload: { ...payload, beforeCents: 2000 },
    }, NOW_DUE)
    expect(onlyBefore?.before_display).toBe('20.00')
    expect(onlyBefore?.after_display).toBeNull()

    const onlyAfter = buildExecutionReviewItem({
      ...base,
      id: 'mix-after',
      payload: { ...payload, afterCents: 1600 },
    }, NOW_DUE)
    expect(onlyAfter?.before_display).toBeNull()
    expect(onlyAfter?.after_display).toBe('16.00')

    const outcomeOnly = buildExecutionReviewItem({
      ...base,
      id: 'outcome-pair',
      payload,
    }, NOW_DUE)
    expect(outcomeOnly?.before_display).toBe('12.4')
    expect(outcomeOnly?.after_display).toBe('8.25')
  })
})

describe('buildAdsExecutionReviewPanel', () => {
  it('drops non-executed rows', () => {
    const panel = buildAdsExecutionReviewPanel({
      clientId: 'client-1',
      limit: 10,
      now: NOW_DUE,
      rows: [{
        id: 'x',
        action_type: BUDGET_CARD_ACTION,
        executed_at: '2026-01-01T00:00:00.000Z',
        payload: { status: 'holding' },
        outcome_baseline: null,
        outcome_after: null,
      }],
    })
    expect(panel.items).toEqual([])
  })
})
