import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LETTER_RULES, letterRequestId, letterStatus, loadLetterList, type LetterListDeps } from '../letter-list'
import { emptyCounts, type GroupVerdict } from '../groups'
import type { FollowupProgressDetail } from '../load'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'

const NOW = new Date('2026-11-28T02:00:00Z') // 15:00 on 28 Nov in Auckland
const TZ = 'Pacific/Auckland'
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

describe('letterStatus — who the AI may draft for', () => {
  const base = { lastStaffAt: ago(40), lastCrmSendAt: null, bulkLast7Days: 0 }

  it('a guest staff contacted long ago, never written from the CRM, few bulk mails: due', () => {
    expect(letterStatus(base, NOW)).toBe('due')
  })

  it('a person contacted the guest inside the quiet days: the AI stays out', () => {
    expect(letterStatus({ ...base, lastStaffAt: ago(DEFAULT_LETTER_RULES.staffQuietDays - 1) }, NOW)).toBe('staff_active')
    expect(letterStatus({ ...base, lastStaffAt: ago(DEFAULT_LETTER_RULES.staffQuietDays) }, NOW)).toBe('due')
  })

  it('a staff contact wins over everything else', () => {
    expect(letterStatus({ lastStaffAt: ago(1), lastCrmSendAt: ago(1), bulkLast7Days: 5 }, NOW)).toBe('staff_active')
  })

  it('one letter per guest per 30 days from the CRM mailbox, whoever sent it', () => {
    expect(letterStatus({ ...base, lastCrmSendAt: ago(29) }, NOW)).toBe('already_written')
    expect(letterStatus({ ...base, lastCrmSendAt: ago(30) }, NOW)).toBe('due')
  })

  it('bulk mails count toward the weekly limit', () => {
    expect(letterStatus({ ...base, bulkLast7Days: 1 }, NOW)).toBe('due')
    expect(letterStatus({ ...base, bulkLast7Days: 2 }, NOW)).toBe('weekly_limit')
  })

  it('a date that cannot be read keeps the AI away rather than letting it in', () => {
    expect(letterStatus({ ...base, lastStaffAt: 'not a date' }, NOW)).toBe('staff_active')
    expect(letterStatus({ ...base, lastCrmSendAt: 'not a date' }, NOW)).toBe('already_written')
  })
})

