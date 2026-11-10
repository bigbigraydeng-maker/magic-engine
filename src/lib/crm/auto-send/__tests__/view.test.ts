import { describe, expect, it } from 'vitest'
import type {
  AutoSendOverview,
  BodyBlock,
  LetterSection,
  LetterSummary,
  OpenInfo,
  TourGroupSummary,
} from '../types'
import {
  OPENED_NOTE,
  VIEW_OPTIONS,
  detailTiles,
  engagementText,
  isOverviewEmpty,
  lastSentLine,
  letterResultLine,
  lettersById,
  openInfoLine,
  recipientsFootnote,
  recipientsTabLabel,
  resolveView,
  splitBodyPreview,
  statusNote,
  totalLetterCount,
  visibleSections,
} from '../view'

function makeLetter(overrides: Partial<LetterSummary> = {}): LetterSummary {
  return {
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
    ...overrides,
  }
}

function makeSection(overrides: Partial<LetterSection> = {}): LetterSection {
  return {
    key: 's1',
    kind: 'scheduled',
    title: 'S',
    note: null,
    footnote: null,
    letters: [],
    ...overrides,
  }
}

function makeOverview(): AutoSendOverview {
  return {
    nextBatch: {
      sendDate: '2026-12-02',
      letterCount: 2,
      recipientCount: 10,
      status: 'draft',
    },
    sections: [
      makeSection({
        key: 'trigger',
        kind: 'trigger',
        title: 'Trigger',
        letters: [
          makeLetter({ letterId: 't1', sendDate: null, status: 'not_enabled' }),
        ],
      }),
      makeSection({
        key: 'scheduled',
        kind: 'scheduled',
        title: 'Scheduled',
        letters: [
          makeLetter({ letterId: 's-draft', sendDate: '2026-12-02', status: 'draft' }),
          makeLetter({
            letterId: 's-sent',
            sendDate: '2026-12-02',
            status: 'sent',
            blockedCount: 1,
          }),
          makeLetter({
            letterId: 's-planned',
            sendDate: '2027-01-06',
            status: 'planned',
          }),
        ],
      }),
    ],
    groups: [],
  }
}

const bodyBlocks: BodyBlock[] = [
  { kind: 'heading', text: 'h' },
  { kind: 'paragraph', text: 'p1' },
  { kind: 'paragraph', text: 'p2' },
  { kind: 'bullet', text: 'b1' },
  { kind: 'bullet', text: 'b2' },
]

describe('visibleSections', () => {
  it('keeps every letter when the filter is all and there is no batch date', () => {
    const sections = visibleSections(makeOverview(), 'all', null)

    expect(sections).toHaveLength(2)
    expect(sections[0].letters.map((letter) => letter.letterId)).toEqual(['t1'])
    expect(sections[1].letters.map((letter) => letter.letterId)).toEqual([
      's-draft',
      's-sent',
      's-planned',
    ])
  })

  it('returns new section objects instead of the input ones', () => {
    const overview = makeOverview()
    const sections = visibleSections(overview, 'all', null)

    expect(sections[0]).not.toBe(overview.sections[0])
    expect(sections[0].letters).not.toBe(overview.sections[0].letters)
  })

  it('drops the trigger section and keeps only letters on the batch date', () => {
    const sections = visibleSections(makeOverview(), 'all', '2026-12-02')

    expect(sections.map((section) => section.key)).toEqual(['scheduled'])
    expect(sections[0].letters.map((letter) => letter.letterId)).toEqual([
      's-draft',
      's-sent',
    ])
  })

  it('keeps only letters with blocked recipients for the blocked filter', () => {
    const sections = visibleSections(makeOverview(), 'blocked', null)

    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('scheduled')
    expect(sections[0].letters.map((letter) => letter.letterId)).toEqual(['s-sent'])
  })

  it('returns an empty array when no letter matches', () => {
    const overview: AutoSendOverview = {
      nextBatch: null,
      sections: [makeSection({ letters: [makeLetter({ status: 'sent' })] })],
      groups: [],
    }

    expect(visibleSections(overview, 'draft', null)).toEqual([])
  })

  it('does not mutate the input overview', () => {
    const overview = makeOverview()
    const snapshot: AutoSendOverview = JSON.parse(JSON.stringify(overview))

    visibleSections(overview, 'blocked', '2026-12-02')

    expect(overview).toEqual(snapshot)
  })
})

