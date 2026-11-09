/**
 * 批次计划的测试向量：来自发信设计窗口读数据接口约定 §8 的表（出自 126 的排期文件 §2）。
 * 同一张表也用独立脚本（不 import 生产函数，只按规则文字复算）核过一遍：12/2 起共 32 封不同的信、
 * 167 人次、12/2 当天 4 封信 21 位收件人，和下面的表逐行一致。
 * 团、人名全是编的（Tour One… / Guest 01…），只有出发日沿用向量里的日期。
 */

import { describe, expect, it } from 'vitest'
import { COUNTDOWN_CADENCE, type CountdownCadence } from '../cadence'
import { planCountdownCalendar as calendarWith, planCountdownIssue as issueWith } from '../plan'
import type { BookingFact, MonthsLeft, NzDate, PlannedLetter } from '../types'

/** 约定里的测试向量是按这套节奏写的，所以测试显式传它；计划函数自己没有默认节奏。 */
const planCountdownIssue = (facts: readonly BookingFact[], day: NzDate, cadence: CountdownCadence = COUNTDOWN_CADENCE): PlannedLetter[] =>
  issueWith(facts, day, cadence)
const planCountdownCalendar = (facts: readonly BookingFact[], fromDay: NzDate, cadence: CountdownCadence = COUNTDOWN_CADENCE): PlannedLetter[] =>
  calendarWith(facts, fromDay, cadence)

interface GroupSpec {
  code: 'A' | 'B' | 'C' | 'D'
  tourId: string
  tourName: string
  departOn: NzDate
  people: number
}

const GROUPS: GroupSpec[] = [
  { code: 'A', tourId: 't-one', tourName: 'Tour One', departOn: '2027-03-11', people: 10 },
  { code: 'B', tourId: 't-two', tourName: 'Tour Two', departOn: '2027-03-18', people: 1 },
  { code: 'C', tourId: 't-three', tourName: 'Tour Three', departOn: '2027-05-08', people: 5 },
  { code: 'D', tourId: 't-one', tourName: 'Tour One', departOn: '2027-05-13', people: 5 },
]

function factsFor(group: GroupSpec): BookingFact[] {
  return Array.from({ length: group.people }, (_, i) => ({
    contactId: `${group.code}-${String(i + 1).padStart(2, '0')}`,
    displayName: `Guest ${group.code}${String(i + 1).padStart(2, '0')}`,
    tourId: group.tourId,
    tourName: group.tourName,
    departOn: group.departOn,
    seats: (i % 3) + 1,
  }))
}

const ALL_FACTS: BookingFact[] = GROUPS.flatMap(factsFor)

const EXPECTED: Record<GroupSpec['code'], Array<[NzDate, MonthsLeft]>> = {
  A: [
    ['2026-12-02', 3],
    ['2027-01-06', 2],
    ['2027-02-03', 1],
    ['2027-02-10', 'weekly'],
    ['2027-02-17', 'weekly'],
    ['2027-02-24', 'weekly'],
    ['2027-03-03', 'weekly'],
  ],
  B: [
    ['2026-12-02', 3],
    ['2027-01-06', 2],
    ['2027-02-03', 1],
    ['2027-02-17', 'weekly'],
    ['2027-02-24', 'weekly'],
    ['2027-03-03', 'weekly'],
    ['2027-03-10', 'weekly'],
  ],
  C: [
    ['2026-12-02', 5],
    ['2027-01-06', 4],
    ['2027-02-03', 3],
    ['2027-03-03', 2],
    ['2027-04-07', 1],
    ['2027-04-14', 'weekly'],
    ['2027-04-21', 'weekly'],
    ['2027-04-28', 'weekly'],
    ['2027-05-05', 'weekly'],
  ],
  D: [
    ['2026-12-02', 5],
    ['2027-01-06', 4],
    ['2027-02-03', 3],
    ['2027-03-03', 2],
    ['2027-04-07', 1],
    ['2027-04-14', 'weekly'],
    ['2027-04-21', 'weekly'],
    ['2027-04-28', 'weekly'],
    ['2027-05-05', 'weekly'],
  ],
}

function lettersOf(letters: PlannedLetter[], group: GroupSpec): Array<[NzDate, MonthsLeft]> {
  return letters
    .filter((l) => l.tourId === group.tourId && l.departOn === group.departOn)
    .map((l) => [l.sendDate, l.monthsLeft])
}

