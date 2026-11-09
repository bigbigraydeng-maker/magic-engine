import { describe, expect, it } from 'vitest'
import { depositedSeatMetricLabel, readDepositedSeatScope, readSeatFetchExtras } from '../seat-scope'

const FOUR_DATES = [
  { depart_on: '2027-03-11' },
  { depart_on: '2027-03-18' },
  { depart_on: '2027-03-25' },
  { depart_on: '2027-03-26' },
]

function scopeMetric(departures: unknown) {
  return [{ key: 'deposited_seat_scope', label: '已收定金座位', departures }]
}

describe('readDepositedSeatScope', () => {
  it('ignores a goal with no departure list', () => {
    expect(readDepositedSeatScope(null)).toEqual({ ok: true, departures: null })
    expect(readDepositedSeatScope([])).toEqual({ ok: true, departures: null })
  })

  it('reads departure dates from supporting metrics', () => {
    const read = readDepositedSeatScope(scopeMetric(FOUR_DATES))
    expect(read).toEqual({
      ok: true,
      departures: FOUR_DATES.map((item) => ({ departOn: item.depart_on, tourId: null })),
    })
  })

  it('fails closed on a broken list instead of falling back', () => {
    expect(readDepositedSeatScope(scopeMetric([])).ok).toBe(false)
    expect(readDepositedSeatScope(scopeMetric([{ depart_on: 'March 11' }])).ok).toBe(false)
    expect(readDepositedSeatScope('nope').ok).toBe(false)
    const doubled = readDepositedSeatScope([
      ...scopeMetric(FOUR_DATES),
      ...scopeMetric(FOUR_DATES),
    ])
    expect(doubled.ok).toBe(false)
  })
})

describe('readSeatFetchExtras', () => {
  it('passes the list only for signups_count', () => {
    const goal = {
      primary_metric_key: 'signups_count',
      supporting_metrics: scopeMetric([{ depart_on: '2027-03-18', tour_id: 'tour-b' }]),
      created_at: '2026-10-16T01:00:00.000Z',
      baseline_value: 0,
    }
    expect(readSeatFetchExtras(goal).ok).toBe(true)
    const signups = readSeatFetchExtras(goal)
    if (!signups.ok) throw new Error('expected extras')
    expect(signups.extras?.depositedSeatScope).toEqual([{ departOn: '2027-03-18', tourId: 'tour-b' }])
    expect(signups.extras?.baselineValue).toBe(0)

    const leads = readSeatFetchExtras({ ...goal, primary_metric_key: 'leads_count' })
    if (!leads.ok) throw new Error('expected no extras')
    expect(leads.extras).toBeNull()
  })

  it('names the metric as seats only when a departure list is present', () => {
    expect(depositedSeatMetricLabel(scopeMetric(FOUR_DATES))).toEqual({ label: '已收定金座位', unit: '座位' })
    expect(depositedSeatMetricLabel([])).toBeNull()
  })
})
