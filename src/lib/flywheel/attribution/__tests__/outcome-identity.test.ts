import { describe, it, expect } from 'vitest'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import {
  GSC_EVALUATOR_METRIC_KEYS,
  MIN_DECIDED_FOR_RATE,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  buildOutcomeKey,
  effectiveVerdict,
  isDecidedVerdict,
  isSiteLevelUnattributable,
  keepOneCasePerAction,
  keepOneMeasurementPerAction,
  resolveStaleEvaluatorKeys,
} from '../outcome-identity'

describe('buildOutcomeKey', () => {
  it('matches the outcome_key generated column expression', () => {
    expect(buildOutcomeKey('a1', 'seo.gsc.clicks', 28)).toBe('a1:seo.gsc.clicks:28')
  })

  it('distinguishes the same metric measured over different windows', () => {
    expect(buildOutcomeKey('a1', 'seo.gsc.clicks', 14)).not.toBe(
      buildOutcomeKey('a1', 'seo.gsc.clicks', 28),
    )
  })
})

describe('resolveStaleEvaluatorKeys', () => {
  it('returns the owned keys that were not produced this run', () => {
    const stale = resolveStaleEvaluatorKeys(
      GSC_EVALUATOR_METRIC_KEYS,
      ['seo.gsc.page_clicks', 'seo.gsc.page_impressions', 'seo.gsc.page_avg_position'],
    )
    expect(stale.sort()).toEqual([
      'seo.gsc.avg_position',
      'seo.gsc.clicks',
      'seo.gsc.impressions',
    ])
  })

  it('returns nothing when every owned key was produced', () => {
    expect(resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, [...GSC_EVALUATOR_METRIC_KEYS]))
      .toEqual([])
  })

  it('retires nothing when the run produced nothing — a barren run is not a refutation', () => {
    expect(resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, [])).toEqual([])
  })

  it('never reports a key the evaluator does not own', () => {
    const stale = resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, ['seo.gsc.clicks'])
    expect(stale).not.toContain('seo.domain.organic_traffic')
    expect(stale.every(k => GSC_EVALUATOR_METRIC_KEYS.includes(k))).toBe(true)
  })
})

describe('evaluator vocabulary', () => {
  it('keeps the two writers on distinct labels', () => {
    expect(OUTCOME_EVALUATOR.FLYWHEEL_METRICS).not.toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('excludes evaluator_key from the natural key', () => {
    // Two evaluators answering the same (action, metric, window) question are
    // competing answers to one fact, not two facts.
    expect(OUTCOME_CONFLICT_TARGET).not.toContain('evaluator_key')
  })
})

// ── One action is one piece of evidence, however many windows it has ────────
//
// Deferred actions are computed at the bridge's cadence AND at pass 1's window,
// so counting rows makes one action look like two. `industry_benchmarks` needs
// three samples before it will write a client-facing number, and Huatuo reports
// "client cases" from the same table — both would be inflated 2x.

describe('keepOneMeasurementPerAction', () => {
  const row = (action_id: string, metric_key: string, window_days: number | null) =>
    ({ action_id, metric_key, window_days })

  it('collapses the two windows of one action-metric into one measurement', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.clicks', 14),
    ])

    expect(kept).toHaveLength(1)
  })

  it('keeps the longest window — the most mature observation', () => {
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 14),
      row('a1', 'seo.gsc.clicks', 28),
    ])[0].window_days).toBe(28)

    // …and does not depend on row order.
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.clicks', 14),
    ])[0].window_days).toBe(28)
  })

  it('keeps different metrics of the same action apart', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.impressions', 28),
      row('a1', 'seo.gsc.avg_position', 28),
    ])

    expect(kept).toHaveLength(3)
  })

  it('keeps different actions apart', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a2', 'seo.gsc.clicks', 28),
    ])

    expect(kept).toHaveLength(2)
  })

  it('does not let two dual-window actions look like four samples', () => {
    // The concrete failure: MIN_SAMPLE_THRESHOLD is 3, so four rows from two
    // actions would cross it and write a benchmark on half the real evidence.
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28), row('a1', 'seo.gsc.clicks', 14),
      row('a2', 'seo.gsc.clicks', 28), row('a2', 'seo.gsc.clicks', 14),
    ])

    expect(kept).toHaveLength(2)
    expect(kept.every(r => r.window_days === 28)).toBe(true) // no mixed windows
  })

  it('prefers a real window over a null one', () => {
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', null),
      row('a1', 'seo.gsc.clicks', 14),
    ])[0].window_days).toBe(14)
  })

  it('is a no-op on an already-deduped set', () => {
    const rows = [row('a1', 'seo.gsc.clicks', 28), row('a2', 'seo.gsc.impressions', 14)]
    expect(keepOneMeasurementPerAction(rows)).toHaveLength(2)
  })
})

