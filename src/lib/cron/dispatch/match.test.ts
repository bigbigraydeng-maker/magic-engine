import { describe, expect, it } from 'vitest'
import { DISPATCH_CATALOG } from './catalog'
import { bucketForSchedule, cronMatches, dispatchInstant } from './match'
import { selectDue } from './due'

describe('dispatchInstant', () => {
  it('floors a late arrival back to the 5-minute window start', () => {
    expect(dispatchInstant(new Date('2026-10-24T10:04:50Z')).toISOString()).toBe(
      '2026-10-24T10:00:00.000Z',
    )
    expect(dispatchInstant(new Date('2026-10-24T10:09:59Z')).toISOString()).toBe(
      '2026-10-24T10:05:00.000Z',
    )
  })
})

describe('cronMatches', () => {
  it('matches the production shapes and rejects the minute beside them', () => {
    const cases: Array<[string, string, boolean]> = [
      ['*/10 * * * *', '2026-10-24T04:10:00Z', true],
      ['*/10 * * * *', '2026-10-24T04:05:00Z', false],
      ['*/30 * * * *', '2026-10-24T04:30:00Z', true],
      ['25 */2 * * *', '2026-10-24T02:25:00Z', true],
      ['25 */2 * * *', '2026-10-24T03:25:00Z', false],
      ['25,55 * * * *', '2026-10-24T02:25:00Z', true],
      ['25,55 * * * *', '2026-10-24T02:55:00Z', true],
      ['25,55 * * * *', '2026-10-24T02:30:00Z', false],
      ['25,55 * * * *', '2026-10-24T03:25:00Z', true],
      ['0 */6 * * *', '2026-10-24T18:00:00Z', true],
      ['30 */6 * * *', '2026-10-24T06:30:00Z', true],
      ['30 */6 * * *', '2026-10-24T03:30:00Z', false],
      ['0 0 * * *', '2026-10-24T00:00:00Z', true],
      ['0 0 * * *', '2026-10-24T00:05:00Z', false],
      ['30 16 * * 1', '2026-10-19T16:30:00Z', true],
      ['30 16 * * 1', '2026-10-20T16:30:00Z', false],
      ['0 19 * * 0-4', '2026-10-18T19:00:00Z', true],
      ['0 19 * * 0-4', '2026-10-22T19:00:00Z', true],
      ['0 19 * * 0-4', '2026-10-23T19:00:00Z', false],
      ['0 17 * * *', '2026-10-24T17:00:00Z', true],
    ]
    for (const [schedule, iso, expected] of cases) {
      expect(cronMatches(schedule, new Date(iso)), `${schedule} @ ${iso}`).toBe(expected)
    }
  })

  it('refuses a day-of-month and day-of-week both being restricted', () => {
    expect(cronMatches('0 5 28 9 1', new Date('2026-09-28T05:00:00Z'))).toBe(false)
    expect(bucketForSchedule('0 5 28 9 1')).toBeNull()
  })
})

describe('selectDue', () => {
  it('puts Monday 16:30 industry visibility on the weekly tick only', () => {
    const at = new Date('2026-10-19T16:30:00Z')
    const weekly = selectDue(DISPATCH_CATALOG, 'weekly', at).map((job) => job.service)
    const daily = selectDue(DISPATCH_CATALOG, 'daily', at).map((job) => job.service)
    expect(weekly).toContain('industry-ai-visibility-daily')
    expect(daily).not.toContain('industry-ai-visibility-daily')
  })

  it('keeps viral discovery on the daily midnight tick', () => {
    const due = selectDue(DISPATCH_CATALOG, 'daily', new Date('2026-10-24T00:00:10Z'))
    expect(due.map((job) => job.service)).toContain('viral-discovery-weekly')
  })

  it('marks meta lead sync due at minute 25 and 55, including odd hours', () => {
    const names = (iso: string) =>
      selectDue(DISPATCH_CATALOG, 'frequent', new Date(iso)).map((job) => job.service)
    expect(names('2026-10-24T02:25:00Z')).toContain('meta-leads-hourly')
    expect(names('2026-10-24T02:55:00Z')).toContain('meta-leads-hourly')
    expect(names('2026-10-24T02:30:00Z')).not.toContain('meta-leads-hourly')
    expect(names('2026-10-24T03:25:00Z')).toContain('meta-leads-hourly')
  })

  it('knocks baseline domains every day at 17:00 UTC', () => {
    const saturday = selectDue(DISPATCH_CATALOG, 'daily', new Date('2026-10-24T17:00:00Z'))
    const sunday = selectDue(DISPATCH_CATALOG, 'daily', new Date('2026-10-25T17:00:00Z'))
    expect(saturday.map((job) => job.service)).toContain('render-dashboard:baseline-domains-monthly')
    expect(sunday.map((job) => job.service)).toContain('render-dashboard:baseline-domains-monthly')
  })
})