describe('planCountdownCalendar · contract §8 vectors', () => {
  const calendar = planCountdownCalendar(ALL_FACTS, '2026-12-02')

  for (const group of GROUPS) {
    it(`group ${group.code} (departs ${group.departOn}) gets exactly the contract's letters`, () => {
      expect(lettersOf(calendar, group)).toEqual(EXPECTED[group.code])
    })
  }

  it('has 32 distinct letters and 167 person-sends from 12/2', () => {
    expect(calendar).toHaveLength(32)
    expect(calendar.reduce((sum, l) => sum + l.recipients.length, 0)).toBe(167)
  })

  it('is sorted by send date, then departure date, and every key is unique', () => {
    const order = calendar.map((l) => `${l.sendDate}|${l.departOn}|${l.tourId}`)
    expect(order).toEqual([...order].sort())
    expect(new Set(calendar.map((l) => l.letterKey)).size).toBe(calendar.length)
  })

  it('does not plan days before the start day (nothing is made up for missed days)', () => {
    const later = planCountdownCalendar(ALL_FACTS, '2027-01-06')
    expect(later.every((l) => l.sendDate >= '2027-01-06')).toBe(true)
    expect(later).toHaveLength(32 - 4)
  })

  it('starting on a non-Wednesday still finds the next Wednesday', () => {
    expect(planCountdownCalendar(ALL_FACTS, '2026-11-10')[0]?.sendDate).toBe('2026-12-02')
  })
})

describe('planCountdownIssue · single days', () => {
  it('12/2 → 4 letters, 21 people', () => {
    const letters = planCountdownIssue(ALL_FACTS, '2026-12-02')
    expect(letters).toHaveLength(4)
    expect(letters.reduce((sum, l) => sum + l.recipients.length, 0)).toBe(21)
    expect(letters.map((l) => l.monthsLeft)).toEqual([3, 3, 5, 5])
  })

  it('3/3 is a weekly letter for A and a 2-month letter for C and D', () => {
    const letters = planCountdownIssue(ALL_FACTS, '2027-03-03')
    const byGroup = (g: GroupSpec) => letters.find((l) => l.tourId === g.tourId && l.departOn === g.departOn)?.monthsLeft
    expect(byGroup(GROUPS[0])).toBe('weekly')
    expect(byGroup(GROUPS[2])).toBe(2)
    expect(byGroup(GROUPS[3])).toBe(2)
  })

  it('4/7: nothing for A and B (already left), a 1-month letter for C and D', () => {
    const letters = planCountdownIssue(ALL_FACTS, '2027-04-07')
    expect(letters.map((l) => l.departOn)).toEqual(['2027-05-08', '2027-05-13'])
    expect(letters.map((l) => l.monthsLeft)).toEqual([1, 1])
  })

  it('stops 3 days before departure: 5/5 still sends (3 and 8 days), 5/12 does not (1 day)', () => {
    expect(planCountdownIssue(ALL_FACTS, '2027-05-05').map((l) => l.departOn)).toEqual(['2027-05-08', '2027-05-13'])
    expect(planCountdownIssue(ALL_FACTS, '2027-05-12')).toEqual([])
  })

  it('exactly 30 days out is weekly, 31 days out on a first Wednesday is a 1-month letter', () => {
    const fact = (departOn: NzDate): BookingFact[] => [
      { contactId: 'x', displayName: 'X', tourId: 't', tourName: 'T', departOn, seats: 1 },
    ]
    expect(planCountdownIssue(fact('2027-04-14'), '2027-03-15')).toEqual([]) // not a Wednesday
    expect(planCountdownIssue(fact('2027-04-07'), '2027-03-10')[0]?.monthsLeft).toBe('weekly') // 28 days
    expect(planCountdownIssue(fact('2027-05-05'), '2027-04-05')).toEqual([]) // Monday
    expect(planCountdownIssue(fact('2027-05-07'), '2027-04-07')[0]?.monthsLeft).toBe('weekly') // 30 days
    expect(planCountdownIssue(fact('2027-05-08'), '2027-04-07')[0]?.monthsLeft).toBe(1) // 31 days
  })

  it('a Wednesday that is not the first of the month sends nothing outside the last month', () => {
    expect(planCountdownIssue(ALL_FACTS, '2026-12-09')).toEqual([])
    expect(planCountdownIssue(ALL_FACTS, '2027-01-13')).toEqual([])
  })

  it('the 8th is never a first Wednesday: when the 1st is a Wednesday, only the 1st sends', () => {
    const facts: BookingFact[] = [
      { contactId: 'x', displayName: 'X', tourId: 't', tourName: 'T', departOn: '2028-03-10', seats: 1 },
    ]
    expect(planCountdownIssue(facts, '2027-12-01')[0]?.monthsLeft).toBe(3) // 100 days
    expect(planCountdownIssue(facts, '2027-12-08')).toEqual([]) // second Wednesday, 93 days
  })

  it('days that are not Wednesdays send nothing', () => {
    expect(planCountdownIssue(ALL_FACTS, '2026-12-03')).toEqual([])
    expect(planCountdownIssue(ALL_FACTS, '2027-02-11')).toEqual([])
  })

  it('too early (more than 6 months out) sends nothing yet', () => {
    const far: BookingFact[] = [
      { contactId: 'x', displayName: 'X', tourId: 't', tourName: 'T', departOn: '2027-12-15', seats: 1 },
    ]
    expect(planCountdownIssue(far, '2027-03-03')).toEqual([]) // 287 days → 9 months
    expect(planCountdownIssue(far, '2027-06-02')[0]?.monthsLeft).toBe(6) // 196 days → 6.4 → 6
  })

  it('an invalid date returns an empty plan instead of throwing', () => {
    expect(planCountdownIssue(ALL_FACTS, '2026-02-30')).toEqual([])
    expect(planCountdownIssue(ALL_FACTS, 'not-a-date')).toEqual([])
    expect(planCountdownCalendar(ALL_FACTS, '')).toEqual([])
  })

  it('facts with a broken departure date are skipped', () => {
    const broken: BookingFact[] = [
      { contactId: 'x', displayName: 'X', tourId: 't', tourName: 'T', departOn: '2027-13-40', seats: 1 },
    ]
    expect(planCountdownIssue([...ALL_FACTS, ...broken], '2026-12-02')).toHaveLength(4)
  })

  it('no facts, no letters', () => {
    expect(planCountdownIssue([], '2026-12-02')).toEqual([])
    expect(planCountdownCalendar([], '2026-12-02')).toEqual([])
  })
})

