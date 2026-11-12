import { describe, expect, it } from 'vitest'
import type { AutoLetterDetail, AutoLettersList, LetterRow, TourGroupRow } from '@/lib/messaging/letters/types'
import {
  audienceLabelOf,
  mapAutoLetterDetail,
  mapAutoLettersList,
  summaryOf,
  viewStatusOf,
} from '../api-mapping'

function row(overrides: Partial<LetterRow> = {}): LetterRow {
  return {
    letterKey: 'plan:2026-12-02:t-1:2027-03-11:3',
    sendDate: '2026-12-02',
    audience: { tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: 3 },
    subject: 'Sample subject',
    status: 'draft',
    channel: 'me',
    counts: { recipients: 10, sent: null, blocked: null, failed: null, rehearsal: 0, unknown: 0, opened: null },
    ...overrides,
  }
}

describe('audience label and status', () => {
  it('writes 「3月11日团 · 3个月信」 and 「每周信」', () => {
    expect(audienceLabelOf(row())).toBe('3月11日团 · 3个月信')
    expect(audienceLabelOf(row({ audience: { tourName: 'T', departOn: '2027-05-08', monthsLeft: null } }))).toBe(
      '5月8日团 · 每周信',
    )
  })

  it('an unwritten draft is 计划中, a written draft stays draft, the others pass through', () => {
    expect(viewStatusOf('draft', null)).toBe('planned')
    expect(viewStatusOf('draft', 'Subject')).toBe('draft')
    expect(viewStatusOf('awaiting_release', 'Subject')).toBe('awaiting_release')
    expect(viewStatusOf('sent', null)).toBe('sent')
  })

  it('a letter nobody got and a letter with unknown results keep their own status, written or not', () => {
    expect(viewStatusOf('not_sent', null)).toBe('not_sent')
    expect(viewStatusOf('not_sent', 'Subject')).toBe('not_sent')
    expect(viewStatusOf('unknown', null)).toBe('unknown')
    expect(viewStatusOf('unknown', 'Subject')).toBe('unknown')
  })

  it('summaryOf carries the counts, including rehearsal rows and the opened number', () => {
    const s = summaryOf(row({ counts: { recipients: 10, sent: 6, blocked: 1, failed: 1, rehearsal: 2, unknown: 2, opened: 5 } }))
    expect(s).toMatchObject({
      letterId: 'plan:2026-12-02:t-1:2027-03-11:3',
      sendDate: '2026-12-02',
      title: 'Sample subject',
      recipientCount: 10,
      sentCount: 6,
      blockedCount: 1,
      failedCount: 1,
      unknownCount: 2,
      rehearsalCount: 2,
      openedCount: 5,
    })
  })

  it('a letter that does not record opens keeps openedCount null (shown as a dash)', () => {
    expect(summaryOf(row()).openedCount).toBeNull()
  })
})

