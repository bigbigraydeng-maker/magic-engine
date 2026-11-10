import { describe, expect, it } from 'vitest'

import { BUDGET_CARD_ACTION, PAUSE_CARD_ACTION } from '@/lib/flywheel/attribution/executed-review'
import { buildAdsExecutionReviewPanel } from '../panel'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-02-01T00:00:00.000Z')
const SOURCE = {
  prescriptionId: 'rx-1',
  version: 1,
  goalId: 'goal-1',
  planId: 'plan-1',
  planHash: 'hash-1',
  approvedOn: '2026-11-01',
}

describe('buildAdsExecutionReviewPanel', () => {
  it('shows pending day before the window ends and verdict when reviewCase exists', () => {
    const panel = buildAdsExecutionReviewPanel({
      clientId: CLIENT,
      limit: 5,
      now: new Date('2026-01-03T00:00:00.000Z'),
      actions: [
        {
          id: 'budget-1',
          action_type: BUDGET_CARD_ACTION,
          executed_at: '2026-01-01T00:00:00.000Z',
          expected_metric: 'ads.account.cpa',
          payload: {
            status: 'executed',
            direction: 'down',
            observationWindowDays: 7,
            order: { expectedMetric: 'ads.account.cpa', adsetId: 'set-a', name: '示例广告组' },
            lock: SOURCE,
          },
        },
        {
          id: 'budget-2',
          action_type: BUDGET_CARD_ACTION,
          executed_at: '2026-01-01T00:00:00.000Z',
          expected_metric: 'ads.account.cpa',
          payload: {
            status: 'executed',
            direction: 'down',
            observationWindowDays: 7,
            beforeCents: 5000,
            afterCents: 4000,
            order: { expectedMetric: 'ads.account.cpa', adsetId: 'set-b', name: '另一组' },
            lock: SOURCE,
            reviewCase: {
              verdict: 'worse',
              reason: null,
              text: '把这个广告组的日预算从 50.00 调到 40.00。希望获客成本下降。观察 7 天，这个广告组的获客成本从 40 到 55。结论：变差了。',
            },
          },
        },
      ],
      outcomes: [
        {
          action_id: 'budget-2',
          metric_key: 'ads.account.cpa',
          window_days: 7,
          baseline: 40,
          after_value: 55,
        },
      ],
    })

    expect(panel.items).toHaveLength(2)
    expect(panel.items[0].pending_label).toBe('第 3 天出结论')
    expect(panel.items[0].verdict).toBeNull()
    expect(panel.items[1].verdict).toBe('worse')
    expect(panel.items[1].verdict_label).toBe('变差')
    expect(panel.items[1].metrics?.[0]).toMatchObject({ before: '40', after: '55' })
  })

  it('omits non-executed rows', () => {
    const panel = buildAdsExecutionReviewPanel({
      clientId: CLIENT,
      limit: 5,
      now: NOW,
      actions: [
        {
          id: 'pause-1',
          action_type: PAUSE_CARD_ACTION,
          executed_at: '2026-01-01T00:00:00.000Z',
          expected_metric: 'ads.account.spend',
          payload: { status: 'holding', source: SOURCE, order: { metric: 'ads.account.spend', adsetId: 'set-a', observationDays: 7 } },
        },
      ],
      outcomes: [],
    })
    expect(panel.items).toEqual([])
  })
})