describe('recipients', () => {
  const base = { tourId: 't', tourName: 'T', departOn: '2027-03-11' }

  it('merges several bookings of one person in one group: seats add up', () => {
    const facts: BookingFact[] = [
      { ...base, contactId: 'p', displayName: 'Pat', seats: 2 },
      { ...base, contactId: 'p', displayName: 'Pat', seats: 3 },
    ]
    const [letter] = planCountdownIssue(facts, '2026-12-02')
    expect(letter.recipients).toEqual([{ contactId: 'p', displayName: 'Pat', seats: 5 }])
  })

  it('an unfilled seat count on any booking makes the total unknown (null), never a guess', () => {
    const facts: BookingFact[] = [
      { ...base, contactId: 'p', displayName: 'Pat', seats: 2 },
      { ...base, contactId: 'p', displayName: 'Pat', seats: null },
    ]
    expect(planCountdownIssue(facts, '2026-12-02')[0].recipients[0].seats).toBeNull()
  })

  it('keeps the first known name and sorts people by name (no name last)', () => {
    const facts: BookingFact[] = [
      { ...base, contactId: 'c3', displayName: null, seats: 1 },
      { ...base, contactId: 'c2', displayName: 'bob', seats: 1 },
      { ...base, contactId: 'c1', displayName: 'Alice', seats: 1 },
      { ...base, contactId: 'c3', displayName: 'Zed', seats: 1 },
    ]
    const names = planCountdownIssue(facts, '2026-12-02')[0].recipients.map((r) => r.displayName)
    expect(names).toEqual(['Alice', 'bob', 'Zed'])
  })

  it('the same person in two different groups is a recipient of both letters', () => {
    const facts: BookingFact[] = [
      { contactId: 'p', displayName: 'Pat', tourId: 't1', tourName: 'T1', departOn: '2027-03-11', seats: 1 },
      { contactId: 'p', displayName: 'Pat', tourId: 't2', tourName: 'T2', departOn: '2027-03-18', seats: 1 },
    ]
    const letters = planCountdownIssue(facts, '2026-12-02')
    expect(letters).toHaveLength(2)
    expect(letters.every((l) => l.recipients.length === 1)).toBe(true)
  })

  it('two departures of the same tour are two groups (two letters)', () => {
    const facts: BookingFact[] = [
      { contactId: 'a', displayName: 'A', tourId: 't', tourName: 'T', departOn: '2027-03-11', seats: 1 },
      { contactId: 'b', displayName: 'B', tourId: 't', tourName: 'T', departOn: '2027-05-13', seats: 1 },
    ]
    expect(planCountdownIssue(facts, '2026-12-02')).toHaveLength(2)
  })

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(ALL_FACTS)) as BookingFact[]
    planCountdownCalendar(ALL_FACTS, '2026-12-02')
    expect(ALL_FACTS).toEqual(copy)
  })
})

describe('cadence', () => {
  it('is the documented default', () => {
    expect(COUNTDOWN_CADENCE).toEqual({
      batchWeekday: 3,
      daysPerMonth: 30.4,
      firstMonth: 6,
      lastMonth: 1,
      weeklyWithinDays: 30,
      stopBeforeDays: 3,
    })
  })

  it('a different cadence is passed in, not edited in place (Friday batches, stop 5 days before)', () => {
    const facts: BookingFact[] = [
      { contactId: 'a', displayName: 'A', tourId: 't', tourName: 'T', departOn: '2027-03-11', seats: 1 },
    ]
    const friday = { ...COUNTDOWN_CADENCE, batchWeekday: 5, stopBeforeDays: 5 }
    expect(planCountdownIssue(facts, '2026-12-04', friday)).toHaveLength(1) // first Friday
    expect(planCountdownIssue(facts, '2026-12-02', friday)).toEqual([]) // Wednesday
    expect(planCountdownIssue(facts, '2027-03-08', friday)).toEqual([]) // Monday, 3 days out
  })
})