describe('letterRequestId', () => {
  it('is the same for the same guest in the same round, and new after a person contacts the guest again', () => {
    expect(letterRequestId('g1', ago(40))).toBe(letterRequestId('g1', ago(40)))
    expect(letterRequestId('g1', ago(40))).not.toBe(letterRequestId('g1', ago(10)))
    expect(letterRequestId('g1', ago(40))).not.toBe(letterRequestId('g2', ago(40)))
    expect(letterRequestId('g1', null)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

type D = { e?: string; s?: string | null; bulk?: number }
function detail(entries: Array<[string, GroupVerdict, D]>): FollowupProgressDetail {
  const verdicts = new Map<string, GroupVerdict>()
  const dates: FollowupProgressDetail['dates'] = new Map()
  for (const [id, v, d] of entries) {
    verdicts.set(id, v)
    dates.set(id, { lastEnquiryAt: null, lastGuestMessageAt: null, lastStaffAt: d.s === undefined ? ago(40) : d.s, lastEngagedAt: d.e ?? null, bulkLast7Days: d.bulk ?? 0 })
  }
  return { clientId: 'c', at: NOW.toISOString(), counts: emptyCounts(), week: { guestsContactedByStaff: 0, guestsWhoReplied: 0, newEnquiries: 0, movedToQualified: 0, newBookings: 0, takenByAi: 0 }, verdicts, dates }
}
const warm: GroupVerdict = { inScope: true, group: 'warm' }
const ok = (recent = 0): ComposePreview => ({ canCompose: true, recipient: 'x@example.com', mailbox: 'sales@example.com', sentToContactLast7Days: recent })

function deps(d: FollowupProgressDetail, over: Partial<LetterListDeps> = {}): LetterListDeps {
  return {
    timeZone: TZ,
    loadProgress: async () => d,
    loadLastSends: async () => new Map(),
    loadNames: async (ids) => new Map(ids.map((id) => [id, `Guest ${id}`])),
    compose: vi.fn(async () => ok()),
    ...over,
  }
}

describe('loadLetterList', () => {
  it('only the "still opening our emails" group is ever listed: not waiting guests, not high intent, not new leads', async () => {
    const d = detail([['w', warm, {}], ['a', { inScope: true, group: 'awaiting_reply' }, {}], ['q', { inScope: true, group: 'qualified' }, {}], ['n', { inScope: true, group: 'new_lead' }, {}], ['c', { inScope: true, group: 'cold' }, {}], ['b', { inScope: false, why: 'booked' }, {}]])
    const list = await loadLetterList(deps(d), NOW)
    expect(list.rows.map((r) => r.contactId)).toEqual(['w'])
  })

  it('the guest who opened a mail most recently comes first', async () => {
    const d = detail([['old', warm, { e: ago(20) }], ['new', warm, { e: ago(1) }], ['mid', warm, { e: ago(5) }]])
    expect((await loadLetterList(deps(d), NOW)).rows.map((r) => r.contactId)).toEqual(['new', 'mid', 'old'])
  })

  it('counts who is left out and why, and never mail-checks them (no draft is paid for either)', async () => {
    const d = detail([['due', warm, {}], ['staff', warm, { s: ago(3) }], ['bulk', warm, { bulk: 3 }], ['written', warm, {}]])
    const compose = vi.fn(async () => ok())
    const list = await loadLetterList(deps(d, { compose, loadLastSends: async () => new Map([['written', ago(10)]]) }), NOW)
    expect(list.counts).toMatchObject({ due: 1, staff_active: 1, weekly_limit: 1, already_written: 1 })
    expect(list.rows.map((r) => r.contactId)).toEqual(['due'])
    expect(compose).toHaveBeenCalledTimes(1)
  })

  it('at most the daily number of letters; a guest written today keeps a slot until tomorrow', async () => {
    const many: Array<[string, GroupVerdict, D]> = []
    for (let i = 0; i < 25; i++) many.push([`g${String(i).padStart(2, '0')}`, warm, { e: ago(i + 1) }])
    const none = await loadLetterList(deps(detail(many)), NOW)
    expect(none.rows).toHaveLength(DEFAULT_LETTER_RULES.dailyMax)
    expect(none.counts).toMatchObject({ due: 25, sentToday: 0, room: DEFAULT_LETTER_RULES.dailyMax })

    // Four of them were written an hour ago (today in Auckland): they are "already written" and hold four slots.
    const sentToday = new Map(['g00', 'g01', 'g02', 'g03'].map((id) => [id, new Date(NOW.getTime() - 3_600_000).toISOString()]))
    const some = await loadLetterList(deps(detail(many), { loadLastSends: async () => sentToday }), NOW)
    expect(some.counts).toMatchObject({ sentToday: 4, room: DEFAULT_LETTER_RULES.dailyMax - 4, already_written: 4, due: 21 })
    expect(some.rows).toHaveLength(DEFAULT_LETTER_RULES.dailyMax - 4)
    expect(some.rows.map((r) => r.contactId)).not.toContain('g00')
  })

  it('a letter sent late last night (yesterday in the client time zone) does not use today\'s slots', async () => {
    const d = detail([['y', warm, {}], ['z', warm, {}]])
    // 27 Nov 22:00 Auckland = 27 Nov 09:00 UTC.
    const list = await loadLetterList(deps(d, { loadLastSends: async () => new Map([['y', '2026-11-27T09:00:00Z']]) }), NOW)
    expect(list.counts.sentToday).toBe(0)
  })

  it('the weekly limit adds CRM mails and bulk mails together', async () => {
    const d = detail([['a', warm, { bulk: 1 }], ['b', warm, { bulk: 1 }]])
    const compose = vi.fn(async (id: string) => ok(id === 'a' ? 1 : 0))
    const list = await loadLetterList(deps(d, { compose }), NOW)
    const byId = new Map(list.rows.map((r) => [r.contactId, r]))
    expect(byId.get('a')).toMatchObject({ status: 'cannot_send', sentLast7Days: 2 })
    expect(byId.get('a')?.message).toContain('含群发')
    expect(byId.get('b')).toMatchObject({ status: 'ready', sentLast7Days: 1, recipient: 'x@example.com' })
  })

  it('a guest the mailbox cannot write to is shown with the reason, not dropped', async () => {
    const d = detail([['a', warm, {}]])
    const list = await loadLetterList(deps(d, { compose: async () => ({ canCompose: false, message: '这位客人没有邮箱' }) as ComposePreview }), NOW)
    expect(list.rows[0]).toMatchObject({ status: 'cannot_send', message: '这位客人没有邮箱', recipient: null })
  })

  it('each row carries the request id of its round', async () => {
    const d = detail([['a', warm, { s: ago(40) }]])
    expect((await loadLetterList(deps(d), NOW)).rows[0].requestId).toBe(letterRequestId('a', ago(40)))
  })

  it('a read error is an error, never a short list', async () => {
    const d = detail([['a', warm, {}]])
    await expect(loadLetterList(deps(d, { loadLastSends: async () => { throw new Error('log unreadable') } }), NOW)).rejects.toThrow('log unreadable')
    await expect(loadLetterList(deps(d, { compose: async () => { throw new Error('mailbox down') } }), NOW)).rejects.toThrow('mailbox down')
  })
})
