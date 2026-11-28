import { describe, expect, it } from 'vitest'
import { buildGroupList, GROUP_LIST_MAX, memberIds, parseGroup } from '../group-list'
import { emptyCounts, type GroupVerdict } from '../groups'
import type { FollowupProgressDetail } from '../load'

function detail(entries: Array<[string, GroupVerdict, { e?: string; g?: string; s?: string }]>): FollowupProgressDetail {
  const verdicts = new Map<string, GroupVerdict>()
  const dates: FollowupProgressDetail['dates'] = new Map()
  for (const [id, v, d] of entries) {
    verdicts.set(id, v)
    dates.set(id, { lastEnquiryAt: d.e ?? null, lastGuestMessageAt: d.g ?? null, lastStaffAt: d.s ?? null, lastEngagedAt: null, bulkLast7Days: 0 })
  }
  return { clientId: 'c', at: '2026-11-28T00:00:00Z', counts: emptyCounts(), week: { guestsContactedByStaff: 0, guestsWhoReplied: 0, newEnquiries: 0, movedToQualified: 0, newBookings: 0, takenByAi: 0 }, verdicts, dates }
}

const lead: GroupVerdict = { inScope: true, group: 'new_lead' }
const waiting: GroupVerdict = { inScope: true, group: 'awaiting_reply' }

describe('parseGroup', () => {
  it('accepts a real group and nothing else', () => {
    expect(parseGroup('new_lead')).toBe('new_lead')
    expect(parseGroup(['warm', 'cold'])).toBe('warm')
    expect(parseGroup('booked')).toBeNull()
    expect(parseGroup('constructor')).toBeNull()
    expect(parseGroup(undefined)).toBeNull()
  })
})

describe('buildGroupList', () => {
  it('lists exactly the guests the count counted: this group, in scope, nobody else', () => {
    const d = detail([['a', lead, { e: '2026-11-20T00:00:00Z' }], ['b', waiting, { g: '2026-11-21T00:00:00Z' }], ['c', { inScope: false, why: 'booked' }, {}]])
    expect(memberIds(d, 'new_lead')).toEqual(['a'])
    const list = buildGroupList(d, 'new_lead', new Map([['a', 'Ann']]))
    expect(list.total).toBe(1)
    expect(list.rows.map((r) => r.contactId)).toEqual(['a'])
  })

  it('orders new leads by the latest form, newest first', () => {
    const d = detail([['old', lead, { e: '2026-11-15T00:00:00Z' }], ['new', lead, { e: '2026-11-27T00:00:00Z' }], ['mid', lead, { e: '2026-11-20T00:00:00Z' }]])
    expect(buildGroupList(d, 'new_lead', new Map()).rows.map((r) => r.contactId)).toEqual(['new', 'mid', 'old'])
  })

  it('orders guests waiting for a reply by when they last spoke, not by their form', () => {
    const d = detail([['x', waiting, { e: '2026-11-27T00:00:00Z', g: '2026-11-10T00:00:00Z' }], ['y', waiting, { e: '2026-10-01T00:00:00Z', g: '2026-11-26T00:00:00Z' }]])
    expect(buildGroupList(d, 'awaiting_reply', new Map()).rows.map((r) => r.contactId)).toEqual(['y', 'x'])
  })

  it('a guest with no date is still listed, last, and the order is stable', () => {
    const d = detail([['n2', lead, {}], ['n1', lead, {}], ['dated', lead, { e: '2026-11-01T00:00:00Z' }]])
    expect(buildGroupList(d, 'new_lead', new Map()).rows.map((r) => r.contactId)).toEqual(['dated', 'n1', 'n2'])
  })

  it('caps the rows and keeps the full count', () => {
    const many: Array<[string, GroupVerdict, { e: string }]> = []
    for (let i = 0; i < GROUP_LIST_MAX + 7; i++) many.push([`g${String(i).padStart(4, '0')}`, lead, { e: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString() }])
    const list = buildGroupList(detail(many), 'new_lead', new Map())
    expect(list.total).toBe(GROUP_LIST_MAX + 7)
    expect(list.rows).toHaveLength(GROUP_LIST_MAX)
    expect(list.rows[0].contactId).toBe(`g${String(GROUP_LIST_MAX + 6).padStart(4, '0')}`)
  })

  it('names a guest the way the rest of the CRM does, and never as a bare email address', () => {
    const d = detail([['a', lead, {}], ['b', lead, {}]])
    const list = buildGroupList(d, 'new_lead', new Map<string, string | null>([['a', 'Mary Smith'], ['b', 'someone@example.com']]))
    const byId = new Map(list.rows.map((r) => [r.contactId, r.name]))
    expect(byId.get('a')).toBe('Mary Smith')
    expect(byId.get('b')).not.toContain('@')
  })
})
