import { describe, expect, it } from 'vitest'
import {
  BUDGET_CARD_ACTION,
  CAMPAIGN_PAUSE_ACTION,
  CAMPAIGN_PAUSE_WINDOW_UNSET,
  MONEY_CARD_ACTION,
  PAUSE_CARD_ACTION,
  observationDue,
  pairSpans,
  readExecutedReview,
  reviewExperienceKindLabel,
  reviewVerdict,
  reviewWindowKindFor,
  type ReviewAction,
  type ReviewSource,
  type WindowSpan,
} from '../executed-review'

const SOURCE: ReviewSource = {
  prescriptionId: 'rx-1', version: 2, goalId: 'goal-1', planId: 'plan-1', planHash: 'hash-1', approvedOn: '2026-11-01',
}

function action(kind: 'budget' | 'pause', payload: Record<string, unknown>): ReviewAction {
  const pauseCard = kind === 'pause'
  return {
    id: pauseCard ? 'pause-1' : 'budget-1',
    client_id: 'client-1',
    action_type: pauseCard ? PAUSE_CARD_ACTION : BUDGET_CARD_ACTION,
    expected_metric: pauseCard ? 'ads.account.spend' : 'ads.account.cpa',
    executed_at: '2026-01-01T00:00:00.000Z',
    payload,
  }
}

function budget(extra: Record<string, unknown> = {}): ReviewAction {
  return action('budget', {
    status: 'executed', direction: 'down', observationWindowDays: 7,
    order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 7, adsetId: 'set-a' },
    lock: SOURCE, ...extra,
  })
}

function pause(extra: Record<string, unknown> = {}): ReviewAction {
  return action('pause', {
    status: 'executed',
    order: { metric: 'ads.account.spend', direction: 'pause', observationDays: 7, adsetId: 'set-a' },
    source: SOURCE, ...extra,
  })
}

describe('executed card review', () => {
  it('reads money and campaign pause cards into one shape', () => {
    const money = {
      id: 'money-1',
      client_id: 'client-1',
      action_type: MONEY_CARD_ACTION,
      expected_metric: 'ads.account.spend',
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        kind: 'money_card',
        lane: 'budget',
        status: 'executed',
        wroteMeta: true,
        source: 'scorecard_down',
        entityId: 'set-b',
        cardRunId: 'card-money-1',
        subjectKey: 'budget-x',
        beforeCents: 2000,
        afterCents: 1600,
      },
    } satisfies ReviewAction
    const camp = {
      id: 'camp-1',
      client_id: 'client-1',
      action_type: CAMPAIGN_PAUSE_ACTION,
      expected_metric: 'ads.account.cost_per_lead',
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        status: 'executed',
        kind: 'pause',
        wrote: true,
        campaign_id: 'camp-a',
        cardRunId: 'card-camp-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        before: { status: 'ACTIVE' },
        after: { status: 'PAUSED' },
      },
    } satisfies ReviewAction
    expect(reviewWindowKindFor(MONEY_CARD_ACTION, money.payload as Record<string, unknown>)).toBe('money_budget')
    expect(reviewExperienceKindLabel(MONEY_CARD_ACTION, money.payload as Record<string, unknown>)).toBe('成绩单减预算')
    expect(readExecutedReview(money)).toMatchObject({ kind: 'ready', review: { direction: 'down', objectId: 'set-b' } })
    expect(readExecutedReview(camp)).toMatchObject({
      kind: 'ready',
      review: { direction: 'pause', objectId: 'camp-a', observationWindowDays: CAMPAIGN_PAUSE_WINDOW_UNSET },
    })
  })

  it('keeps a written campaign observation window and leaves a blank one unset', () => {
    const blank = {
      id: 'camp-blank',
      client_id: 'client-1',
      action_type: CAMPAIGN_PAUSE_ACTION,
      expected_metric: 'ads.account.cost_per_lead',
      executed_at: '2026-01-01T00:00:00.000Z',
      payload: {
        status: 'executed',
        kind: 'pause',
        wrote: true,
        campaign_id: 'camp-a',
        cardRunId: 'card-camp-blank',
      },
    } satisfies ReviewAction
    const written = {
      ...blank,
      id: 'camp-written',
      payload: { ...blank.payload, observationDays: 4 },
    } satisfies ReviewAction
    expect(readExecutedReview(blank)).toMatchObject({
      kind: 'ready',
      review: { observationWindowDays: CAMPAIGN_PAUSE_WINDOW_UNSET },
    })
    expect(readExecutedReview(written)).toMatchObject({
      kind: 'ready',
      review: { observationWindowDays: 4 },
    })
  })

  it('reads budget and pause into one shape', () => {
    const down = readExecutedReview(budget())
    const stopped = readExecutedReview(pause())
    expect(down).toMatchObject({ kind: 'ready', review: { direction: 'down', observationWindowDays: 7, objectId: 'set-a', source: SOURCE } })
    expect(stopped).toMatchObject({ kind: 'ready', review: { direction: 'pause', observationWindowDays: 7, metric: 'ads.account.spend' } })
  })

  it('ignores cards that did not really execute', () => {
    for (const status of ['holding', 'awaiting', 'writing', 'failed', 'declined']) {
      expect(readExecutedReview(budget({ status })).kind).toBe('not_executed')
      expect(readExecutedReview(pause({ status })).kind).toBe('not_executed')
    }
  })

  it('does not invent a window, clamp one, or fill a missing source', () => {
    const missingWindow = budget()
    const payload = missingWindow.payload as Record<string, unknown>
    delete payload.observationWindowDays
    delete (payload.order as Record<string, unknown>).observationWindowDays
    expect(readExecutedReview(missingWindow).kind).toBe('incomplete')
    expect(readExecutedReview(pause({ source: null })).kind).toBe('incomplete')
    expect(readExecutedReview(budget({
      observationWindowDays: 29,
      order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 29, adsetId: 'set-a' },
    })).kind).toBe('incomplete')
    expect(readExecutedReview(budget({
      review: { metric: 'ads.account.cpa', direction: 'up', observationWindowDays: 7, objectId: 'set-a', source: SOURCE },
    })).kind).toBe('incomplete')
  })

  it('pairs only the same object inside an overlapping window', () => {
    const first: WindowSpan = {
      actionId: 'a', clientId: 'client-1', objectId: 'set-a',
      executedAt: '2026-01-01T00:00:00.000Z', observationWindowDays: 7,
    }
    const marks = pairSpans([
      first,
      { ...first, actionId: 'b', executedAt: '2026-01-04T00:00:00.000Z' },
      { ...first, actionId: 'c', executedAt: '2026-02-01T00:00:00.000Z' },
      { ...first, actionId: 'd', objectId: 'set-b' },
      { ...first, actionId: 'e', clientId: 'client-2', executedAt: '2026-01-04T00:00:00.000Z' },
    ])
    expect([marks.get('a'), marks.get('b'), marks.get('c'), marks.get('d'), marks.get('e')]).toEqual([
      'overlap', 'overlap', 'clear', 'clear', 'clear',
    ])
    expect(observationDue('2026-01-01T00:00:00.000Z', 7, new Date('2026-01-02T00:00:00.000Z'))).toBe(false)
    expect(observationDue('2026-01-01T00:00:00.000Z', 7, new Date('2026-02-01T00:00:00.000Z'))).toBe(true)
    expect(reviewVerdict('clear').verdict).toBe('inconclusive')
    expect(reviewVerdict('overlap').verdict).toBe('inconclusive')
  })
})