describe('mapAutoLettersList', () => {
  const list: AutoLettersList = {
    generatedAt: '2026-11-10T09:00:00+13:00',
    nextBatch: { sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 4, recipientCount: 21, phase: 'draft' },
    depositLetters: [],
    scheduledLetters: [row(), row({ letterKey: 'plan:2027-01-06:t-1:2027-03-11:2', sendDate: '2027-01-06', subject: null })],
    pastLetters: [],
    tourGroups: [],
    totalDistinctLetters: 32,
    cadence: { firstMonth: 6 },
  }

  it('builds the next-batch card and a scheduled panel whose text comes from the data', () => {
    const overview = mapAutoLettersList(list)
    expect(overview.nextBatch).toEqual({ sendDate: '2026-12-02', letterCount: 4, recipientCount: 21, status: 'draft' })
    expect(overview.sections).toHaveLength(1)
    const [panel] = overview.sections
    expect(panel).toMatchObject({ key: 'scheduled', kind: 'scheduled', title: '按期发送的信' })
    expect(panel.note).toBe('每月第一个周三；最后一个月每周三')
    expect(panel.footnote).toBe('共 32 个不同的信，这里先列最近两批；往后的批次到时间再出现。')
    expect(panel.letters.map((l) => l.status)).toEqual(['draft', 'planned'])
  })

  it('shows the deposit panel only when the interface returns deposit letters', () => {
    const withDeposit = mapAutoLettersList({ ...list, depositLetters: [row({ sendDate: '' })] })
    expect(withDeposit.sections.map((s) => s.key)).toEqual(['deposit', 'scheduled'])
    const [deposit] = withDeposit.sections
    expect(deposit.kind).toBe('trigger')
    expect(deposit.letters[0]).toMatchObject({ sendDate: null, whenLabel: '定金确认后' })
    expect(deposit.footnote).toContain('超过 6 个月')
  })

  it('the deposit footnote takes its number from the interface (the rhythm), and is left out when there is no rhythm', () => {
    const deposit = [row({ sendDate: '' })]
    expect(mapAutoLettersList({ ...list, depositLetters: deposit, cadence: { firstMonth: 4 } }).sections[0].footnote).toContain('超过 4 个月')
    expect(mapAutoLettersList({ ...list, depositLetters: deposit, cadence: null }).sections[0].footnote).toBeNull()
  })

  it('letters whose send day has passed get their own panel after the upcoming one, with their results', () => {
    const past = row({
      letterKey: 'plan:2026-11-04:t-1:2027-03-11:4',
      sendDate: '2026-11-04',
      status: 'sent',
      counts: { recipients: 10, sent: 8, blocked: 1, failed: 1, rehearsal: 0, unknown: 0, opened: 6 },
    })
    const overview = mapAutoLettersList({ ...list, pastLetters: [past] })
    expect(overview.sections.map((s) => s.key)).toEqual(['scheduled', 'past'])
    const panel = overview.sections[1]
    expect(panel).toMatchObject({ kind: 'scheduled', title: '已过发信日的信' })
    expect(panel.footnote).toContain('这一批没有发出去')
    expect(panel.letters[0]).toMatchObject({ status: 'sent', sentCount: 8, blockedCount: 1, failedCount: 1, openedCount: 6 })
  })

  it('with nothing upcoming the history still shows (it is the only thing worth seeing then)', () => {
    const past = row({ sendDate: '2026-11-04', status: 'sent' })
    const overview = mapAutoLettersList({ ...list, nextBatch: null, scheduledLetters: [], totalDistinctLetters: 0, pastLetters: [past] })
    expect(overview.sections.map((s) => s.key)).toEqual(['past'])
  })

  it('no next batch and no letters give an empty overview', () => {
    const empty = mapAutoLettersList({ ...list, nextBatch: null, scheduledLetters: [], totalDistinctLetters: 0 })
    expect(empty).toEqual({ nextBatch: null, sections: [], groups: [] })
  })

  it('passes the server notices through only when there are some', () => {
    const notice = '有 2 张已交定金的订单没有出发日（或日期不对），没排进任何一封信。'
    expect(mapAutoLettersList({ ...list, notices: [notice] }).notices).toEqual([notice])
    expect('notices' in mapAutoLettersList({ ...list, notices: [] })).toBe(false)
    expect('notices' in mapAutoLettersList(list)).toBe(false)
  })
})

