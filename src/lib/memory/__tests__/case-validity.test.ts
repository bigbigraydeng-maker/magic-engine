import { describe, it, expect } from 'vitest'
import {
  classifyActionCase,
  isGatedFlywheel,
  RULE_BASED_REASONS,
  type CaseAction,
  type CaseOutcome,
} from '../case-validity'

const NOW = new Date('2026-09-26T00:00:00Z')

function action(over: Partial<CaseAction> = {}): CaseAction {
  return {
    id: 'a1',
    flywheel: 'seo',
    executed_at: '2026-08-01T00:00:00Z',
    expected_metric: 'seo.gsc.page_clicks',
    zhuge_session_key: null,
    payload_source: null,
    execution_item_id: 'card-1',
    action_run_id: null,
    ...over,
  }
}

function outcome(over: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    id: 'o1',
    action_id: 'a1',
    metric_key: 'seo.gsc.page_clicks',
    window_days: 28,
    verdict: 'confirmed',
    confidence: 0.8,
    computed_at: '2026-09-25T00:00:00Z',
    ...over,
  }
}

const run = (a: CaseAction | null, outcomes: CaseOutcome[]) =>
  classifyActionCase({ action: a, outcomes, now: NOW })

describe('classifyActionCase', () => {
  it('reports action_missing when there is no action row', () => {
    expect(run(null, [outcome()])).toEqual({ kind: 'invalid', reason: 'action_missing' })
  })

  it('reports no_execution_evidence for an unexecuted Zhuge suggestion', () => {
    const a = action({ zhuge_session_key: 's1', execution_item_id: null })
    expect(run(a, [outcome()])).toEqual({
      kind: 'invalid',
      reason: 'no_execution_evidence',
    })
  })

  it('reports no_execution_evidence for an unexecuted proactive signal', () => {
    const a = action({ payload_source: 'proactive_signal', execution_item_id: null })
    expect(run(a, [outcome()])).toEqual({
      kind: 'invalid',
      reason: 'no_execution_evidence',
    })
  })

  it('reports no_outcome when the action has no outcome rows', () => {
    expect(run(action(), [])).toEqual({ kind: 'invalid', reason: 'no_outcome' })
  })

  it('reports direction_unknown for an ads action', () => {
    const a = action({ flywheel: 'ads', expected_metric: 'ads.account.cost_per_lead' })
    const o = outcome({ metric_key: 'ads.account.cost_per_lead' })
    expect(run(a, [o])).toEqual({ kind: 'invalid', reason: 'direction_unknown' })
  })

  it('reports site_level_metric for a domain-scope reading', () => {
    const a = action({ expected_metric: 'seo.gsc.clicks' })
    const o = outcome({ metric_key: 'seo.gsc.clicks', verdict: 'confirmed', confidence: 0.9 })
    expect(run(a, [o])).toEqual({ kind: 'invalid', reason: 'site_level_metric' })
  })

  it('reports site_level_metric even when the row is stale (rule wins over staleness)', () => {
    const a = action({ expected_metric: 'seo.domain.organic_traffic' })
    const o = outcome({
      metric_key: 'seo.domain.organic_traffic',
      computed_at: '2026-08-01T00:00:00Z',
    })
    expect(run(a, [o])).toEqual({ kind: 'invalid', reason: 'site_level_metric' })
  })

  it('reports stale when no outcome row was recomputed recently', () => {
    const o = outcome({ computed_at: '2026-09-10T00:00:00Z' })
    expect(run(action(), [o])).toEqual({ kind: 'invalid', reason: 'stale' })
  })

  it('reports immature when the representative window has not ended', () => {
    const a = action({ executed_at: '2026-09-20T00:00:00Z' })
    const o = outcome({ window_days: 28 })
    expect(run(a, [o])).toEqual({ kind: 'invalid', reason: 'immature' })
  })

  it('is valid proven for a fresh, matured, confirmed reading', () => {
    expect(run(action(), [outcome()])).toMatchObject({ kind: 'valid', side: 'proven' })
  })

  it('is valid failed for a fresh, matured, reversed reading', () => {
    const o = outcome({ verdict: 'reversed', confidence: 0.7 })
    expect(run(action(), [o])).toMatchObject({ kind: 'valid', side: 'failed' })
  })

  it('reports no_strong_verdict below the confidence floor', () => {
    const o = outcome({ verdict: 'confirmed', confidence: 0.5 })
    expect(run(action(), [o])).toEqual({ kind: 'invalid', reason: 'no_strong_verdict' })
  })

  it('reports no_strong_verdict for an inconclusive verdict', () => {
    const o = outcome({ verdict: 'inconclusive', confidence: 0.9 })
    expect(run(action(), [o])).toEqual({ kind: 'invalid', reason: 'no_strong_verdict' })
  })

  it('lets the promised metric represent the action', () => {
    const rows = [
      outcome({ id: 'o1', metric_key: 'seo.gsc.page_impressions', verdict: 'reversed' }),
      outcome({ id: 'o2', metric_key: 'seo.gsc.page_clicks', verdict: 'confirmed' }),
    ]
    const result = run(action(), rows)
    expect(result).toMatchObject({ kind: 'valid', side: 'proven' })
    if (result.kind !== 'valid') throw new Error('expected valid')
    expect(result.representative.id).toBe('o2')
  })

  it('filters to fresh rows before folding', () => {
    const rows = [
      outcome({
        id: 'o1',
        metric_key: 'seo.gsc.page_clicks',
        verdict: 'confirmed',
        computed_at: '2026-09-01T00:00:00Z',
      }),
      outcome({
        id: 'o2',
        metric_key: 'seo.gsc.page_impressions',
        verdict: 'reversed',
        confidence: 0.9,
      }),
    ]
    const result = run(action(), rows)
    expect(result).toMatchObject({ kind: 'valid', side: 'failed' })
    if (result.kind !== 'valid') throw new Error('expected valid')
    expect(result.representative.id).toBe('o2')
  })

  it('keeps an unreadable computed_at as fresh', () => {
    const o = outcome({ computed_at: 'not-a-date' })
    expect(run(action(), [o])).toMatchObject({ kind: 'valid', side: 'proven' })
  })
})

describe('isGatedFlywheel', () => {
  it('gates seo and ads', () => {
    expect(isGatedFlywheel('seo')).toBe(true)
    expect(isGatedFlywheel('ads')).toBe(true)
  })

  it('does not gate geo, social or null', () => {
    expect(isGatedFlywheel('geo')).toBe(false)
    expect(isGatedFlywheel('social')).toBe(false)
    expect(isGatedFlywheel(null)).toBe(false)
  })
})

describe('RULE_BASED_REASONS', () => {
  it('contains exactly the five rule-based reasons', () => {
    expect([...RULE_BASED_REASONS].sort()).toEqual(
      [
        'action_missing',
        'direction_unknown',
        'no_execution_evidence',
        'no_outcome',
        'site_level_metric',
      ].sort(),
    )
    expect(RULE_BASED_REASONS.size).toBe(5)
  })

  it('excludes the attribution-dependent reasons', () => {
    expect(RULE_BASED_REASONS.has('stale')).toBe(false)
    expect(RULE_BASED_REASONS.has('no_strong_verdict')).toBe(false)
    expect(RULE_BASED_REASONS.has('immature')).toBe(false)
  })
})
