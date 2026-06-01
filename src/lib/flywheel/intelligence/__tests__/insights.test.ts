/**
 * Tests for insights.ts rule engine — Phase 22.B.4.
 */

import { generateInsights, type AnomalySignalRow } from '../insights'
import type { TrendSeries } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSeries(overrides: Partial<TrendSeries> = {}): TrendSeries {
  return {
    metricKey:   'seo.gsc.clicks',
    flywheel:    'seo',
    label:       'GSC Clicks',
    unit:        'count',
    direction:   'higher_is_better',
    granularity: 'day',
    points:      [
      { ts: '2026-05-25T00:00:00.000Z', value: 100 },
      { ts: '2026-06-01T00:00:00.000Z', value: 160 },
    ],
    deltaPct7d:  60,    // +60% → fires positive-momentum
    deltaPct28d: null,
    hasDataGap:  false,
    ...overrides,
  }
}

function makeSignal(overrides: Partial<AnomalySignalRow> = {}): AnomalySignalRow {
  return {
    id:              'sig-1',
    client_id:       'client-abc',
    flywheel:        'seo',
    metric_key:      'seo.gsc.clicks',
    rule_id:         'seo-clicks-drop',
    severity:        'high',
    current_value:   50,
    reference_value: 100,
    delta_pct:       -50,
    description:     'GSC clicks dropped significantly',
    created_at:      '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const CLIENT_ID = 'client-abc'

// ─── positive-momentum ────────────────────────────────────────────────────────

describe('positive-momentum rule', () => {
  test('fires when higher_is_better metric rises > 15%', () => {
    const series = makeSeries({ deltaPct7d: 20 })
    const cards  = generateInsights([series], [], CLIENT_ID)
    const card   = cards.find(c => c.sourceRule === 'positive-momentum')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('positive')
    expect(card?.deltaPct).toBe(20)
  })

  test('does NOT fire when delta < threshold (9%)', () => {
    const series = makeSeries({ deltaPct7d: 9 })
    const cards  = generateInsights([series], [], CLIENT_ID)
    expect(cards.find(c => c.sourceRule === 'positive-momentum')).toBeUndefined()
  })

  test('does NOT fire when deltaPct7d is null (insufficient data)', () => {
    const series = makeSeries({ deltaPct7d: null })
    const cards  = generateInsights([series], [], CLIENT_ID)
    expect(cards.find(c => c.sourceRule === 'positive-momentum')).toBeUndefined()
  })

  test('fires for lower_is_better metric improving (delta <= -15%)', () => {
    const series = makeSeries({
      metricKey:  'seo.gsc.avg_position',
      label:      'Avg Position',
      unit:       'rank',
      direction:  'lower_is_better',
      deltaPct7d: -20,   // position went from 10 to 8 = improvement
    })
    const cards = generateInsights([series], [], CLIENT_ID)
    const card  = cards.find(c => c.sourceRule === 'positive-momentum')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('positive')
  })
})

// ─── concerning-decline ───────────────────────────────────────────────────────

describe('concerning-decline rule', () => {
  test('fires when higher_is_better metric drops > 15%', () => {
    const series = makeSeries({ deltaPct7d: -25 })
    const cards  = generateInsights([series], [], CLIENT_ID)
    const card   = cards.find(c => c.sourceRule === 'concerning-decline')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('medium')
    expect(card?.deltaPct).toBe(-25)
  })

  test('does NOT fire when drop is within threshold (-5%)', () => {
    const series = makeSeries({ deltaPct7d: -5 })
    const cards  = generateInsights([series], [], CLIENT_ID)
    expect(cards.find(c => c.sourceRule === 'concerning-decline')).toBeUndefined()
  })

  test('fires for lower_is_better metric worsening (delta >= +15%)', () => {
    const series = makeSeries({
      direction:  'lower_is_better',
      deltaPct7d: 20,   // position went from 5 to 6 = worse
    })
    const cards = generateInsights([series], [], CLIENT_ID)
    const card  = cards.find(c => c.sourceRule === 'concerning-decline')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('medium')
  })
})

// ─── data-gap rule ────────────────────────────────────────────────────────────

describe('data-gap rule', () => {
  test('fires when hasDataGap is true', () => {
    const series = makeSeries({ hasDataGap: true, deltaPct7d: null })
    const cards  = generateInsights([series], [], CLIENT_ID)
    const card   = cards.find(c => c.sourceRule === 'data-gap')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('low')
  })

  test('does NOT fire when hasDataGap is false', () => {
    const series = makeSeries({ hasDataGap: false })
    const cards  = generateInsights([series], [], CLIENT_ID)
    expect(cards.find(c => c.sourceRule === 'data-gap')).toBeUndefined()
  })
})

// ─── anomaly-bridge rule ──────────────────────────────────────────────────────

describe('anomaly-bridge rule', () => {
  test('converts anomaly signal to InsightCard', () => {
    const signal = makeSignal()
    const cards  = generateInsights([], [signal], CLIENT_ID)
    const card   = cards.find(c => c.sourceRule === 'seo-clicks-drop')
    expect(card).toBeDefined()
    expect(card?.severity).toBe('high')
    expect(card?.currentValue).toBe(50)
    expect(card?.deltaPct).toBe(-50)
    expect(card?.metricKey).toBe('seo.gsc.clicks')
  })

  test('multiple signals produce multiple InsightCards', () => {
    const signals = [
      makeSignal({ rule_id: 'rule-a', id: 'sig-a' }),
      makeSignal({ rule_id: 'rule-b', id: 'sig-b' }),
    ]
    const cards = generateInsights([], signals, CLIENT_ID)
    expect(cards).toHaveLength(2)
  })
})

// ─── combined + sorting ───────────────────────────────────────────────────────

describe('generateInsights — sorting and deduplication', () => {
  test('cards are sorted high → positive → medium → low', () => {
    const anomaly = makeSignal({ severity: 'high' })
    const seriesWithGap    = makeSeries({ hasDataGap: true, deltaPct7d: null })
    const seriesWithGrowth = makeSeries({ metricKey: 'ga4.sessions', deltaPct7d: 20 })

    const cards = generateInsights([seriesWithGap, seriesWithGrowth], [anomaly], CLIENT_ID)
    const severities = cards.map(c => c.severity)

    // high must come before positive must come before medium must come before low
    const order = ['high', 'positive', 'medium', 'low']
    let lastIdx = -1
    for (const sev of severities) {
      const idx = order.indexOf(sev)
      if (idx >= 0) {
        expect(idx).toBeGreaterThanOrEqual(lastIdx)
        lastIdx = idx
      }
    }
  })

  test('duplicate card IDs are deduplicated', () => {
    // Same signal passed twice
    const signal = makeSignal()
    const cards  = generateInsights([], [signal, signal], CLIENT_ID)
    // anomaly-bridge IDs are based on client + rule_id + date — same row dedupes
    const ids = cards.map(c => c.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('empty series and empty signals returns empty array', () => {
    expect(generateInsights([], [], CLIENT_ID)).toEqual([])
  })
})

// ─── card shape assertions ────────────────────────────────────────────────────

describe('InsightCard shape', () => {
  test('positive-momentum card has all required fields', () => {
    const card = generateInsights([makeSeries({ deltaPct7d: 20 })], [], CLIENT_ID)
      .find(c => c.sourceRule === 'positive-momentum')!

    expect(typeof card.id).toBe('string')
    expect(card.id.length).toBeGreaterThan(0)
    expect(typeof card.headline).toBe('string')
    expect(typeof card.body).toBe('string')
    expect(typeof card.asOf).toBe('string')
  })
})
