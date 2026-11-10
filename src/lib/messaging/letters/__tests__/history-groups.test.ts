import { describe, expect, it } from 'vitest'
import { buildList, type LetterFacts, type RecipientOutcome } from '../aggregate'
import { COUNTDOWN_CADENCE } from '../cadence'
import { shiftDays } from '../dates'
import { PAST_BATCHES_SHOWN, lookbackDaysFor } from '../history'
import { tourCodeOf } from '../keys'
import type { NzDate, PlannedLetter } from '../types'

const TODAY = '2026-12-10'

function letter(over: Partial<PlannedLetter> & { sendDate: NzDate; letterKey: string }): PlannedLetter {
  return {
    tourId: 't-1',
    tourName: 'Tour One',
    departOn: '2027-03-11',
    monthsLeft: 3,
    recipients: [
      { contactId: 'c1', displayName: 'Bea', seats: 2 },
      { contactId: 'c2', displayName: 'Al', seats: null },
    ],
    ...over,
  }
}

function outcome(over: Partial<RecipientOutcome> & { contactId: string }): RecipientOutcome {
  return { outcome: 'sent', reasonCode: null, opened: null, clicked: null, ...over }
}

/** 已经发出去：c1 发出，c2 被拦。 */
function wentOut(recipients?: RecipientOutcome[]): LetterFacts {
  return {
    registry: null,
    sends: {
      channel: 'me',
      proposalPending: false,
      proposalApproved: false,
      recipients: recipients ?? [outcome({ contactId: 'c1' }), outcome({ contactId: 'c2', outcome: 'blocked', reasonCode: 'dnc' })],
    },
  }
}

/** 提案递上去了，等 PM 放行。 */
const waiting: LetterFacts = {
  registry: null,
  sends: { channel: 'me', proposalPending: true, proposalApproved: false, recipients: [] },
}

/** PM 已放行，可是一行发送记录都没有（引擎没动）。 */
const approvedOnly: LetterFacts = {
  registry: null,
  sends: { channel: 'me', proposalPending: false, proposalApproved: true, recipients: [] },
}

describe('lookbackDaysFor', () => {
  it('covers the whole life of a group that has not left yet (the first letter is at most 6.5 months before departure)', () => {
    expect(lookbackDaysFor(COUNTDOWN_CADENCE)).toBe(199)
    for (let days = 0; days <= 400; days += 1) {
      if (Math.round(days / COUNTDOWN_CADENCE.daysPerMonth) <= COUNTDOWN_CADENCE.firstMonth) {
        expect(days).toBeLessThanOrEqual(lookbackDaysFor(COUNTDOWN_CADENCE))
      }
    }
  })

  it('follows the rhythm it is given: a shorter series needs a shorter look-back', () => {
    expect(lookbackDaysFor({ ...COUNTDOWN_CADENCE, firstMonth: 3 })).toBe(108)
  })

  it('shiftDays moves a calendar day forward or back, and refuses an unreal date', () => {
    expect(shiftDays('2026-11-10', -199)).toBe('2026-04-25')
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDays('2026-02-30', 1)).toBeNull()
  })
})