describe('totalLetterCount / isOverviewEmpty', () => {
  it('counts the letters of every section', () => {
    expect(totalLetterCount(makeOverview())).toBe(4)
    expect(isOverviewEmpty(makeOverview())).toBe(false)
  })

  it('treats an overview without sections as empty', () => {
    const overview: AutoSendOverview = { nextBatch: null, sections: [], groups: [] }

    expect(totalLetterCount(overview)).toBe(0)
    expect(isOverviewEmpty(overview)).toBe(true)
  })

  it('treats sections without letters as empty', () => {
    const overview: AutoSendOverview = {
      nextBatch: null,
      sections: [makeSection({ letters: [] })],
      groups: [],
    }

    expect(totalLetterCount(overview)).toBe(0)
    expect(isOverviewEmpty(overview)).toBe(true)
  })
})

describe('splitBodyPreview', () => {
  it('shows only the first blocks and counts the rest', () => {
    const result = splitBodyPreview(bodyBlocks, 3)

    expect(result.shown).toHaveLength(3)
    expect(result.shown).toEqual(bodyBlocks.slice(0, 3))
    expect(result.hiddenCount).toBe(2)
  })

  it('shows every block when the limit exceeds the block count', () => {
    const result = splitBodyPreview(bodyBlocks, 10)

    expect(result.shown).toHaveLength(5)
    expect(result.shown).toEqual(bodyBlocks)
    expect(result.shown).not.toBe(bodyBlocks)
    expect(result.hiddenCount).toBe(0)
  })

  it('clamps a limit of zero to one block', () => {
    const result = splitBodyPreview(bodyBlocks, 0)

    expect(result.shown).toHaveLength(1)
    expect(result.shown).toEqual(bodyBlocks.slice(0, 1))
    expect(result.hiddenCount).toBe(4)
  })
})

describe('detailTiles', () => {
  it('returns the four tiles in order with formatted values', () => {
    const tiles = detailTiles(
      makeLetter({ sentCount: 8, blockedCount: 1, failedCount: 1 }),
    )

    expect(tiles).toEqual([
      { key: 'recipients', label: '收件人', value: '5' },
      { key: 'sent', label: '已发', value: '8' },
      { key: 'blocked', label: '被拦', value: '1' },
      { key: 'failed', label: '出错', value: '1' },
    ])
  })

  it('shows an em dash for null counts', () => {
    const tiles = detailTiles(
      makeLetter({
        recipientCount: 5,
        sentCount: null,
        blockedCount: null,
        failedCount: null,
      }),
    )

    expect(tiles.map((tile) => tile.value)).toEqual(['5', '—', '—', '—'])
  })

  it('appends a rehearsal tile when a rehearsal ran', () => {
    const tiles = detailTiles(makeLetter({ rehearsalCount: 5 }))

    expect(tiles).toHaveLength(5)
    expect(tiles[4]).toEqual({ key: 'rehearsal', label: '演练', value: '5' })
  })

  it('adds a tile for results nobody can tell, right after the errors, only when there are some', () => {
    const tiles = detailTiles(makeLetter({ sentCount: 3, blockedCount: 0, failedCount: 0, unknownCount: 2, rehearsalCount: 1 }))
    expect(tiles.map((tile) => tile.key)).toEqual(['recipients', 'sent', 'blocked', 'failed', 'unknown', 'rehearsal'])
    expect(tiles[4]).toEqual({ key: 'unknown', label: '结果不明', value: '2' })
    expect(detailTiles(makeLetter({ unknownCount: 0 })).some((tile) => tile.key === 'unknown')).toBe(false)
  })

  it('has no rehearsal tile when no rehearsal ran', () => {
    const tiles = detailTiles(makeLetter({ rehearsalCount: 0 }))

    expect(tiles).toHaveLength(4)
    expect(tiles.some((tile) => tile.key === 'rehearsal')).toBe(false)
  })

  it('adds an opened tile, marked reference-only, only when this kind of letter records opens', () => {
    const tracked = detailTiles(makeLetter({ sentCount: 8, openedCount: 6 }))
    expect(tracked[tracked.length - 1]).toEqual({ key: 'opened', label: '打开（仅供参考）', value: '6' })

    expect(detailTiles(makeLetter({ openedCount: null })).some((tile) => tile.key === 'opened')).toBe(false)
    // nobody opened yet is a real 0, not a missing number
    expect(detailTiles(makeLetter({ sentCount: 3, openedCount: 0 })).find((tile) => tile.key === 'opened')?.value).toBe('0')
  })
})

