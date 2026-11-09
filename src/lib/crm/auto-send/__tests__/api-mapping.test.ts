import { describe, expect, it } from 'vitest'
import type { AutoLetterDetail, AutoLettersList, LetterRow } from '@/lib/messaging/letters/types'
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
    counts: { recipients: 10, sent: null, blocked: null, failed: null, rehearsal: 0 },
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

  it('summaryOf carries the counts, including rehearsal rows', () => {
    const s = summaryOf(row({ counts: { recipients: 10, sent: 8, blocked: 1, failed: 1, rehearsal: 2 } }))
    expect(s).toMatchObject({
      letterId: 'plan:2026-12-02:t-1:2027-03-11:3',
      sendDate: '2026-12-02',
      title: 'Sample subject',
      recipientCount: 10,
      sentCount: 8,
      blockedCount: 1,
      failedCount: 1,
      rehearsalCount: 2,
    })
  })
})

describe('mapAutoLettersList', () => {
  const list: AutoLettersList = {
    generatedAt: '2026-11-10T09:00:00+13:00',
    nextBatch: { sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 4, recipientCount: 21, phase: 'draft' },
    depositLetters: [],
    scheduledLetters: [row(), row({ letterKey: 'plan:2027-01-06:t-1:2027-03-11:2', sendDate: '2027-01-06', subject: null })],
    totalDistinctLetters: 32,
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

  it('no next batch and no letters give an empty overview', () => {
    const empty = mapAutoLettersList({ ...list, nextBatch: null, scheduledLetters: [], totalDistinctLetters: 0 })
    expect(empty).toEqual({ nextBatch: null, sections: [] })
  })
})

describe('mapAutoLetterDetail', () => {
  const detail: AutoLetterDetail = {
    letter: {
      ...row({ counts: { recipients: 3, sent: 1, blocked: 1, failed: 1, rehearsal: 0 }, status: 'sent' }),
      previewText: 'A short preview',
      bodyText: 'Kia ora {{first_name}},\n\nWhat to do now\n\n- one thing\n- another thing',
      sampleFirstName: 'Alex',
    },
    tiles: { recipients: 3, sent: 1, blocked: 1, failed: 1, rehearsal: 0 },
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

  it('a letter that is not written yet has no content', () => {
    const empty = mapAutoLetterDetail({
      ...detail,
      letter: { ...detail.letter, subject: null, previewText: null, bodyText: null },
    })
    expect(empty.content).toBeNull()
  })

  it('maps per-recipient opens only for Mailchimp letters, and carries the translated reason', () => {
    const mapped = mapAutoLetterDetail(detail)
    expect(mapped.openInfo).toEqual({ kind: 'per_recipient', openedPeople: 2, clickedPeople: 1 })
    expect(mapped.recipients.map((r) => r.engagement)).toEqual(['clicked', 'opened', null])
    expect(mapped.recipients[2]).toMatchObject({ displayName: null, reasonText: '他要求别再联系', reasonCode: null })

    const me = mapAutoLetterDetail({ ...detail, mailchimpSummary: null })
    expect(me.openInfo).toEqual({ kind: 'none' })
  })
})
