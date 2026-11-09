import { describe, expect, it } from 'vitest'
import {
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

function outcome(over: Partial<RecipientOutcome> & { contactId: string }): RecipientOutcome {
  return { outcome: 'sent', reasonCode: null, opened: null, clicked: null, ...over }
}

function sends(over: Partial<SendFacts> = {}): SendFacts {
  return { channel: 'me', proposalPending: false, started: false, recipients: [], ...over }
}

describe('deriveLetterStatus', () => {
  it('no facts at all is a draft', () => {
    expect(deriveLetterStatus(null)).toBe('draft')
    expect(deriveLetterStatus(sends())).toBe('draft')
  })

  it('ME letters: a pending proposal waits for release, a started one is sent', () => {
    expect(deriveLetterStatus(sends({ proposalPending: true }))).toBe('awaiting_release')
    expect(deriveLetterStatus(sends({ started: true }))).toBe('sent')
    expect(deriveLetterStatus(sends({ proposalPending: true, started: true }))).toBe('awaiting_release')
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
    expect(row.counts).toEqual({ recipients: 2, sent: null, blocked: null, failed: null, rehearsal: 0 })
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
        started: true,
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
    expect(row.counts).toEqual({ recipients: 2, sent: 1, blocked: 1, failed: 1, rehearsal: 1 })
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
    const sentFacts: LetterFacts = { registry: null, sends: sends({ started: true }) }
    const awaitingFacts: LetterFacts = { registry: null, sends: sends({ proposalPending: true }) }
    expect(buildList(plan, new Map([['k1', sentFacts], ['k2', sentFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('sent')
    expect(buildList(plan, new Map([['k1', sentFacts], ['k2', awaitingFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('awaiting_release')
    expect(buildList(plan, new Map([['k1', sentFacts]]), '2026-11-10', 'now').nextBatch?.phase).toBe('draft')
  })

  it('nothing planned: no next batch, empty lists, zero total', () => {
    expect(buildList([], new Map(), '2026-11-10', 'now')).toEqual({
      generatedAt: 'now',
      nextBatch: null,
      depositLetters: [],
      scheduledLetters: [],
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
    expect(detail.tiles).toEqual({ recipients: 3, sent: null, blocked: null, failed: null, rehearsal: 0 })
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
        started: true,
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

    const me = buildDetail(letter, { registry: null, sends: sends({ started: true, recipients: rows.map((r) => ({ ...r, opened: null, clicked: null })) }) })
    expect(me.mailchimpSummary).toBeNull()
    expect(me.recipients.every((r) => r.opened === null && r.clicked === null)).toBe(true)
  })

  it('a person with a send record who is no longer in the plan is still listed (name unknown)', () => {
    const detail = buildDetail(letter, {
      registry: null,
      sends: sends({ started: true, recipients: [outcome({ contactId: 'gone', outcome: 'sent' })] }),
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
