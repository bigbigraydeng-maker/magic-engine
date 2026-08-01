/**
 * GSC bridge scoring tests — same-day de-duplication, avg_position downgrade,
 * and per-channel windows.
 *
 * Each block is written so that reverting the corresponding fix turns it red:
 *   • de-dup off               → "collapses nine same-day actions" fails
 *   • avg_position scored again→ "never issues a verdict" fails
 *   • window back to a flat 28 → "SEO waits for indexing" fails
 */

import { describe, it, expect } from 'vitest'
import { pickDailyRepresentatives, buildOutcomeRows } from '../gsc-bridge'
import {
  getAttributionWindow,
  addDaysIso,
  daysBetween,
  DEFAULT_ATTRIBUTION_WINDOW,
} from '../windows'

// ── Same-day de-duplication ───────────────────────────────────────────────────

describe('pickDailyRepresentatives', () => {
  it('collapses nine same-day actions into one measurement', () => {
    // The reported Oztop case: 9 outcomes on 2026-06-12, all baseline 148 /
    // after 141 / -4.73%, because one measurement was counted nine times.
    const sameDay = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      executed_at: `2026-06-12T0${i}:00:00Z`,
    }))

    const reps = pickDailyRepresentatives(sameDay)

    expect(reps).toHaveLength(1)
    expect(reps[0].id).toBe('a0') // earliest that day
  })

  it('keeps one action per distinct day', () => {
    const actions = [
      { id: 'a', executed_at: '2026-06-12T09:00:00Z' },
      { id: 'b', executed_at: '2026-06-12T18:00:00Z' },
      { id: 'c', executed_at: '2026-06-13T09:00:00Z' },
      { id: 'd', executed_at: '2026-06-20T09:00:00Z' },
    ]
    const reps = pickDailyRepresentatives(actions)
    expect(reps.map(r => r.id)).toEqual(['a', 'c', 'd'])
  })

  it('is deterministic when two actions share a timestamp', () => {
    const actions = [
      { id: 'zzz', executed_at: '2026-06-12T09:00:00Z' },
      { id: 'aaa', executed_at: '2026-06-12T09:00:00Z' },
    ]
    expect(pickDailyRepresentatives(actions)[0].id).toBe('aaa')
    // Reversed input must give the same answer — reruns must not churn.
    expect(pickDailyRepresentatives([...actions].reverse())[0].id).toBe('aaa')
  })

  it('returns days in chronological order', () => {
    const reps = pickDailyRepresentatives([
      { id: 'late', executed_at: '2026-07-01T00:00:00Z' },
      { id: 'early', executed_at: '2026-06-01T00:00:00Z' },
    ])
    expect(reps.map(r => r.id)).toEqual(['early', 'late'])
  })
})

// ── avg_position downgrade ────────────────────────────────────────────────────

const ACTION = { id: 'action-1', client_id: 'client-1' }

describe('buildOutcomeRows — avg_position is context, not a verdict', () => {
  it('never issues a verdict on average position, however far it moves', () => {
    // Oztop's real shape: impressions up, site-wide average position down
    // because new pages entered the average.
    const rows = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 148, total_impressions: 6928, avg_position: 18.3 },
      { period_end: '2026-07-10', total_clicks: 160, total_impressions: 9112, avg_position: 24.4 },
      28,
    )

    const position = rows.find(r => r.metric_key === 'seo.gsc.avg_position')!
    expect(position.verdict).toBe('inconclusive')
    expect(position.confidence).toBe(0)

    // ...and the same when position improves dramatically — no free wins either.
    const improved = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 148, total_impressions: 6928, avg_position: 40 },
      { period_end: '2026-07-10', total_clicks: 160, total_impressions: 9112, avg_position: 8 },
      28,
    )
    const improvedPosition = improved.find(r => r.metric_key === 'seo.gsc.avg_position')!
    expect(improvedPosition.verdict).toBe('inconclusive')
    expect(improvedPosition.confidence).toBe(0)
  })

  it('still records the position numbers so nothing is lost', () => {
    const rows = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 148, total_impressions: 6928, avg_position: 18.3 },
      { period_end: '2026-07-10', total_clicks: 160, total_impressions: 9112, avg_position: 24.4 },
      28,
    )
    const position = rows.find(r => r.metric_key === 'seo.gsc.avg_position')!
    expect(position.baseline).toBe(18.3)
    expect(position.after_value).toBe(24.4)
    expect(position.delta).toBe(-6.1) // still flipped: negative = rank worsened
  })

  it('exactly two metrics carry a verdict', () => {
    const rows = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 100, total_impressions: 5000, avg_position: 18 },
      { period_end: '2026-07-10', total_clicks: 130, total_impressions: 6500, avg_position: 25 },
      28,
    )
    const scored = rows.filter(r => r.verdict !== 'inconclusive').map(r => r.metric_key)
    expect(scored.sort()).toEqual(['seo.gsc.clicks', 'seo.gsc.impressions'])
  })

  it('scores clicks and impressions on their own direction', () => {
    const rows = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 100, total_impressions: 5000, avg_position: 18 },
      { period_end: '2026-07-10', total_clicks: 130, total_impressions: 4000, avg_position: 25 },
      28,
    )
    expect(rows.find(r => r.metric_key === 'seo.gsc.clicks')!.verdict).toBe('confirmed')
    expect(rows.find(r => r.metric_key === 'seo.gsc.impressions')!.verdict).toBe('reversed')
  })

  it('stores the window that was actually measured', () => {
    const rows = buildOutcomeRows(
      ACTION,
      { period_end: '2026-06-12', total_clicks: 100, total_impressions: 5000, avg_position: 18 },
      { period_end: '2026-07-24', total_clicks: 130, total_impressions: 6500, avg_position: 25 },
      42,
    )
    expect(rows.every(r => r.window_days === 42)).toBe(true)
  })
})

// ── Per-channel windows ───────────────────────────────────────────────────────

describe('attribution windows', () => {
  it('SEO waits for indexing before measuring', () => {
    const seo = getAttributionWindow('seo')
    // Snapshots are 28-day rolling aggregates: a shorter lag means the "after"
    // reading still contains days from before the action.
    expect(seo.maturationDays).toBe(28)
    expect(seo.maxWindowDays).toBe(90)
    expect(seo.maxWindowDays).toBeGreaterThan(28)
  })

  it('other channels keep measuring immediately over 14 days', () => {
    for (const channel of ['ads', 'social', 'geo']) {
      expect(getAttributionWindow(channel)).toEqual({ maturationDays: 0, maxWindowDays: 14 })
    }
    expect(getAttributionWindow(undefined)).toEqual(DEFAULT_ATTRIBUTION_WINDOW)
    expect(getAttributionWindow('unknown_channel')).toEqual(DEFAULT_ATTRIBUTION_WINDOW)
  })

  it('an action published today cannot land in its own report card', () => {
    const publishedOn = '2026-07-31T10:00:00Z'
    const earliestReading = addDaysIso(publishedOn, getAttributionWindow('seo').maturationDays)
    expect(earliestReading).toBe('2026-08-28')
    expect(daysBetween(publishedOn, earliestReading)).toBe(28)
  })

  it('addDaysIso / daysBetween round-trip', () => {
    expect(addDaysIso('2026-06-12T23:30:00Z', 90)).toBe('2026-09-10')
    expect(daysBetween('2026-06-12T00:00:00Z', '2026-07-10')).toBe(28)
    expect(daysBetween('2026-07-10', '2026-06-12')).toBe(0) // never negative
  })
})
