/**
 * Tests for the data-shaping and persistence-mapping helpers.
 *
 * The pure judgement is covered by replay.test.ts against real history; this
 * file covers the plumbing that feeds it, where the mistakes are quieter:
 * double-counting spend, contaminated averages, and losing facts on the way
 * into a table that has no column for them.
 */

import { describe, it, expect } from 'vitest'
import {
  groupAdHistories,
  averageRecentDailySpend,
  resolveContentExpectation,
  toLegacyRow,
  toWatcherFields,
  extractEntityTag,
} from './WatcherJob'
import type { WatchSignal } from './watchers/types'

describe('groupAdHistories', () => {
  const rows = [
    { entity_id: 'c1', entity_name: 'Campaign One', insight_date: '2026-07-02', spend: '10.5', results: 2, leads: 1, impressions: 100 },
    { entity_id: 'c1', entity_name: 'Campaign One', insight_date: '2026-07-01', spend: '20', results: 4, leads: 2, impressions: 200 },
    { entity_id: 'c2', entity_name: 'Campaign Two', insight_date: '2026-07-01', spend: '5', results: 0, leads: 0, impressions: 50 },
  ]

  it('splits rows into one history per campaign', () => {
    const histories = groupAdHistories(rows)

    expect(histories).toHaveLength(2)
    expect(histories.map(h => h.entityId).sort()).toEqual(['c1', 'c2'])
  })

  it('sorts each history oldest first, whatever order the rows arrived in', () => {
    // Every rule indexes days[length-1] as "the latest". Unsorted input would
    // silently judge the wrong day.
    const [c1] = groupAdHistories(rows).filter(h => h.entityId === 'c1')

    expect(c1.days.map(d => d.insightDate)).toEqual(['2026-07-01', '2026-07-02'])
  })

  it('parses numeric strings, because Postgres numerics arrive as strings', () => {
    const [c1] = groupAdHistories(rows).filter(h => h.entityId === 'c1')

    expect(c1.days[0].spend).toBe(20)
    expect(typeof c1.days[0].spend).toBe('number')
  })

  it('coerces null metrics to 0 rather than NaN', () => {
    const histories = groupAdHistories([
      { entity_id: 'c1', entity_name: 'x', insight_date: '2026-07-01', spend: null, results: null, leads: null, impressions: null },
    ])

    expect(histories[0].days[0].spend).toBe(0)
    expect(histories[0].days[0].results).toBe(0)
  })

  it('falls back to the campaign name when entity_id is missing', () => {
    const histories = groupAdHistories([
      { entity_id: null, entity_name: 'Nameless', insight_date: '2026-07-01', spend: 1, results: 0, leads: 0, impressions: 0 },
    ])

    expect(histories[0].entityId).toBe('Nameless')
  })

  it('trims timestamps to plain dates', () => {
    const histories = groupAdHistories([
      { entity_id: 'c1', entity_name: 'x', insight_date: '2026-07-01T00:00:00Z', spend: 1, results: 0, leads: 0, impressions: 0 },
    ])

    expect(histories[0].days[0].insightDate).toBe('2026-07-01')
  })
})

describe('averageRecentDailySpend', () => {
  const history = (days: [string, number][]) => ({
    entityId: 'c',
    entityName: 'c',
    days: days.map(([insightDate, spend]) => ({
      insightDate,
      spend,
      results: 0,
      leads: 0,
      impressions: 0,
    })),
  })

  it('averages across the last seven days that actually spent', () => {
    const result = averageRecentDailySpend([
      history([['2026-07-01', 10], ['2026-07-02', 20], ['2026-07-03', 30]]),
    ])

    expect(result).toBe(20)
  })

  it('sums same-day spend across campaigns before averaging', () => {
    // This is a client-level figure. Averaging per campaign and adding would
    // understate what the client is actually spending per day.
    const result = averageRecentDailySpend([
      history([['2026-07-01', 10]]),
      history([['2026-07-01', 30]]),
    ])

    expect(result).toBe(40)
  })

  it('ignores zero-spend days instead of dragging the average down', () => {
    const result = averageRecentDailySpend([
      history([['2026-07-01', 100], ['2026-07-02', 0], ['2026-07-03', 0]]),
    ])

    expect(result).toBe(100)
  })

  it('returns 0 when nothing ever spent, so no money claim gets invented', () => {
    expect(averageRecentDailySpend([])).toBe(0)
    expect(averageRecentDailySpend([history([['2026-07-01', 0]])])).toBe(0)
  })

  it('keeps only the seven most recent spending days', () => {
    const days: [string, number][] = [
      ['2026-07-01', 1000],
      ['2026-07-02', 10], ['2026-07-03', 10], ['2026-07-04', 10], ['2026-07-05', 10],
      ['2026-07-06', 10], ['2026-07-07', 10], ['2026-07-08', 10],
    ]

    // The 1000 outlier falls outside the window and must not be included.
    expect(averageRecentDailySpend([history(days)])).toBe(10)
  })
})