// ── One action is one case, however many metrics it moved ──────────────────

describe('keepOneCasePerAction', () => {
  const r = (
    action_id: string,
    metric_key: string,
    window_days: number | null,
    expected_metric: string | null = null,
  ) => ({ action_id, metric_key, window_days, expected_metric })

  it('folds one action three metrics into a single case', () => {
    const kept = keepOneCasePerAction([
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.impressions', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.avg_position', 28, 'seo.gsc.clicks'),
    ])

    expect(kept).toHaveLength(1)
  })

  it('represents the case with the metric the action promised', () => {
    const kept = keepOneCasePerAction([
      r('a1', 'seo.gsc.avg_position', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
    ])

    expect(kept[0].metric_key).toBe('seo.gsc.clicks')
  })

  it('does not depend on row order', () => {
    const forward = keepOneCasePerAction([
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.impressions', 28, 'seo.gsc.clicks'),
    ])
    const reverse = keepOneCasePerAction([
      r('a1', 'seo.gsc.impressions', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
    ])

    expect(forward[0].metric_key).toBe(reverse[0].metric_key)
  })

  it('falls back to the BUSINESS metric when the promise was never measured', () => {
    // This used to prefer the longest window, with `metric_key` alphabetical as
    // the last tiebreak — which handed the action to `seo.gsc.avg_position`
    // purely because "a" sorts before "c". An action whose clicks confirmed but
    // whose ranking slipped then read as a reversal everywhere downstream.
    //
    // Comparing windows across DIFFERENT metrics was never like-for-like
    // anyway: `keepOneMeasurementPerAction` has already folded each metric to
    // its own most mature window before this runs, so the only question left is
    // which metric states the result. (Codex P2, round 30.)
    const kept = keepOneCasePerAction([
      r('a1', 'seo.gsc.clicks', 14, 'seo.domain.organic_traffic'),
      r('a1', 'seo.gsc.impressions', 28, 'seo.domain.organic_traffic'),
    ])

    expect(kept).toHaveLength(1)
    expect(kept[0].metric_key).toBe('seo.gsc.clicks')
  })

  it('never lets avg_position speak for an action that has a clicks reading', () => {
    // The exact shape the fold used to get wrong.
    const kept = keepOneCasePerAction([
      r('a1', 'seo.gsc.avg_position', 28, 'seo.domain.organic_traffic'),
      r('a1', 'seo.gsc.clicks', 28, 'seo.domain.organic_traffic'),
    ])

    expect(kept[0].metric_key).toBe('seo.gsc.clicks')
  })

  it('still prefers the most mature window between equally representative metrics', () => {
    // Two unlisted metrics rank the same, so window maturity decides — the
    // business order narrows the tie, it does not replace the rest of it.
    const kept = keepOneCasePerAction([
      r('a1', 'custom.alpha', 14, null),
      r('a1', 'custom.beta', 28, null),
    ])

    expect(kept[0].window_days).toBe(28)
  })

  it('is deterministic when nothing else breaks the tie', () => {
    const forward = keepOneCasePerAction([
      r('a1', 'custom.beta', 28, null),
      r('a1', 'custom.alpha', 28, null),
    ])
    const reversed = keepOneCasePerAction([
      r('a1', 'custom.alpha', 28, null),
      r('a1', 'custom.beta', 28, null),
    ])

    // Same answer whichever order the rows arrived in.
    expect(forward[0].metric_key).toBe(reversed[0].metric_key)
    expect(forward[0].metric_key).toBe('custom.alpha')
  })

  it('keeps different actions apart', () => {
    expect(keepOneCasePerAction([
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
      r('a2', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
    ])).toHaveLength(2)
  })

  it('collapses windows as well as metrics — one action stays one case', () => {
    // The compounding case: 3 metrics x 2 windows = 6 rows for one action.
    const kept = keepOneCasePerAction([
      r('a1', 'seo.gsc.clicks', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.clicks', 14, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.impressions', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.impressions', 14, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.avg_position', 28, 'seo.gsc.clicks'),
      r('a1', 'seo.gsc.avg_position', 14, 'seo.gsc.clicks'),
    ])

    expect(kept).toHaveLength(1)
    expect(kept[0].metric_key).toBe('seo.gsc.clicks')
    expect(kept[0].window_days).toBe(28)
  })
})

describe('isSiteLevelUnattributable — whole-site metrics cannot judge one action', () => {
  it.each([
    'seo.gsc.clicks',
    'seo.gsc.impressions',
    'seo.gsc.avg_position',
    'seo.domain.organic_traffic',
    'seo.domain.organic_keywords',
    'seo.domain.authority_score',
    'seo.ga4.sessions',
    'seo.ga4.conversions',
  ])('%s is site-level', (key) => {
    expect(isSiteLevelUnattributable(key)).toBe(true)
  })

  it.each([
    'seo.gsc.page_clicks',
    'seo.gsc.page_impressions',
    'seo.gsc.page_avg_position',
    'seo.content.published_posts',
    'geo.query.mention_rate',
    'ads.spend',
    '',
  ])('%s is not site-level', (key) => {
    expect(isSiteLevelUnattributable(key)).toBe(false)
  })

  it('classifies every SEO metric key on purpose', () => {
    const siteLevel = Object.values(SEO_METRIC_KEY).filter(isSiteLevelUnattributable).sort()
    const attributable = Object.values(SEO_METRIC_KEY).filter((k) => !isSiteLevelUnattributable(k)).sort()
    // Only the page-scope Search Console keys and the published-post count stay attributable.
    expect(attributable).toEqual([
      'seo.content.published_posts',
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])
    expect(siteLevel.length).toBe(Object.values(SEO_METRIC_KEY).length - 4)
  })
})

describe('effectiveVerdict — readers count site-level rows as inconclusive', () => {
  it('turns an old site-level confirmed or reversed into inconclusive', () => {
    expect(effectiveVerdict({ metric_key: 'seo.gsc.clicks', verdict: 'confirmed' })).toBe('inconclusive')
    expect(effectiveVerdict({ metric_key: 'seo.domain.organic_traffic', verdict: 'reversed' })).toBe('inconclusive')
  })

  it('leaves page-level and other pillars untouched', () => {
    expect(effectiveVerdict({ metric_key: 'seo.gsc.page_clicks', verdict: 'confirmed' })).toBe('confirmed')
    expect(effectiveVerdict({ metric_key: 'ads.spend', verdict: 'reversed' })).toBe('reversed')
  })
})

describe('isDecidedVerdict / MIN_DECIDED_FOR_RATE', () => {
  it('only confirmed and reversed are decided', () => {
    expect(isDecidedVerdict('confirmed')).toBe(true)
    expect(isDecidedVerdict('reversed')).toBe(true)
    expect(isDecidedVerdict('inconclusive')).toBe(false)
    expect(isDecidedVerdict('refuted')).toBe(false)
  })

  it('needs at least three decided cases before a rate is shown', () => {
    expect(MIN_DECIDED_FOR_RATE).toBe(3)
  })
})