describe('mapAutoLettersList · tour groups', () => {
  const written = row({ letterKey: 'k-written', subject: 'Written subject' })
  const unwritten = row({ letterKey: 'k-unwritten', subject: null })
  const group = (over: Partial<TourGroupRow> = {}): TourGroupRow => ({
    groupKey: 'g:abc1234:2027-03-11',
    tourName: 'Tour One',
    departOn: '2027-03-11',
    recipients: 10,
    lettersSent: 2,
    lettersAhead: 5,
    lettersOverdue: 1,
    lettersUnknown: 0,
    lastSent: { letterKey: 'k-old', sendDate: '2026-11-04', recipients: 10, sent: 8, blocked: 1, failed: 1, unknown: 0, opened: 6 },
    next: { letterKey: 'k-written', sendDate: '2026-12-02', status: 'draft' },
    letterKeys: ['k-old', 'k-written'],
    ...over,
  })
  const base: AutoLettersList = {
    generatedAt: 'now',
    nextBatch: null,
    depositLetters: [],
    scheduledLetters: [written, unwritten],
    pastLetters: [],
    tourGroups: [group()],
    totalDistinctLetters: 2,
    cadence: { firstMonth: 6 },
  }

  it('carries every number of the row across, with plain names', () => {
    const [mapped] = mapAutoLettersList(base).groups
    expect(mapped).toEqual({
      groupId: 'g:abc1234:2027-03-11',
      tourName: 'Tour One',
      departOn: '2027-03-11',
      recipientCount: 10,
      lettersSent: 2,
      lettersAhead: 5,
      lettersOverdue: 1,
      lettersUnknown: 0,
      lastSent: { letterId: 'k-old', sendDate: '2026-11-04', recipientCount: 10, sentCount: 8, blockedCount: 1, failedCount: 1, unknownCount: 0, openedCount: 6 },
      next: { letterId: 'k-written', sendDate: '2026-12-02', status: 'draft' },
      letterIds: ['k-old', 'k-written'],
    })
  })

  it('the next letter is 计划中 when it has no subject yet, and also when it is a far-off letter the page has no row for', () => {
    const unwrittenNext = group({ next: { letterKey: 'k-unwritten', sendDate: '2027-01-06', status: 'draft' } })
    expect(mapAutoLettersList({ ...base, tourGroups: [unwrittenNext] }).groups[0].next?.status).toBe('planned')
    const farOff = group({ next: { letterKey: 'k-far', sendDate: '2027-04-07', status: 'draft' } })
    expect(mapAutoLettersList({ ...base, tourGroups: [farOff] }).groups[0].next?.status).toBe('planned')
    const waiting = group({ next: { letterKey: 'k-written', sendDate: '2026-12-02', status: 'awaiting_release' } })
    expect(mapAutoLettersList({ ...base, tourGroups: [waiting] }).groups[0].next?.status).toBe('awaiting_release')
  })

  it('a group nothing has gone out for, and one with nothing left to send, keep their nulls', () => {
    const fresh = group({ lastSent: null, lettersSent: 0, lettersOverdue: 0 })
    const done = group({ next: null, lettersAhead: 0 })
    const [a, b] = mapAutoLettersList({ ...base, tourGroups: [fresh, done] }).groups
    expect(a.lastSent).toBeNull()
    expect(b.next).toBeNull()
  })

  it('a letter that does not record opens shows null, not zero', () => {
    const quiet = group({ lastSent: { letterKey: 'k', sendDate: '2026-11-04', recipients: 2, sent: 2, blocked: 0, failed: 0, unknown: 0, opened: null } })
    expect(mapAutoLettersList({ ...base, tourGroups: [quiet] }).groups[0].lastSent?.openedCount).toBeNull()
  })

  it('carries the letters whose results are unknown, in the group and in its last sent letter', () => {
    const unsure = group({
      lettersUnknown: 2,
      lastSent: { letterKey: 'k', sendDate: '2026-11-04', recipients: 5, sent: 3, blocked: 0, failed: 0, unknown: 2, opened: null },
    })
    const [mapped] = mapAutoLettersList({ ...base, tourGroups: [unsure] }).groups
    expect(mapped.lettersUnknown).toBe(2)
    expect(mapped.lastSent?.unknownCount).toBe(2)
  })

  it('the next batch card can say a batch was not sent or has unknown results', () => {
    const batch = (phase: 'not_sent' | 'unknown') => ({ sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 2, recipientCount: 6, phase })
    expect(mapAutoLettersList({ ...base, nextBatch: batch('not_sent') }).nextBatch?.status).toBe('not_sent')
    expect(mapAutoLettersList({ ...base, nextBatch: batch('unknown') }).nextBatch?.status).toBe('unknown')
  })
})