describe('statusNote · what a letter nobody got, or with unknown results, means', () => {
  it('says nothing for a letter that is fine', () => {
    for (const status of ['draft', 'planned', 'awaiting_release', 'sent'] as const) {
      expect(statusNote(makeLetter({ status, sentCount: 3, blockedCount: 1, failedCount: 0 })), status).toBeNull()
    }
  })

  it('a letter nobody got says why: blocked, errors, or both', () => {
    expect(statusNote(makeLetter({ status: 'not_sent', sentCount: 0, blockedCount: 3, failedCount: 0 }))).toBe(
      '这一批一封都没送到客人手里（被拦 3 位）。',
    )
    expect(statusNote(makeLetter({ status: 'not_sent', sentCount: 0, blockedCount: 0, failedCount: 2 }))).toBe(
      '这一批一封都没送到客人手里（出错 2 位）。',
    )
    expect(statusNote(makeLetter({ status: 'not_sent', sentCount: 0, blockedCount: 3, failedCount: 2 }))).toBe(
      '这一批一封都没送到客人手里（被拦 3 位，出错 2 位）。',
    )
  })

  it('released but nothing recorded at all is said apart: it points at the sending side, not at the guests', () => {
    expect(statusNote(makeLetter({ status: 'not_sent', sentCount: null, blockedCount: null, failedCount: null }))).toBe(
      '这一批放行了，可是发信日已经过了，系统里一条发送记录都没有。',
    )
  })

  it('unknown results always say "do not resend", on a sent letter too', () => {
    expect(statusNote(makeLetter({ status: 'unknown', sentCount: 0, unknownCount: 4 }))).toBe(
      '有 4 位结果不明：信可能已经送到，先别重发。',
    )
    expect(statusNote(makeLetter({ status: 'sent', sentCount: 3, unknownCount: 1 }))).toBe(
      '有 1 位结果不明：信可能已经送到，先别重发。',
    )
  })

  it('a letter nobody got that also has unknown results says both', () => {
    expect(statusNote(makeLetter({ status: 'not_sent', sentCount: 0, blockedCount: 1, failedCount: 0, unknownCount: 2 }))).toBe(
      '这一批一封都没送到客人手里（被拦 1 位）。有 2 位结果不明：信可能已经送到，先别重发。',
    )
  })
})

describe('recipientsTabLabel', () => {
  it('includes the recipient count', () => {
    expect(recipientsTabLabel(makeLetter({ recipientCount: 10 }))).toBe(
      '收件人与发送情况 10',
    )
  })
})

describe('openInfoLine', () => {
  it('describes Mailchimp per-recipient opens', () => {
    expect(
      openInfoLine({ kind: 'per_recipient', openedPeople: 3, clickedPeople: 1, fromMailchimp: true }),
    ).toBe('Mailchimp 回传：已打开 3 位 · 其中点了链接 1 位')
  })

  it('describes opens that ME recorded itself, marked as reference only', () => {
    expect(
      openInfoLine({ kind: 'per_recipient', openedPeople: 3, clickedPeople: 1, fromMailchimp: false }),
    ).toBe('已打开 3 位 · 其中点了链接 1 位（仅供参考）')
  })

  it('describes totals-only opens', () => {
    expect(openInfoLine({ kind: 'totals_only', opens: 12, clicks: 4 })).toBe(
      'ME 自己发的信：打开 / 点击只记总数（打开 12 次 · 点击 4 次），不记每位客人。',
    )
  })

  it('returns null when there is no open info', () => {
    expect(openInfoLine({ kind: 'none' })).toBeNull()
  })
})

describe('engagementText', () => {
  const perRecipient: OpenInfo = {
    kind: 'per_recipient',
    openedPeople: 3,
    clickedPeople: 1,
    fromMailchimp: true,
  }

  it('describes the engagement of a recipient in a Mailchimp letter', () => {
    expect(engagementText(perRecipient, { engagement: 'clicked' })).toBe('点了链接')
    expect(engagementText(perRecipient, { engagement: 'opened' })).toBe('已打开')
    expect(engagementText(perRecipient, { engagement: null })).toBe('—')
  })

  it('always shows an em dash when there is no per-recipient data', () => {
    const totalsOnly: OpenInfo = { kind: 'totals_only', opens: 5, clicks: 2 }
    const none: OpenInfo = { kind: 'none' }

    expect(engagementText(totalsOnly, { engagement: 'clicked' })).toBe('—')
    expect(engagementText(totalsOnly, { engagement: 'opened' })).toBe('—')
    expect(engagementText(none, { engagement: 'clicked' })).toBe('—')
    expect(engagementText(none, { engagement: null })).toBe('—')
  })
})

