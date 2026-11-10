import { describe, expect, it } from 'vitest'
import {
  NOT_IN_BATCH_TEXT,
  SAMPLE_FIRST_NAME,
  buildDetail,
  buildLetterRow,
  buildList,
  deriveLetterStatus,
  type LetterFacts,
  type RecipientOutcome,
  type SendFacts,
} from '../aggregate'
import type { NzDate, PlannedLetter } from '../types'

function planned(over: Partial<PlannedLetter> & { sendDate: NzDate }): PlannedLetter {
  return {
    letterKey: `plan:${over.sendDate}:t-1:2027-03-11:3`,
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

/**
 * A recipient result. `settled` defaults to what the ledger would say: everything is final except queued rows
 * and unknown outcomes (a retryable block is the one case a test sets by hand with `settled: false`).
 */
function outcome(over: Partial<RecipientOutcome> & { contactId: string }): RecipientOutcome {
  const kind = over.outcome ?? 'sent'
  return { outcome: 'sent', reasonCode: null, settled: kind !== 'pending' && kind !== 'unknown', opened: null, clicked: null, ...over }
}

function sends(over: Partial<SendFacts> = {}): SendFacts {
  return { channel: 'me', proposalPending: false, proposalApproved: false, recipients: [], ...over }
}

describe('deriveLetterStatus', () => {
  it('no facts at all is a draft', () => {
    expect(deriveLetterStatus(null)).toBe('draft')
    expect(deriveLetterStatus(sends())).toBe('draft')
  })

  it('ME letters: a pending proposal waits for release; a letter is sent once at least one person really got it', () => {
    const delivered = [outcome({ contactId: 'c1' })]
    expect(deriveLetterStatus(sends({ proposalPending: true }))).toBe('awaiting_release')
    expect(deriveLetterStatus(sends({ recipients: delivered }))).toBe('sent')
    expect(deriveLetterStatus(sends({ proposalPending: true, recipients: delivered }))).toBe('awaiting_release')
  })

  describe('a letter nobody really got', () => {
    const rowsOf = (kind: RecipientOutcome['outcome'], over: Partial<RecipientOutcome> = {}) => [
      outcome({ contactId: 'c1', outcome: kind, ...over }),
      outcome({ contactId: 'c2', outcome: kind, ...over }),
    ]
    const clock = { sendDate: '2026-12-02', today: '2026-12-03' }

    it('every row settled without a receipt (skipped / suppressed / failed / bounced) → not sent', () => {
      expect(deriveLetterStatus(sends({ recipients: rowsOf('failed') }))).toBe('not_sent')
      expect(deriveLetterStatus(sends({ recipients: rowsOf('blocked') }))).toBe('not_sent')
      const mixed = [outcome({ contactId: 'c1', outcome: 'failed' }), outcome({ contactId: 'c2', outcome: 'blocked' })]
      expect(deriveLetterStatus(sends({ recipients: mixed }))).toBe('not_sent')
      // the same on the send day itself: the rows are final, no need to wait for the day to pass
      expect(deriveLetterStatus(sends({ recipients: mixed }), { sendDate: '2026-12-02', today: '2026-12-02' })).toBe('not_sent')
    })

    it('a row that can still change keeps the batch going: queued, or a retryable block, even after the send day', () => {
      expect(deriveLetterStatus(sends({ recipients: rowsOf('pending') }), clock)).toBe('draft')
      expect(deriveLetterStatus(sends({ recipients: rowsOf('blocked', { settled: false }) }), clock)).toBe('draft')
      const oneQueued = [outcome({ contactId: 'c1', outcome: 'failed' }), outcome({ contactId: 'c2', outcome: 'pending' })]
      expect(deriveLetterStatus(sends({ recipients: oneQueued }), clock)).toBe('draft')
    })

    it('rehearsal rows are never a send: a rehearsal-only letter is a draft, unless it was released and the day passed with nothing real sent', () => {
      expect(deriveLetterStatus(sends({ recipients: rowsOf('rehearsal') }), clock)).toBe('draft')
      expect(deriveLetterStatus(sends({ proposalApproved: true, recipients: rowsOf('rehearsal') }), { sendDate: '2026-12-02', today: '2026-12-02' })).toBe('draft')
      expect(deriveLetterStatus(sends({ proposalApproved: true, recipients: rowsOf('rehearsal') }), clock)).toBe('not_sent')
    })

    it('released but no record at all: not sent only once the send day has passed', () => {
      const released = sends({ proposalApproved: true })
      expect(deriveLetterStatus(released)).toBe('draft') // no clock given
      expect(deriveLetterStatus(released, { sendDate: '2026-12-02', today: '2026-12-01' })).toBe('draft')
      expect(deriveLetterStatus(released, { sendDate: '2026-12-02', today: '2026-12-02' })).toBe('draft') // the send day itself
      expect(deriveLetterStatus(released, clock)).toBe('not_sent')
      // never released and nothing recorded: nothing to say
      expect(deriveLetterStatus(sends(), clock)).toBe('draft')
    })

    it('Mailchimp letters never get this status (their release and results live in Mailchimp)', () => {
      expect(deriveLetterStatus(sends({ channel: 'mailchimp', recipients: rowsOf('failed') }), clock)).toBe('draft')
      expect(deriveLetterStatus(sends({ channel: 'mailchimp', proposalApproved: true }), clock)).toBe('draft')
    })
  })

  describe('results that are still unknown', () => {
    const clock = { sendDate: '2026-12-02', today: '2026-12-10' }

    it('nobody confirmed, but some outcomes are unknown → unknown (never "not sent": the letter may have arrived)', () => {
      expect(deriveLetterStatus(sends({ recipients: [outcome({ contactId: 'c1', outcome: 'unknown' })] }), clock)).toBe('unknown')
      const withFailure = [outcome({ contactId: 'c1', outcome: 'unknown' }), outcome({ contactId: 'c2', outcome: 'failed' })]
      expect(deriveLetterStatus(sends({ recipients: withFailure }), clock)).toBe('unknown')
      expect(deriveLetterStatus(sends({ recipients: withFailure }))).toBe('unknown') // no clock needed
    })

    it('one confirmed receipt beats everything else', () => {
      const rows = [outcome({ contactId: 'c1', outcome: 'unknown' }), outcome({ contactId: 'c2', outcome: 'sent' })]
      expect(deriveLetterStatus(sends({ recipients: rows }), clock)).toBe('sent')
    })

    it('a letter still waiting for release is waiting, whatever the old rows say', () => {
      const rows = [outcome({ contactId: 'c1', outcome: 'unknown' })]
      expect(deriveLetterStatus(sends({ proposalPending: true, recipients: rows }), clock)).toBe('awaiting_release')
    })

    it('Mailchimp letters never get this status', () => {
      const rows = [outcome({ contactId: 'c1', outcome: 'unknown' })]
      expect(deriveLetterStatus(sends({ channel: 'mailchimp', recipients: rows }), clock)).toBe('draft')
    })
  })

  it('one person who really got it is enough, whatever happened to the others', () => {
    const rows = [outcome({ contactId: 'c1', outcome: 'failed', reasonCode: 'bounced' }), outcome({ contactId: 'c2' })]
    expect(deriveLetterStatus(sends({ recipients: rows }))).toBe('sent')
  })

  it('Mailchimp letters: any real send makes it sent; there is no 等你放行 on this side', () => {
    expect(deriveLetterStatus(sends({ channel: 'mailchimp', recipients: [outcome({ contactId: 'c1' })] }))).toBe('sent')
    expect(deriveLetterStatus(sends({ channel: 'mailchimp', proposalPending: true }))).toBe('draft')
    expect(deriveLetterStatus(sends({ channel: 'mailchimp', recipients: [outcome({ contactId: 'c1', outcome: 'blocked' })] }))).toBe('draft')
  })

  it('rehearsal rows never make a Mailchimp letter sent', () => {
    expect(deriveLetterStatus(sends({ channel: 'mailchimp', recipients: [outcome({ contactId: 'c1', outcome: 'rehearsal' })] }))).toBe('draft')
  })
})

describe('buildLetterRow', () => {
  it('before anything is sent: counts are null (shown as a dash), subject null when not registered', () => {
    const row = buildLetterRow(planned({ sendDate: '2026-12-02' }), null)
    expect(row.subject).toBeNull()
    expect(row.status).toBe('draft')
    expect(row.channel).toBe('me')
    expect(row.counts).toEqual({ recipients: 2, sent: null, blocked: null, failed: null, rehearsal: 0, unknown: 0, opened: null })
    expect(row.audience).toEqual({ tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: 3 })
  })

  it('weekly letters have monthsLeft null', () => {
    const row = buildLetterRow(planned({ sendDate: '2027-02-10', monthsLeft: 'weekly' }), null)
    expect(row.audience.monthsLeft).toBeNull()
  })

  it('counts real sends, blocked, failed and rehearsal separately; rehearsal is never counted as sent', () => {
    const facts: LetterFacts = {
      registry: { subject: 'Subject', previewText: null, bodyText: null },
      sends: sends({
        recipients: [
          outcome({ contactId: 'c1', outcome: 'sent' }),
          outcome({ contactId: 'c2', outcome: 'rehearsal' }),
          outcome({ contactId: 'c3', outcome: 'blocked', reasonCode: 'dnc' }),
          outcome({ contactId: 'c4', outcome: 'failed', reasonCode: 'bounced' }),
        ],
      }),
    }
    const row = buildLetterRow(planned({ sendDate: '2026-12-02' }), facts)
    expect(row.subject).toBe('Subject')
    expect(row.status).toBe('sent')
    expect(row.counts).toEqual({ recipients: 4, sent: 1, blocked: 1, failed: 1, rehearsal: 1, unknown: 0, opened: null }) // c1, c2 planned + c3, c4 only in the records
  })

  describe('opened (reference only)', () => {
    const openedOf = (recipients: RecipientOutcome[]): number | null =>
      buildLetterRow(planned({ sendDate: '2026-12-02' }), { registry: null, sends: sends({ recipients }) }).counts.opened

    it('this kind of letter does not record opens → null (a dash), never 0', () => {
      expect(openedOf([outcome({ contactId: 'c1' }), outcome({ contactId: 'c2' })])).toBeNull()
      expect(openedOf([])).toBeNull()
    })

    it('counts the people who opened among real sends only; blocked and rehearsal rows are left out', () => {
      expect(
        openedOf([
          outcome({ contactId: 'c1', opened: true }),
          outcome({ contactId: 'c2', opened: false }),
          outcome({ contactId: 'c3', outcome: 'blocked', reasonCode: 'dnc', opened: true }),
          outcome({ contactId: 'c4', outcome: 'rehearsal', opened: true }),
        ]),
      ).toBe(1)
    })

    it('tracked but nobody has opened yet is 0, not a dash', () => {
      expect(openedOf([outcome({ contactId: 'c1', opened: false })])).toBe(0)
    })

    it('one tracked person is enough to say the letter is tracked; untracked people do not count as opened', () => {
      expect(openedOf([outcome({ contactId: 'c1', opened: true }), outcome({ contactId: 'c2', opened: null })])).toBe(1)
    })

    it('the drawer tiles carry the same number', () => {
      const detail = buildDetail(planned({ sendDate: '2026-12-02' }), {
        registry: null,
        sends: sends({ recipients: [outcome({ contactId: 'c1', opened: true }), outcome({ contactId: 'c2', opened: false })] }),
      })
      expect(detail.tiles.opened).toBe(1)
      expect(detail.letter.counts.opened).toBe(1)
    })
  })
})

describe('buildList', () => {
  const plan: PlannedLetter[] = [
    planned({ sendDate: '2026-11-04', letterKey: 'k0' }), // already past
    planned({ sendDate: '2026-12-02', letterKey: 'k1' }),
    planned({ sendDate: '2026-12-02', letterKey: 'k2', tourId: 't-2', recipients: [{ contactId: 'c1', displayName: 'Bea', seats: 1 }, { contactId: 'c9', displayName: 'Cy', seats: 1 }] }),
    planned({ sendDate: '2027-01-06', letterKey: 'k3' }),
    planned({ sendDate: '2027-02-03', letterKey: 'k4' }),
  ]

  it('starts from today: the next batch is the first day with letters, people counted once', () => {
    const list = buildList(plan, new Map(), '2026-11-10', '2026-11-10T09:00:00+13:00')
    expect(list.generatedAt).toBe('2026-11-10T09:00:00+13:00')
    expect(list.nextBatch).toEqual({
      sendDate: '2026-12-02',
      weekdayLabel: '周三',
      letterCount: 2,
      recipientCount: 3, // c1, c2, c9: c1 is in both letters but is one person
      phase: 'draft',
    })
    expect(list.totalDistinctLetters).toBe(4)
  })

  it('lists only the next two batch days under 按期发送的信, and leaves the deposit panel empty', () => {
    const list = buildList(plan, new Map(), '2026-11-10', 'now')
    expect(list.scheduledLetters.map((l) => l.letterKey)).toEqual(['k1', 'k2', 'k3'])
    expect(list.depositLetters).toEqual([])
  })

  it('a batch day equal to today still counts as upcoming', () => {
    expect(buildList(plan, new Map(), '2026-12-02', 'now').nextBatch?.sendDate).toBe('2026-12-02')
    expect(buildList(plan, new Map(), '2026-12-03', 'now').nextBatch?.sendDate).toBe('2027-01-06')
  })

  it('batch phase: all sent → sent; any awaiting release → awaiting; otherwise draft', () => {
    const sentFacts: LetterFacts = { registry: null, sends: sends({ recipients: [outcome({ contactId: 'c1' })] }) }
    const awaitingFacts: LetterFacts = { registry: null, sends: sends({ proposalPending: true }) }
    expect(buildList(plan, new Map([['k1', sentFacts], ['k2', sentFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('sent')
    expect(buildList(plan, new Map([['k1', sentFacts], ['k2', awaitingFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('awaiting_release')
    expect(buildList(plan, new Map([['k1', sentFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('draft')
  })

  describe('batch phase with the new statuses', () => {
    const rowsOf = (kind: RecipientOutcome['outcome']): LetterFacts => ({
      registry: null,
      sends: sends({ recipients: [outcome({ contactId: 'c1', outcome: kind, reasonCode: kind === 'failed' ? 'bounced' : null })] }),
    })
    const sent = rowsOf('sent')
    const phaseOf = (k1: LetterFacts, k2: LetterFacts) =>
      buildList(plan, new Map([['k1', k1], ['k2', k2]]), '2026-12-02', 'now').nextBatch?.phase

    it('a letter with a result nobody can tell yet makes the whole batch unknown: that is the one to see first', () => {
      expect(phaseOf(sent, rowsOf('unknown'))).toBe('unknown')
      expect(phaseOf(rowsOf('failed'), rowsOf('unknown'))).toBe('unknown')
    })

    it('a letter that nobody got because of errors makes the batch not sent', () => {
      expect(phaseOf(sent, rowsOf('failed'))).toBe('not_sent')
    })

    it('a letter that nobody got only because the rules skipped everyone does not spoil a batch that went out', () => {
      expect(phaseOf(sent, rowsOf('blocked'))).toBe('sent')
    })

    it('released but nothing recorded counts as an error once the send day has passed, not before', () => {
      const released: LetterFacts = { registry: null, sends: sends({ proposalApproved: true }) }
      expect(phaseOf(sent, released)).toBe('draft') // the send day itself
      const later = buildList(plan, new Map([['k1', sent], ['k2', released]]), '2026-11-10', 'now')
      expect(later.nextBatch?.phase).toBe('draft') // the batch is still ahead
    })
  })

  it('nothing planned: no next batch, empty lists, zero total', () => {
    expect(buildList([], new Map(), '2026-11-10', 'now')).toEqual({
      generatedAt: 'now',
      nextBatch: null,
      depositLetters: [],
      scheduledLetters: [],
      pastLetters: [],
      tourGroups: [],
      totalDistinctLetters: 0,
    })
    expect(buildList(plan, new Map(), '2030-01-01', 'now').nextBatch).toBeNull()
  })
})

describe('buildDetail', () => {
  const letter = planned({
    sendDate: '2027-01-06',
    recipients: [
      { contactId: 'c1', displayName: 'Bea', seats: 2 },
      { contactId: 'c2', displayName: 'Al', seats: null },
      { contactId: 'c3', displayName: null, seats: 1 },
    ],
  })

  it('an unsent, unregistered letter: everyone pending, no body, sample first name given by the server', () => {
    const detail = buildDetail(letter, null)
    expect(detail.letter.subject).toBeNull()
    expect(detail.letter.previewText).toBeNull()
    expect(detail.letter.bodyText).toBeNull()
    expect(detail.letter.sampleFirstName).toBe(SAMPLE_FIRST_NAME)
    expect(detail.tiles).toEqual({ recipients: 3, sent: null, blocked: null, failed: null, rehearsal: 0, unknown: 0, opened: null })
    expect(detail.mailchimpSummary).toBeNull()
    expect(detail.recipients.map((r) => [r.displayName, r.status])).toEqual([
      ['Al', 'pending'],
      ['Bea', 'pending'],
      [null, 'pending'],
    ])
  })

  it('takes subject, preview and body from the registry', () => {
    const detail = buildDetail(letter, {
      registry: { subject: 'Hello', previewText: 'Preview', bodyText: 'Kia ora {{first_name}}' },
      sends: null,
    })
    expect(detail.letter).toMatchObject({ subject: 'Hello', previewText: 'Preview', bodyText: 'Kia ora {{first_name}}' })
  })

  it('translates blocked and failed reasons into plain Chinese; unknown codes say 系统出错; others get no reason', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({
        recipients: [
          outcome({ contactId: 'c1', outcome: 'sent' }),
          outcome({ contactId: 'c2', outcome: 'blocked', reasonCode: 'frequency_full' }),
          outcome({ contactId: 'c3', outcome: 'failed', reasonCode: 'something_new' }),
        ],
      }),
    })
    const byId = Object.fromEntries(detail.recipients.map((r) => [r.contactId, r]))
    expect(byId.c1).toMatchObject({ status: 'sent', reasonText: null })
    expect(byId.c2).toMatchObject({ status: 'blocked', reasonText: '他最近 7 天已收 2 封' })
    expect(byId.c3).toMatchObject({ status: 'failed', reasonText: '系统出错' })
    expect(detail.tiles).toMatchObject({ recipients: 3, sent: 1, blocked: 1, failed: 1, rehearsal: 0 })
  })

  it('unknown outcomes are listed with a plain reason and counted apart; a complaint still counts as received', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({
        recipients: [
          outcome({ contactId: 'c1', outcome: 'unknown', reasonCode: 'unknown_outcome' }),
          outcome({ contactId: 'c2', outcome: 'sent', reasonCode: 'complained' }),
          outcome({ contactId: 'c3', outcome: 'sent' }),
        ],
      }),
    })
    const byId = Object.fromEntries(detail.recipients.map((r) => [r.contactId, r]))
    expect(byId.c1).toMatchObject({ status: 'unknown', reasonText: '发送结果不明，等人核对' })
    expect(byId.c2).toMatchObject({ status: 'sent', reasonText: '他投诉过' })
    expect(byId.c3).toMatchObject({ status: 'sent', reasonText: null })
    expect(detail.tiles).toMatchObject({ recipients: 3, sent: 2, unknown: 1 })
    expect(detail.letter.counts.unknown).toBe(1)
    expect(detail.letter.status).toBe('sent')
  })

  it('a letter whose rows are all unknown is unknown, and says so in the tiles and the list row', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({ recipients: [outcome({ contactId: 'c1', outcome: 'unknown' }), outcome({ contactId: 'c2', outcome: 'unknown' })] }),
    })
    expect(detail.letter.status).toBe('unknown')
    expect(detail.tiles).toMatchObject({ sent: 0, unknown: 2 })
  })

  it('rehearsal rows are shown as rehearsal and counted apart from sent', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({ proposalPending: true, recipients: [outcome({ contactId: 'c1', outcome: 'rehearsal' })] }),
    })
    expect(detail.recipients.find((r) => r.contactId === 'c1')?.status).toBe('rehearsal')
    expect(detail.tiles).toMatchObject({ sent: 0, rehearsal: 1 })
    expect(detail.letter.status).toBe('awaiting_release')
  })

  it('Mailchimp letters carry per-person opens and a summary; ME letters carry neither', () => {
    const rows = [
      outcome({ contactId: 'c1', opened: true, clicked: true }),
      outcome({ contactId: 'c2', opened: true, clicked: false }),
      outcome({ contactId: 'c3', outcome: 'blocked', reasonCode: 'dnc', opened: true }),
    ]
    const mailchimp = buildDetail(letter, { registry: null, sends: sends({ channel: 'mailchimp', recipients: rows }) })
    expect(mailchimp.mailchimpSummary).toEqual({ opened: 2, clicked: 1 }) // the blocked row is not counted
    expect(mailchimp.recipients.find((r) => r.contactId === 'c1')).toMatchObject({ opened: true, clicked: true })

    const me = buildDetail(letter, { registry: null, sends: sends({ recipients: rows.map((r) => ({ ...r, opened: null, clicked: null })) }) })
    expect(me.mailchimpSummary).toBeNull()
    expect(me.recipients.every((r) => r.opened === null && r.clicked === null)).toBe(true)
  })

  it('the recipient total never falls below the people who have a result: people only in the records are counted too', () => {
    const rows = [outcome({ contactId: 'c1' }), outcome({ contactId: 'gone-1' }), outcome({ contactId: 'gone-2', outcome: 'failed', reasonCode: 'bounced' })]
    const detail = buildDetail(letter, { registry: null, sends: sends({ recipients: rows }) })
    expect(detail.letter.counts.recipients).toBe(5) // c1, c2, c3 planned + two people only in the records
    expect(detail.tiles.recipients).toBe(detail.recipients.length) // same number as the rows of the list
    const { sent, blocked, failed, rehearsal } = detail.tiles
    expect((sent ?? 0) + (blocked ?? 0) + (failed ?? 0) + rehearsal).toBeLessThanOrEqual(detail.tiles.recipients)
  })

  it('a person with a send record who is no longer in the plan is still listed (name unknown)', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({ recipients: [outcome({ contactId: 'gone', outcome: 'sent' })] }),
    })
    const gone = detail.recipients.find((r) => r.contactId === 'gone')
    expect(gone).toMatchObject({ displayName: null, seats: null, status: 'sent' })
    expect(detail.recipients).toHaveLength(4)
  })

  it('never exposes an email address: the output has no such field', () => {
    const json = JSON.stringify(buildDetail(letter, null))
    expect(json).not.toMatch(/@/)
    expect(json).not.toMatch(/email/i)
  })
})

describe('buildDetail · a batch that has already gone out', () => {
  const letter = planned({
    sendDate: '2026-12-02',
    recipients: [
      { contactId: 'c1', displayName: 'Bea', seats: 2 },
      { contactId: 'c2', displayName: 'Al', seats: null },
      { contactId: 'c3', displayName: 'Cy', seats: 1 },
    ],
  })
  const wentOut: LetterFacts = { registry: null, sends: sends({ recipients: [outcome({ contactId: 'c1' }), outcome({ contactId: 'c3', outcome: 'pending' })] }) }
  const note = (detail: ReturnType<typeof buildDetail>, id: string) => detail.recipients.find((r) => r.contactId === id)?.reasonText

  it('people planned but absent from the send record say they were not yet depositors, not 待发', () => {
    const detail = buildDetail(letter, wentOut, '2026-12-10')
    expect(NOT_IN_BATCH_TEXT).toBe('这一批发出时他不在名单里（不补发）')
    expect(detail.recipients.find((r) => r.contactId === 'c2')).toMatchObject({ status: 'pending', reasonText: NOT_IN_BATCH_TEXT })
    expect(note(detail, 'c1')).toBeNull() // has a record: sent
    expect(note(detail, 'c3')).toBeNull() // has a record (claimed, still pending): not "not in batch"
  })

  it('only after the send day, only when the batch really went out', () => {
    expect(note(buildDetail(letter, wentOut, '2026-12-02'), 'c2')).toBeNull() // the send day itself
    expect(note(buildDetail(letter, wentOut, '2026-12-01'), 'c2')).toBeNull() // before it
    expect(note(buildDetail(letter, wentOut), 'c2')).toBeNull() // no "today" given
    expect(note(buildDetail(letter, null, '2026-12-10'), 'c2')).toBeNull() // nothing sent at all
    const awaiting: LetterFacts = { registry: null, sends: sends({ proposalPending: true }) }
    expect(note(buildDetail(letter, awaiting, '2026-12-10'), 'c2')).toBeNull() // still waiting for release
  })
})