describe('mapAutoLetterDetail', () => {
  const detail: AutoLetterDetail = {
    letter: {
      ...row({ counts: { recipients: 3, sent: 1, blocked: 1, failed: 1, rehearsal: 0, unknown: 0, opened: null }, status: 'sent' }),
      previewText: 'A short preview',
      bodyText: 'Kia ora {{first_name}},\n\nWhat to do now\n\n- one thing\n- another thing',
      sampleFirstName: 'Alex',
    },
    tiles: { recipients: 3, sent: 1, blocked: 1, failed: 1, rehearsal: 0, unknown: 0, opened: null },
    mailchimpSummary: { opened: 2, clicked: 1 },
    recipients: [
      { contactId: 'c1', displayName: 'Pat One', seats: 2, status: 'sent', reasonText: null, opened: true, clicked: true },
      { contactId: 'c2', displayName: 'Sam Two', seats: null, status: 'sent', reasonText: null, opened: true, clicked: false },
      { contactId: 'c3', displayName: null, seats: 1, status: 'blocked', reasonText: '他要求别再联系', opened: null, clicked: null },
    ],
  }

  it('fills the sample name into the body and cuts it into blocks', () => {
    const mapped = mapAutoLetterDetail(detail)
    expect(mapped.content?.title).toBe('Sample subject')
    expect(mapped.content?.previewText).toBe('A short preview')
    expect(mapped.content?.sampleFirstName).toBe('Alex')
    expect(mapped.content?.body).toEqual([
      { kind: 'paragraph', text: 'Kia ora Alex,' },
      { kind: 'heading', text: 'What to do now' },
      { kind: 'bullet', text: 'one thing' },
      { kind: 'bullet', text: 'another thing' },
    ])
  })

  it('a recipient whose result is unknown keeps that status and its plain reason', () => {
    const mapped = mapAutoLetterDetail({
      ...detail,
      letter: { ...detail.letter, status: 'unknown', counts: { ...detail.letter.counts, sent: 0, blocked: 0, failed: 0, unknown: 3 } },
      recipients: [
        { contactId: 'c1', displayName: 'Pat One', seats: 2, status: 'unknown', reasonText: '发送结果不明，等人核对', opened: null, clicked: null },
      ],
    })
    expect(mapped.summary).toMatchObject({ status: 'unknown', unknownCount: 3 })
    expect(mapped.recipients[0]).toMatchObject({ status: 'unknown', reasonText: '发送结果不明，等人核对' })
  })

  it('a letter that is not written yet has no content', () => {
    const empty = mapAutoLetterDetail({
      ...detail,
      letter: { ...detail.letter, subject: null, previewText: null, bodyText: null },
    })
    expect(empty.content).toBeNull()
  })

  it('maps per-recipient opens for Mailchimp letters, and carries the translated reason', () => {
    const mapped = mapAutoLetterDetail(detail)
    expect(mapped.openInfo).toEqual({ kind: 'per_recipient', openedPeople: 2, clickedPeople: 1, fromMailchimp: true })
    expect(mapped.recipients.map((r) => r.engagement)).toEqual(['clicked', 'opened', null])
    expect(mapped.recipients[2]).toMatchObject({ displayName: null, reasonText: '他要求别再联系', reasonCode: null })
  })

  it('a letter that records opens by itself (not Mailchimp) is read from the recipients, real sends only', () => {
    const tracked = mapAutoLetterDetail({
      ...detail,
      mailchimpSummary: null,
      recipients: [
        ...detail.recipients.slice(0, 2),
        { contactId: 'c3', displayName: 'Blocked', seats: 1, status: 'blocked', reasonText: 'x', opened: true, clicked: true },
      ],
    })
    expect(tracked.openInfo).toEqual({ kind: 'per_recipient', openedPeople: 2, clickedPeople: 1, fromMailchimp: false })
  })

  it('a letter that does not record opens has no open info at all', () => {
    const me = mapAutoLetterDetail({
      ...detail,
      mailchimpSummary: null,
      recipients: detail.recipients.map((r) => ({ ...r, opened: null, clicked: null })),
    })
    expect(me.openInfo).toEqual({ kind: 'none' })
  })
})
