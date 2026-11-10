import { describe, expect, it } from 'vitest'
import type { SendStatRow } from '../types'
import { dayTitle, groupLabelOf, groupRows, labelsOf, localDay, statusOf, summarise } from '../view'

const row = (over: Partial<SendStatRow> = {}): SendStatRow => ({
  id: 'r1',
  createdAt: '2026-11-10T02:00:00.000Z',
  contactId: 'p1',
  contactName: 'Amy Lee',
  templateKey: 'catalogue-send',
  templateName: '④一键发目录：2027 手册（Baker 署名，算名额）',
  outcome: 'sent',
  blockReason: null,
  clicks: [],
  reaction: null,
  ...over,
})
const click = { label: '目录', firstClickedAt: '2026-11-10T03:00:00.000Z' }
const reaction = { at: '2026-11-10T04:00:00.000Z', kind: 'email' }

describe('groupLabelOf', () => {
  it.each([
    ['④一键发目录：2027 手册（Baker 署名，算名额）', '一键发目录'],
    ['倒计时信·离出发 4 个月·3 月 11 日团 Best of China（Baker 署名）', '倒计时信'],
    ['倒计时信 · 12/2 · 5 月 8 日团', '倒计时信'],
    ['通话后跟进信 · 单团详情', '通话后跟进信'],
    ['春季团通用跟进信 · 3 月 / 5 月', '春季团通用跟进信'],
    ['客人问了某个团：详情 + 价格', '客人问了某个团'],
    ['没有任何分隔符的名字', '没有任何分隔符的名字'],
  ])('%s → %s', (name, expected) => {
    expect(groupLabelOf({ templateKey: 'k', templateName: name })).toBe(expected)
  })
  it('a mail the person wrote themselves, and a template that is gone', () => {
    expect(groupLabelOf({ templateKey: null, templateName: null })).toBe('自己写的信')
    expect(groupLabelOf({ templateKey: 'old-one', templateName: null })).toBe('其他信')
  })
})

describe('statusOf / summarise', () => {
  it('sent: clicked, reacted, readable clicks', () => {
    expect(statusOf(row({ clicks: [click], reaction }))).toEqual({ kind: 'sent', clicked: true, clicksReadable: true, reacted: true })
    expect(statusOf(row({ clicks: null }))).toMatchObject({ clicked: false, clicksReadable: false })
  })
  it('🔴 any sent mail with unreadable clicks makes the clicked number a floor, flagged (not a plain 0)', () => {
    expect(summarise([row({ id: 'a', clicks: null }), row({ id: 'b', clicks: [click] })])).toMatchObject({ clicked: 1, clicksUnreadable: true })
    expect(summarise([row({ id: 'a', outcome: 'blocked', clicks: [] })]).clicksUnreadable).toBe(false)
  })
  it('anything but sent is not a delivered mail', () => {
    for (const outcome of ['blocked', 'failed', 'unknown']) expect(statusOf(row({ outcome })).kind).toBe(outcome)
  })
  it('counts the four numbers; a mail that did not go out is neither sent nor clicked', () => {
    const rows = [
      row({ id: 'a', clicks: [click] }),
      row({ id: 'b', clicks: [click], reaction }),
      row({ id: 'c' }),
      row({ id: 'd', outcome: 'blocked', clicks: [click] }),
    ]
    expect(summarise(rows)).toEqual({ sent: 3, clicked: 2, reacted: 1, notDelivered: 1, clicksUnreadable: false })
  })
})

describe('groupRows', () => {
  const TZ = 'Pacific/Auckland'
  it('groups by local day then mail type, newest day first, responders first inside a group', () => {
    const rows = [
      row({ id: 'quiet', contactName: 'Quiet', createdAt: '2026-11-10T02:09:00.000Z' }),
      row({ id: 'clicked', contactName: 'Clicked', createdAt: '2026-11-10T02:00:00.000Z', clicks: [click] }),
      row({ id: 'both', contactName: 'Both', createdAt: '2026-11-10T02:05:00.000Z', clicks: [click], reaction }),
      row({ id: 'other', contactName: 'Other', templateKey: null, templateName: null, createdAt: '2026-11-09T02:00:00.000Z' }),
    ]
    const groups = groupRows(rows, TZ)
    expect(groups.map((g) => `${g.day} ${g.label}`)).toEqual(['2026-11-10 一键发目录', '2026-11-09 自己写的信'])
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['both', 'clicked', 'quiet'])
    expect(groups[0]?.summary).toEqual({ sent: 3, clicked: 2, reacted: 1, notDelivered: 0, clicksUnreadable: false })
  })
  it('a send at 23:30 UTC on the 9th is the 10th in Auckland (the viewer day, not the server day)', () => {
    expect(localDay('2026-11-09T23:30:00.000Z', 'Pacific/Auckland')).toBe('2026-11-10')
    expect(localDay('2026-11-09T23:30:00.000Z', 'UTC')).toBe('2026-11-09')
  })
  it('mail-type chips: most mails first', () => {
    const rows = [row({ id: '1' }), row({ id: '2' }), row({ id: '3', templateKey: null, templateName: null })]
    expect(labelsOf(rows)).toEqual(['一键发目录', '自己写的信'])
  })
})

describe('dayTitle', () => {
  const now = new Date('2026-11-10T20:00:00.000Z')
  it('today / yesterday / a date', () => {
    expect(dayTitle('2026-11-11', now, 'Pacific/Auckland')).toBe('今天')
    expect(dayTitle('2026-11-10', now, 'Pacific/Auckland')).toBe('昨天')
    expect(dayTitle('2026-11-08', now, 'Pacific/Auckland')).toBe('11 月 8 日')
  })
})