describe('recipientsFootnote', () => {
  it('explains seats and profiles for Mailchimp letters', () => {
    const info: OpenInfo = { kind: 'per_recipient', openedPeople: 3, clickedPeople: 1, fromMailchimp: true }

    expect(recipientsFootnote(info)).toBe(
      '只显示姓名，不显示邮箱；点姓名可以打开这位客人的资料。座位数来自订单，订单没填就显示「—」。',
    )
  })

  it('explains blocked reasons for letters without per-recipient data', () => {
    const totalsOnly: OpenInfo = { kind: 'totals_only', opens: 5, clicks: 2 }
    const none: OpenInfo = { kind: 'none' }
    const expected =
      '只显示姓名，不显示邮箱。被拦的原因会写成人话：没有同意依据 / 最近 7 天已收满 2 封 / 客人说了别再联系 / 已在 Mailchimp 退订。'

    expect(recipientsFootnote(totalsOnly)).toBe(expected)
    expect(recipientsFootnote(none)).toBe(expected)
  })
})

describe('lastSentLine / letterResultLine', () => {
  const last = { letterId: 'a', sendDate: '2026-12-02', recipientCount: 10, sentCount: 8, blockedCount: 1, failedCount: 1, unknownCount: 0, openedCount: 6 }

  it('writes date, sent, blocked, failed and opened on one line', () => {
    expect(lastSentLine(last)).toBe('12月2日 · 已发 8 · 被拦 1 · 出错 1 · 打开 6')
  })

  it('leaves 出错 out when nothing failed, and shows a dash when opens are not recorded', () => {
    expect(lastSentLine({ ...last, failedCount: 0, openedCount: null })).toBe('12月2日 · 已发 8 · 被拦 1 · 打开 —')
  })

  it('adds the people whose result is unknown, only when there are some', () => {
    expect(lastSentLine({ ...last, unknownCount: 2 })).toBe('12月2日 · 已发 8 · 被拦 1 · 出错 1 · 结果不明 2 · 打开 6')
    expect(letterResultLine(makeLetter({ sentCount: 0, blockedCount: 1, failedCount: 0, unknownCount: 4 }))).toBe(
      '已发 0 · 被拦 1 · 结果不明 4 · 打开 —',
    )
  })

  it('a letter row inside an opened group says the same thing, or 还没发', () => {
    expect(letterResultLine(makeLetter({ sentCount: 8, blockedCount: 1, failedCount: 1, openedCount: 6 }))).toBe(
      '已发 8 · 被拦 1 · 出错 1 · 打开 6',
    )
    expect(letterResultLine(makeLetter({ sentCount: 4, blockedCount: 0, failedCount: 0, openedCount: null }))).toBe(
      '已发 4 · 被拦 0 · 打开 —',
    )
    expect(letterResultLine(makeLetter({ sentCount: null }))).toBe('还没发')
  })

  it('the reference-only note says why opens can be wrong and what a dash means', () => {
    expect(OPENED_NOTE).toContain('只能当参考')
    expect(OPENED_NOTE).toContain('显示「—」')
  })
})

describe('resolveView / lettersById', () => {
  const group: TourGroupSummary = {
    groupId: 'g1',
    tourName: 'T',
    departOn: '2027-03-11',
    recipientCount: 2,
    lettersSent: 0,
    lettersAhead: 1,
    lettersOverdue: 0,
    lettersUnknown: 0,
    lastSent: null,
    next: null,
    letterIds: [],
  }

  it('offers both views, groups first', () => {
    expect(VIEW_OPTIONS.map((option) => option.key)).toEqual(['groups', 'letters'])
  })

  it('with groups the page starts on 按团看 unless the staff member picked otherwise', () => {
    const overview = { ...makeOverview(), groups: [group] }
    expect(resolveView(null, overview)).toBe('groups')
    expect(resolveView('letters', overview)).toBe('letters')
    expect(resolveView('groups', overview)).toBe('groups')
  })

  it('with no groups there is only the letter view, whatever was picked', () => {
    expect(resolveView(null, makeOverview())).toBe('letters')
    expect(resolveView('groups', makeOverview())).toBe('letters')
  })

  it('finds every letter of every panel by its id', () => {
    const byId = lettersById(makeOverview())
    expect(Array.from(byId.keys())).toEqual(['t1', 's-draft', 's-sent', 's-planned'])
    expect(byId.get('s-sent')?.status).toBe('sent')
  })
})