describe('buildList · letters whose send day has passed', () => {
  const traced: NzDate[] = ['2026-07-01', '2026-08-05', '2026-09-02', '2026-10-07', '2026-11-04']
  const plan: PlannedLetter[] = [
    ...traced.map((day) => letter({ sendDate: day, letterKey: `a-${day}` })),
    letter({ sendDate: '2026-11-04', letterKey: 'b-2026-11-04', tourId: 't-2', tourName: 'Tour Two', departOn: '2027-05-08', monthsLeft: 6 }),
    letter({ sendDate: '2026-12-02', letterKey: 'a-untraced' }), // past, but nothing in the records
    letter({ sendDate: '2026-12-16', letterKey: 'a-next' }),
  ]
  const facts = new Map<string, LetterFacts>([...traced.map((day) => [`a-${day}`, wentOut()] as const), ['b-2026-11-04', wentOut()]])
  const keysOf = (rows: Array<{ letterKey: string }>): string[] => rows.map((row) => row.letterKey)

  it('lists only letters with a trace, newest first, from the latest batch days (the oldest is cut)', () => {
    expect(PAST_BATCHES_SHOWN).toBe(4)
    const list = buildList(plan, facts, TODAY, 'now')
    expect(keysOf(list.pastLetters)).toEqual(['a-2026-11-04', 'b-2026-11-04', 'a-2026-10-07', 'a-2026-09-02', 'a-2026-08-05'])
  })

  it('a past letter with nothing in the records is not listed: history from before the system existed is noise', () => {
    expect(keysOf(buildList(plan, facts, TODAY, 'now').pastLetters)).not.toContain('a-untraced')
  })

  it('the upcoming list does not change because history exists', () => {
    const list = buildList(plan, facts, TODAY, 'now')
    expect(keysOf(list.scheduledLetters)).toEqual(['a-next'])
    expect(list.nextBatch?.sendDate).toBe('2026-12-16')
    expect(list.totalDistinctLetters).toBe(1)
  })

  it('a letter whose send day is today is upcoming, not past (even when it already left a trace)', () => {
    const withTrace = new Map<string, LetterFacts>([...facts, ['a-next', wentOut()]])
    const list = buildList(plan, withTrace, '2026-12-16', 'now')
    expect(keysOf(list.scheduledLetters)).toEqual(['a-next'])
    expect(keysOf(list.pastLetters)).not.toContain('a-next')
  })

  it('past rows keep their results', () => {
    const [first] = buildList(plan, facts, TODAY, 'now').pastLetters
    expect(first).toMatchObject({
      status: 'sent',
      counts: { recipients: 2, sent: 1, blocked: 1, failed: 0, rehearsal: 0, opened: null },
    })
  })

  it('a letter whose day has passed but was never released is listed as it is: still waiting, not sent', () => {
    const list = buildList(plan, new Map([['a-untraced', waiting]]), TODAY, 'now')
    expect(list.pastLetters).toHaveLength(1)
    expect(list.pastLetters[0]).toMatchObject({ letterKey: 'a-untraced', status: 'awaiting_release' })
  })

  it('a letter that was approved but never went out is listed too (still not sent), and its group counts it as overdue', () => {
    const list = buildList(plan, new Map([['a-untraced', approvedOnly]]), TODAY, 'now')
    expect(list.pastLetters).toHaveLength(1)
    expect(list.pastLetters[0]).toMatchObject({ letterKey: 'a-untraced', status: 'draft', counts: { sent: null } })
    expect(list.tourGroups.find((g) => g.tourName === 'Tour One')?.lettersOverdue).toBe(1)
  })

  it('nothing in the records at all means no history', () => {
    expect(buildList(plan, new Map(), TODAY, 'now').pastLetters).toEqual([])
  })
})

