import { describe, expect, it } from 'vitest'
import { compactDate, dayOfMonth, daysBetween, fromDayNumber, toDayNumber, weekdayLabelZh, weekdayOf } from '../dates'
import { buildLetterKey, buildTemplateKey, buildTriggerKey, parseLetterKey, tourCodeOf } from '../keys'

describe('dates', () => {
  it('rejects anything that is not a real YYYY-MM-DD', () => {
    for (const bad of ['', 'abc', '2026-2-3', '2026-02-30', '2026-13-01', '2026-00-10', '2026-12-32']) {
      expect(toDayNumber(bad)).toBeNull()
      expect(weekdayOf(bad)).toBeNull()
      expect(daysBetween('2026-12-02', bad)).toBeNull()
      expect(compactDate(bad)).toBeNull()
    }
  })

  it('computes weekday, day of month and day differences without any time-zone effect', () => {
    expect(weekdayOf('2026-12-02')).toBe(3)
    expect(weekdayLabelZh('2026-12-02')).toBe('周三')
    expect(weekdayLabelZh('2026-11-29')).toBe('周日')
    expect(dayOfMonth('2027-01-06')).toBe(6)
    expect(daysBetween('2026-12-02', '2027-03-11')).toBe(99)
    expect(daysBetween('2027-03-11', '2026-12-02')).toBe(-99)
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1)
  })

  it('round-trips through the day number', () => {
    const n = toDayNumber('2027-02-28')
    expect(n).not.toBeNull()
    expect(fromDayNumber((n as number) + 1)).toBe('2027-03-01')
    expect(compactDate('2027-02-28')).toBe('20270228')
  })
})

describe('letter / template / trigger keys', () => {
  const identity = { sendDate: '2026-12-02', tourId: 'tour-1', departOn: '2027-03-11', monthsLeft: 3 as const }

  const code = tourCodeOf('tour-1')

  it('builds the three spellings from the same four facts', () => {
    expect(buildLetterKey(identity)).toBe('plan:2026-12-02:tour-1:2027-03-11:3')
    expect(buildTemplateKey(identity)).toBe(`auto-countdown-20261202-${code}-20270311-m3`)
    expect(buildTriggerKey(identity)).toBe(`countdown_20261202_${code}_20270311_3`)
  })

  it('uses w for the weekly letters', () => {
    const weekly = { ...identity, monthsLeft: 'weekly' as const }
    expect(buildLetterKey(weekly)).toBe('plan:2026-12-02:tour-1:2027-03-11:w')
    expect(buildTemplateKey(weekly)).toBe(`auto-countdown-20261202-${code}-20270311-w`)
    expect(buildTriggerKey(weekly)).toBe(`countdown_20261202_${code}_20270311_w`)
  })

  it('the short tour code is 7 chars of a-z0-9, stable, and different for different tours', () => {
    expect(code).toMatch(/^[a-z0-9]{7}$/)
    expect(tourCodeOf('tour-1')).toBe(code)
    const ids = ['tour-1', 'tour-2', '7a5c1e2f-0000-4000-8000-000000000001', '7a5c1e2f-0000-4000-8000-000000000002', 'a:b c/d', 'é-é', '']
    const codes = ids.map(tourCodeOf)
    codes.forEach((c) => expect(c).toMatch(/^[a-z0-9]{7}$/))
    expect(new Set(codes).size).toBe(ids.length)
  })

  it('the template and trigger keys fit the database rules for any tour id (uuid, odd characters)', () => {
    const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
    const TRIGGER_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
    for (const tourId of ['7a5c1e2f-0000-4000-8000-000000000001', 'a:b c/d', 'é-é', 'T-1']) {
      for (const monthsLeft of [1, 2, 3, 4, 5, 6, 'weekly'] as const) {
        const template = buildTemplateKey({ ...identity, tourId, monthsLeft })
        const trigger = buildTriggerKey({ ...identity, tourId, monthsLeft })
        expect(template).toMatch(TEMPLATE_KEY_RE)
        expect(template?.startsWith('auto-')).toBe(true)
        expect(trigger).toMatch(TRIGGER_KEY_RE)
      }
    }
  })

  it('round-trips, including a tour id with awkward characters', () => {
    for (const tourId of ['tour-1', 'a:b c/d', 'é-é', '7a5c1e2f-0000-4000-8000-000000000001']) {
      for (const monthsLeft of [1, 6, 'weekly'] as const) {
        const key = buildLetterKey({ ...identity, tourId, monthsLeft })
        expect(key).not.toBeNull()
        expect(key?.split(':')).toHaveLength(5)
        expect(parseLetterKey(key as string)).toEqual({ ...identity, tourId, monthsLeft })
      }
    }
  })

  it('refuses to build a key from bad facts instead of throwing', () => {
    expect(buildLetterKey({ ...identity, sendDate: '2026-02-30' })).toBeNull()
    expect(buildLetterKey({ ...identity, departOn: 'x' })).toBeNull()
    expect(buildLetterKey({ ...identity, tourId: '' })).toBeNull()
    expect(buildLetterKey({ ...identity, monthsLeft: 0 })).toBeNull()
    expect(buildLetterKey({ ...identity, monthsLeft: 7 })).toBeNull()
    expect(buildLetterKey({ ...identity, monthsLeft: 2.5 })).toBeNull()
    expect(buildTemplateKey({ ...identity, monthsLeft: 7 })).toBeNull()
    expect(buildTriggerKey({ ...identity, sendDate: 'nope' })).toBeNull()
  })

  it('does not recognise malformed keys', () => {
    for (const bad of [
      '',
      'plan',
      'plan:2026-12-02:tour-1:2027-03-11',
      'plan:2026-12-02:tour-1:2027-03-11:7',
      'plan:2026-12-02:tour-1:2027-03-11:x',
      'plan:2026-02-30:tour-1:2027-03-11:3',
      'plan:2026-12-02::2027-03-11:3',
      'me:countdown_20270106_A_2',
      'plan:2026-12-02:%E0%A4%A:2027-03-11:3',
    ]) {
      expect(parseLetterKey(bad)).toBeNull()
    }
  })
})
