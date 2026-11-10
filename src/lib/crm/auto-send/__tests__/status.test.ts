import { describe, expect, it } from 'vitest'
import {
  FILTER_OPTIONS,
  LETTER_STATUS_META,
  RECIPIENT_STATUS_META,
  STATUS_LEGEND,
  matchesFilter,
  nextBatchSentence,
} from '../status'
import type { LetterFilter } from '../status'
import type { LetterStatus, LetterSummary, RecipientStatus } from '../types'

const DEFAULT_LETTER: LetterSummary = {
  letterId: 'l1',
  sendDate: '2026-12-02',
  audienceLabel: 'g · 3',
  title: 'T',
  status: 'draft',
  recipientCount: 5,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

function makeLetter(overrides: Partial<LetterSummary> = {}): LetterSummary {
  return { ...DEFAULT_LETTER, ...overrides }
}

const LETTER_STATUSES: ReadonlyArray<LetterStatus> = [
  'not_enabled',
  'planned',
  'draft',
  'awaiting_release',
  'sent',
  'not_sent',
  'unknown',
]

const RECIPIENT_STATUSES: ReadonlyArray<RecipientStatus> = [
  'sent',
  'blocked',
  'failed',
  'rehearsal',
  'pending',
  'unknown',
]

describe('LETTER_STATUS_META', () => {
  it('defines exactly the seven letter statuses', () => {
    expect(Object.keys(LETTER_STATUS_META).sort()).toEqual([...LETTER_STATUSES].sort())
  })

  it('maps every status to the expected label and tone', () => {
    expect(LETTER_STATUS_META).toEqual({
      not_enabled: { label: '还没开通', tone: 'attn' },
      planned: { label: '计划中', tone: 'attn' },
      draft: { label: '草稿', tone: 'attn' },
      awaiting_release: { label: '等你放行', tone: 'sched' },
      sent: { label: '已发出', tone: 'track' },
      not_sent: { label: '没发出去', tone: 'rej' },
      unknown: { label: '结果不明', tone: 'exec' },
    })
  })
})

describe('RECIPIENT_STATUS_META', () => {
  it('defines exactly the six recipient statuses', () => {
    expect(Object.keys(RECIPIENT_STATUS_META).sort()).toEqual([...RECIPIENT_STATUSES].sort())
  })

  it('maps every status to the expected label and tone', () => {
    expect(RECIPIENT_STATUS_META).toEqual({
      sent: { label: '已发出', tone: 'track' },
      blocked: { label: '被拦', tone: 'exec' },
      failed: { label: '出错', tone: 'rej' },
      rehearsal: { label: '演练', tone: 'attn' },
      pending: { label: '还没发', tone: 'attn' },
      unknown: { label: '结果不明', tone: 'exec' },
    })
  })
})

describe('FILTER_OPTIONS', () => {
  it('lists the filters in order with their labels', () => {
    const keys: LetterFilter[] = FILTER_OPTIONS.map((option) => option.key)
    const labels = FILTER_OPTIONS.map((option) => option.label)

    expect(keys).toEqual(['all', 'draft', 'awaiting_release', 'sent', 'not_sent', 'unknown', 'blocked'])
    expect(labels).toEqual(['全部', '草稿', '等你放行', '已发', '没发出去', '结果不明', '有被拦的'])
  })
})

describe('matchesFilter', () => {
  it("keeps every letter when the filter is 'all'", () => {
    for (const status of LETTER_STATUSES) {
      expect(matchesFilter(makeLetter({ status }), 'all')).toBe(true)
    }
  })

  it("keeps only draft letters when the filter is 'draft'", () => {
    for (const status of LETTER_STATUSES) {
      expect(matchesFilter(makeLetter({ status }), 'draft')).toBe(status === 'draft')
    }
  })

  it("keeps only letters awaiting release when the filter is 'awaiting_release'", () => {
    for (const status of LETTER_STATUSES) {
      expect(matchesFilter(makeLetter({ status }), 'awaiting_release')).toBe(
        status === 'awaiting_release',
      )
    }
  })

  it("keeps letters that really went out when the filter is 'sent'", () => {
    expect(matchesFilter(makeLetter({ status: 'sent' }), 'sent')).toBe(true)
    expect(matchesFilter(makeLetter({ status: 'draft', sentCount: 3 }), 'sent')).toBe(true)
    expect(matchesFilter(makeLetter({ status: 'draft', sentCount: 0 }), 'sent')).toBe(false)
    expect(matchesFilter(makeLetter({ status: 'draft', sentCount: null }), 'sent')).toBe(false)
  })

  it("never treats rehearsal rows as sent when the filter is 'sent'", () => {
    expect(
      matchesFilter(makeLetter({ status: 'draft', sentCount: null, rehearsalCount: 5 }), 'sent'),
    ).toBe(false)
  })

  it("keeps letters with any blocked or failed recipient when the filter is 'blocked'", () => {
    expect(matchesFilter(makeLetter({ blockedCount: 1 }), 'blocked')).toBe(true)
    expect(matchesFilter(makeLetter({ failedCount: 2 }), 'blocked')).toBe(true)
    expect(matchesFilter(makeLetter({ blockedCount: 0, failedCount: 0 }), 'blocked')).toBe(false)
    expect(matchesFilter(makeLetter({ blockedCount: null, failedCount: null }), 'blocked')).toBe(
      false,
    )
  })

  it("ignores rehearsal rows when the filter is 'blocked'", () => {
    expect(matchesFilter(makeLetter({ rehearsalCount: 3 }), 'blocked')).toBe(false)
  })
})

describe("matchesFilter · letters nobody got, and results nobody can tell", () => {
  it("'not_sent' keeps only letters whose status is not sent", () => {
    for (const status of LETTER_STATUSES) {
      expect(matchesFilter(makeLetter({ status }), 'not_sent')).toBe(status === 'not_sent')
    }
  })

  it("'unknown' keeps letters whose status is unknown, and also a sent letter that still has an unknown result", () => {
    expect(matchesFilter(makeLetter({ status: 'unknown', unknownCount: 3 }), 'unknown')).toBe(true)
    expect(matchesFilter(makeLetter({ status: 'sent', sentCount: 4, unknownCount: 1 }), 'unknown')).toBe(true)
    expect(matchesFilter(makeLetter({ status: 'sent', sentCount: 4, unknownCount: 0 }), 'unknown')).toBe(false)
    expect(matchesFilter(makeLetter({ status: 'not_sent', sentCount: 0, unknownCount: 0 }), 'unknown')).toBe(false)
  })

  it("'sent' never takes a letter nobody received, and 'blocked' ignores unknown results", () => {
    expect(matchesFilter(makeLetter({ status: 'not_sent', sentCount: 0, blockedCount: 3 }), 'sent')).toBe(false)
    expect(matchesFilter(makeLetter({ status: 'unknown', sentCount: 0, unknownCount: 2 }), 'sent')).toBe(false)
    expect(matchesFilter(makeLetter({ status: 'unknown', blockedCount: 0, failedCount: 0, unknownCount: 2 }), 'blocked')).toBe(false)
  })
})

describe('nextBatchSentence', () => {
  it('returns the expected sentence for every status', () => {
    const expected: Record<LetterStatus, string> = {
      draft: '现在是草稿，发出前会请你看稿并点头',
      awaiting_release: '已经提交，等你点头才会发',
      sent: '已经发出',
      not_sent: '这一批一封都没送到客人手里，要去看一下原因',
      unknown: '这一批有结果不明的，信可能已经送到，先别重发',
      planned: '排期有了，信还没写',
      not_enabled: '这类信的自动发送还没开通',
    }

    for (const status of LETTER_STATUSES) {
      expect(nextBatchSentence(status)).toBe(expected[status])
    }
  })
})

describe('STATUS_LEGEND', () => {
  it('has ten entries in the documented order', () => {
    expect(STATUS_LEGEND.map((entry) => entry.label)).toEqual([
      '草稿',
      '等你放行',
      '已发出',
      '没发出去',
      '结果不明',
      '被拦',
      '出错',
      '计划中',
      '还没开通',
      '演练',
    ])
  })

  it('marks only the rehearsal entry as dashed', () => {
    expect(STATUS_LEGEND.map((entry) => entry.dashed)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
    expect(STATUS_LEGEND[STATUS_LEGEND.length - 1].label).toBe('演练')
  })

  it('gives every entry a non-empty explanation', () => {
    for (const entry of STATUS_LEGEND) {
      expect(entry.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('every letter status label is explained here, and the two new ones say what to do', () => {
    const explained = new Set(STATUS_LEGEND.map((entry) => entry.label))
    for (const meta of [...Object.values(LETTER_STATUS_META), RECIPIENT_STATUS_META.unknown]) {
      expect(explained.has(meta.label), meta.label).toBe(true)
    }
    const text = (label: string) => STATUS_LEGEND.find((entry) => entry.label === label)?.text ?? ''
    expect(text('没发出去')).toContain('一封都没送到客人手里')
    expect(text('结果不明')).toContain('先别重发')
  })
})

describe('user-facing labels', () => {
  it('never leaks internal jargon', () => {
    const labels = [
      ...Object.values(LETTER_STATUS_META).map((meta) => meta.label),
      ...Object.values(RECIPIENT_STATUS_META).map((meta) => meta.label),
      ...STATUS_LEGEND.map((entry) => entry.label),
    ]

    for (const label of labels) {
      expect(label).not.toMatch(/triggered|gate|shadow/i)
    }
  })
})