describe('buildList · tourGroups', () => {
  const one = (sendDate: NzDate, letterKey: string, monthsLeft: PlannedLetter['monthsLeft']) =>
    letter({ sendDate, letterKey, monthsLeft })
  const two = (sendDate: NzDate, letterKey: string, monthsLeft: PlannedLetter['monthsLeft']) =>
    letter({ sendDate, letterKey, monthsLeft, tourId: 't-2', tourName: 'Tour Two', departOn: '2027-05-08' })
  // 和真实的计划一样按发信日排好（buildList 靠这个认「最近两批」）。
  const plan: PlannedLetter[] = [
    one('2026-10-07', 'o1', 5),
    one('2026-11-04', 'o2', 4),
    two('2026-11-04', 't2-1', 6), // before this group had anything: past, no trace
    letter({ sendDate: '2026-11-04', letterKey: 'gone-1', tourId: 't-3', tourName: 'Tour Gone', departOn: '2026-12-01', monthsLeft: 1 }),
    one('2026-12-02', 'o3', 3),
    two('2026-12-16', 't2-2', 5),
    one('2027-01-06', 'o4', 2),
    one('2027-02-03', 'o5', 1),
  ]
  const facts = new Map<string, LetterFacts>([
    ['o1', wentOut([outcome({ contactId: 'c1', opened: true }), outcome({ contactId: 'c2', opened: false })])],
    ['o2', wentOut()],
    ['o3', waiting], // the day passed and nobody released it
    ['o4', waiting],
  ])
  const groups = buildList(plan, facts, TODAY, 'now').tourGroups
  const byName = Object.fromEntries(groups.map((group) => [group.tourName, group]))

  it('one row per tour × departure date, nearest departure first; a tour that has already left is not listed', () => {
    expect(groups.map((g) => [g.tourName, g.departOn])).toEqual([
      ['Tour One', '2027-03-11'],
      ['Tour Two', '2027-05-08'],
    ])
    expect(byName['Tour One'].groupKey).toBe(`g:${tourCodeOf('t-1')}:2027-03-11`)
    expect(byName['Tour One'].recipients).toBe(2)
  })

  it('counts what went out, what is still ahead, and what was due but never went out', () => {
    expect(byName['Tour One']).toMatchObject({ lettersSent: 2, lettersAhead: 2, lettersOverdue: 1 })
  })

  it('shows the latest letter that really went out, with its results', () => {
    expect(byName['Tour One'].lastSent).toEqual({
      letterKey: 'o2',
      sendDate: '2026-11-04',
      recipients: 2,
      sent: 1,
      blocked: 1,
      failed: 0,
      opened: null,
    })
  })

  it('shows the next letter that has not gone out, with where it stands', () => {
    expect(byName['Tour One'].next).toEqual({ letterKey: 'o4', sendDate: '2027-01-06', status: 'awaiting_release' })
  })

  it('letters missed before a group had any record are not counted as owed (they are never sent late)', () => {
    expect(byName['Tour Two']).toMatchObject({ lettersSent: 0, lettersAhead: 1, lettersOverdue: 0, lastSent: null })
    expect(byName['Tour Two'].next).toEqual({ letterKey: 't2-2', sendDate: '2026-12-16', status: 'draft' })
  })

  it('lists only the letters that have a row on the page, oldest first', () => {
    expect(byName['Tour One'].letterKeys).toEqual(['o1', 'o2', 'o3', 'o4']) // o5 is the third upcoming batch day: not on the page yet
    expect(byName['Tour Two'].letterKeys).toEqual(['t2-2']) // t2-1 is past with no trace: no row
  })

  it("today's batch, once sent, counts as sent and not as ahead", () => {
    const sentToday = new Map<string, LetterFacts>([['t2-2', wentOut()]])
    const [, tourTwo] = buildList(plan, sentToday, '2026-12-16', 'now').tourGroups
    expect(tourTwo).toMatchObject({ tourName: 'Tour Two', lettersSent: 1, lettersAhead: 0 })
    expect(tourTwo.next).toBeNull()
  })

  it('a tour that leaves today is still listed; one that left yesterday is not', () => {
    const leaving = [letter({ sendDate: '2026-11-04', letterKey: 'x', departOn: '2026-12-10' })]
    expect(buildList(leaving, new Map(), '2026-12-10', 'now').tourGroups).toHaveLength(1)
    expect(buildList(leaving, new Map(), '2026-12-11', 'now').tourGroups).toHaveLength(0)
  })

  it('opened comes from the last letter that went out, and stays null when this kind of letter does not record it', () => {
    const tracked = new Map<string, LetterFacts>([['o1', wentOut([outcome({ contactId: 'c1', opened: true }), outcome({ contactId: 'c2', opened: false })])]])
    const [only] = buildList([one('2026-10-07', 'o1', 5)], tracked, TODAY, 'now').tourGroups
    expect(only.lastSent?.opened).toBe(1)
    expect(byName['Tour One'].lastSent?.opened).toBeNull()
  })

  it('the same tour leaving on two dates is two rows, not one', () => {
    const plan2: PlannedLetter[] = [
      letter({ sendDate: '2026-12-16', letterKey: 'x1', tourId: 't-1', departOn: '2027-03-11' }),
      letter({ sendDate: '2026-12-16', letterKey: 'x2', tourId: 't-1', departOn: '2027-03-18' }),
    ]
    const two = buildList(plan2, new Map(), TODAY, 'now').tourGroups
    expect(two.map((g) => g.departOn)).toEqual(['2027-03-11', '2027-03-18'])
    expect(new Set(two.map((g) => g.groupKey)).size).toBe(2)
  })

  it('no orders, no groups', () => {
    expect(buildList([], new Map(), TODAY, 'now').tourGroups).toEqual([])
  })
})
