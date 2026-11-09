import { describe, expect, it } from 'vitest'
import { TEMPLATE_KEY_RE } from '@/lib/crm/email-templates/template-store'
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
    // TEMPLATE_KEY_RE is the real rule from the template store; the trigger-key rule is a copy of the send engine's (its constant is not exported).
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

describe('key algorithm is frozen to fixed values', () => {
  // If the hash or the spelling ever changes, every registered letter and every send record would stop matching its letter.
  // So these exact strings must never change without a deliberate migration.
  const UUID = 'b6a1f3c2-4d5e-4f60-8a71-92b3c4d5e6f7'
  const monthly = { sendDate: '2026-12-02', tourId: UUID, departOn: '2027-03-11', monthsLeft: 3 as const }
  const weekly = { sendDate: '2027-03-03', tourId: UUID, departOn: '2027-03-11', monthsLeft: 'weekly' as const }

  it('the short tour code', () => {
    expect(tourCodeOf('tour-1')).toBe('0kvm3a9')
    expect(tourCodeOf(UUID)).toBe('15me0um')
  })

  it('the template key and the trigger key, monthly and weekly', () => {
    expect(buildTemplateKey(monthly)).toBe('auto-countdown-20261202-15me0um-20270311-m3')
    expect(buildTriggerKey(monthly)).toBe('countdown_20261202_15me0um_20270311_3')
    expect(buildTemplateKey(weekly)).toBe('auto-countdown-20270303-15me0um-20270311-w')
    expect(buildTriggerKey(weekly)).toBe('countdown_20270303_15me0um_20270311_w')
  })

  it('and the frozen keys obey the database rules', () => {
    const templates = [buildTemplateKey(monthly), buildTemplateKey(weekly)] as string[]
    const triggers = [buildTriggerKey(monthly), buildTriggerKey(weekly)] as string[]
    for (const key of templates) {
      expect(key).toMatch(TEMPLATE_KEY_RE)
      expect(key.startsWith('auto-')).toBe(true)
    }
    for (const key of triggers) expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/)
  })
})