describe('resolveContentExpectation', () => {
  it('treats a client with production history as content-tracked', () => {
    expect(resolveContentExpectation('2026-07-14')).toBe(true)
  })

  it('treats a client with no production history as not on a content line', () => {
    // This is what keeps Type B (30 Kiteroa, Parkhomes) out of content alerts.
    expect(resolveContentExpectation(null)).toBe(false)
  })
})

// ── Persistence mapping ───────────────────────────────────────────────────────

const SIGNAL: WatchSignal = {
  clientId: 'c0000000-0000-0000-0000-000000000000',
  clientName: 'CTS Tours NZ',
  watcherId: 'ad-delivery',
  ruleId: 'ad-delivery-dark',
  flywheel: 'ads',
  severity: 'high',
  entityId: '1202110',
  entityName: 'CTS — Lead Form — Reborn — 20260624',
  whatChanged: '"CTS — Lead Form — Reborn — 20260624" has spent nothing since 2026-07-20 (7 days).',
  moneyImpactAud: 529.3,
  moneyBasis: 'Budget that stopped deploying: $75.61/day x 7 dark days.',
  daysOngoing: 7,
  disposition: 'needs_approval',
  dispositionReason: 'Needs a human: spends money + customer-facing.',
  remedy: { spendsMoney: true, customerFacing: true, hardToReverse: false },
  observedThrough: '2026-07-20',
}

describe('toLegacyRow', () => {
  it('keeps all three human facts in description when the new columns are absent', () => {
    // anomaly_signals has no column for money or duration until the migration
    // lands. Losing them on the way in would defeat the entire feature.
    const row = toLegacyRow(SIGNAL)
    const description = row.description as string

    expect(description).toContain('spent nothing since 2026-07-20')
    expect(description).toContain('A$529.3')
    expect(description).toContain('已持续 7 天')
    expect(description).toContain('需人工批准')
  })

  it('marks an unverified finding so nobody reads it as a confirmed fact', () => {
    const row = toLegacyRow({ ...SIGNAL, requiresManualVerification: true })

    expect(row.description as string).toContain('未经系统验证')
  })

  it('labels an auto-eligible finding as such', () => {
    const row = toLegacyRow({ ...SIGNAL, disposition: 'auto' })

    expect(row.description as string).toContain('可自动')
  })

  it('satisfies the NOT NULL legacy columns', () => {
    // current_value / reference_value / delta_pct are NOT NULL on the table.
    const row = toLegacyRow(SIGNAL)

    for (const column of ['client_id', 'flywheel', 'metric_key', 'rule_id', 'severity', 'current_value', 'reference_value', 'delta_pct', 'description', 'status']) {
      expect(row[column]).not.toBeUndefined()
      expect(row[column]).not.toBeNull()
    }
  })

  it('namespaces metric_key by watcher so watcher rows are separable from rule-engine rows', () => {
    expect(toLegacyRow(SIGNAL).metric_key).toBe('watcher.ad-delivery')
  })
})

describe('toWatcherFields', () => {
  it('maps every fact onto its own column for post-migration querying', () => {
    const fields = toWatcherFields(SIGNAL)

    expect(fields.money_impact_aud).toBe(529.3)
    expect(fields.days_ongoing).toBe(7)
    expect(fields.disposition).toBe('needs_approval')
    expect(fields.entity_id).toBe('1202110')
    expect(fields.observed_through).toBe('2026-07-20')
  })

  it('defaults requires_manual_verification to false rather than undefined', () => {
    // The column is NOT NULL DEFAULT false; undefined would fail the insert.
    expect(toWatcherFields(SIGNAL).requires_manual_verification).toBe(false)
  })
})

describe('extractEntityTag', () => {
  it('recovers the campaign name from a legacy description for dedup', () => {
    expect(extractEntityTag(toLegacyRow(SIGNAL).description as string)).toBe(
      'CTS — Lead Form — Reborn — 20260624'
    )
  })

  it('returns an empty tag for descriptions with no quoted entity', () => {
    expect(extractEntityTag('No new content for this client.')).toBe('')
    expect(extractEntityTag(null)).toBe('')
  })

  it('distinguishes two campaigns so both get reported, not just the first', () => {
    // Deduping on rule_id alone would report one dark campaign and swallow the
    // other — two separate problems collapsing into one alert.
    const other = { ...SIGNAL, entityName: 'CTS - Retargeting - Warm - 20260707' }
    other.whatChanged = '"CTS - Retargeting - Warm - 20260707" has spent nothing since 2026-07-20.'

    expect(extractEntityTag(toLegacyRow(SIGNAL).description as string)).not.toBe(
      extractEntityTag(toLegacyRow(other).description as string)
    )
  })
})
