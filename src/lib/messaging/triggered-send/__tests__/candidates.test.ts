import { describe, it, expect } from 'vitest'
import { localDay, classifyContactAge } from '../candidates'

const AUCKLAND = 'Pacific/Auckland'
const SYDNEY = 'Australia/Sydney'

describe('localDay', () => {
  it('returns the local calendar day in Pacific/Auckland', () => {
    expect(localDay('2026-11-02T10:59:59Z', AUCKLAND)).toBe('2026-11-02')
  })

  it('rolls over at local midnight (UTC+13)', () => {
    expect(localDay('2026-11-02T11:00:00Z', AUCKLAND)).toBe('2026-11-03')
  })

  it('accepts a Date object and matches the string form', () => {
    const instant = new Date('2026-11-02T11:00:00Z')
    expect(localDay(instant, AUCKLAND)).toBe('2026-11-03')
    expect(localDay(instant, AUCKLAND)).toBe(localDay('2026-11-02T11:00:00Z', AUCKLAND))
  })

  it('uses the zone offset for Australia/Sydney (UTC+11)', () => {
    expect(localDay('2026-11-02T11:00:00Z', SYDNEY)).toBe('2026-11-02')
  })

  it('handles the DST start boundary in Pacific/Auckland', () => {
    // DST starts 2026-09-27 02:00 NZST = 2026-09-26T14:00:00Z.
    expect(localDay('2026-09-26T13:59:59Z', AUCKLAND)).toBe('2026-09-27')
    expect(localDay('2026-09-26T14:00:00Z', AUCKLAND)).toBe('2026-09-27')
  })

  it('is still the previous day just before local midnight (NZST +12)', () => {
    expect(localDay('2026-09-26T10:59:59Z', AUCKLAND)).toBe('2026-09-26')
  })

  it('returns null for an unparsable string', () => {
    expect(localDay('not-a-date', AUCKLAND)).toBeNull()
  })

  it('returns null for an invalid Date', () => {
    expect(localDay(new Date('nope'), AUCKLAND)).toBeNull()
  })

  it('returns null for an invalid time zone', () => {
    expect(localDay('2026-11-02T11:00:00Z', 'Not/AZone')).toBeNull()
  })
})

describe('classifyContactAge', () => {
  const now = new Date('2026-11-02T20:15:00Z')
  const proposedAt = '2026-10-01T00:00:00Z'

  it('candidate: created on an earlier local day, within max age', () => {
    // Auckland local days: created 11-02, now 11-03.
    expect(
      classifyContactAge({
        createdAt: '2026-11-01T20:00:00Z',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('candidate')
  })

  it('candidate: another earlier-local-day case', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-11-02T09:00:00Z',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('candidate')
  })

  it('not_yet: created on the same local day as now', () => {
    // Both local day 11-03 in Auckland.
    expect(
      classifyContactAge({
        createdAt: '2026-11-02T19:30:00Z',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('not_yet')
  })

  it('not_yet: created in the future relative to now', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-11-05T00:00:00Z',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('not_yet')
  })

  it('candidate: exactly maxAgeDays old is not stale', () => {
    const maxAgeDays = 3
    const createdAt = new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString()
    expect(
      classifyContactAge({
        createdAt,
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays,
      }),
    ).toBe('candidate')
  })

  it('stale: one millisecond older than maxAgeDays', () => {
    const maxAgeDays = 3
    const createdAt = new Date(now.getTime() - maxAgeDays * 86_400_000 - 1).toISOString()
    expect(
      classifyContactAge({
        createdAt,
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays,
      }),
    ).toBe('stale')
  })

  it('stale: well beyond maxAgeDays', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-10-20T00:00:00Z',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 3,
      }),
    ).toBe('stale')
  })

  it('before_proposal: created 1 ms before the proposal', () => {
    const proposed = '2026-10-15T12:00:00Z'
    const created = new Date(Date.parse(proposed) - 1).toISOString()
    expect(
      classifyContactAge({
        createdAt: created,
        proposedAt: proposed,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('before_proposal')
  })

  it('before_proposal: equal instants are not before', () => {
    const proposed = '2026-10-15T12:00:00Z'
    expect(
      classifyContactAge({
        createdAt: proposed,
        proposedAt: proposed,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).not.toBe('before_proposal')
  })

  it('invalid_date: unparsable createdAt', () => {
    expect(
      classifyContactAge({
        createdAt: 'nope',
        proposedAt,
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('invalid_date')
  })

  it('invalid_date: unparsable proposedAt', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-11-01T20:00:00Z',
        proposedAt: 'nope',
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('invalid_date')
  })

  it('invalid_date: invalid now', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-11-01T20:00:00Z',
        proposedAt,
        now: new Date('nope'),
        timeZone: AUCKLAND,
        maxAgeDays: 30,
      }),
    ).toBe('invalid_date')
  })

  it('invalid_date: invalid time zone', () => {
    expect(
      classifyContactAge({
        createdAt: '2026-11-01T20:00:00Z',
        proposedAt,
        now,
        timeZone: 'Not/AZone',
        maxAgeDays: 30,
      }),
    ).toBe('invalid_date')
  })

  it('precedence: before_proposal wins over stale', () => {
    // Created long ago (stale) but before the proposal.
    expect(
      classifyContactAge({
        createdAt: '2026-01-01T00:00:00Z',
        proposedAt: '2026-06-01T00:00:00Z',
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 3,
      }),
    ).toBe('before_proposal')
  })

  it('precedence: invalid_date wins over everything', () => {
    // Would otherwise be before_proposal and stale, but createdAt is unparsable.
    expect(
      classifyContactAge({
        createdAt: 'garbage',
        proposedAt: '2026-06-01T00:00:00Z',
        now,
        timeZone: AUCKLAND,
        maxAgeDays: 3,
      }),
    ).toBe('invalid_date')
  })
})
