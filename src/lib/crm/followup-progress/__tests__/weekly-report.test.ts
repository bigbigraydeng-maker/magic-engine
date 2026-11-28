import { describe, expect, it } from 'vitest'
import { buildWeeklyBody, buildWeeklyReport, buildWeeklySubject, GROUP_LABEL_EN, LIST_MAX, listedContactIds, reportName } from '../weekly-report'
import { emptyCounts, FOLLOWUP_GROUPS, type GroupVerdict } from '../groups'
import type { FollowupProgressDetail } from '../load'

const NOW = new Date('2026-11-29T19:00:00Z')
const TZ = 'Pacific/Auckland'

function detail(newLeads: number): FollowupProgressDetail {
  const counts = emptyCounts()
  const verdicts = new Map<string, GroupVerdict>()
  const dates: FollowupProgressDetail['dates'] = new Map()
  for (let i = 0; i < newLeads; i++) {
    verdicts.set(`n${i}`, { inScope: true, group: 'new_lead' })
    dates.set(`n${i}`, { lastEnquiryAt: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(), lastGuestMessageAt: null, lastStaffAt: null, lastEngagedAt: null, bulkLast7Days: 0 })
  }
  verdicts.set('w1', { inScope: true, group: 'awaiting_reply' })
  dates.set('w1', { lastEnquiryAt: null, lastGuestMessageAt: '2026-11-26T00:00:00Z', lastStaffAt: null, lastEngagedAt: null, bulkLast7Days: 0 })
  verdicts.set('c1', { inScope: true, group: 'cold' })
  verdicts.set('x1', { inScope: false, why: 'booked' })
  counts.total = newLeads + 3
  counts.inScope = newLeads + 2
  counts.groups.new_lead = newLeads
  counts.groups.awaiting_reply = 1
  counts.groups.cold = 1
  counts.out.booked = 1
  return { clientId: 'cid', at: NOW.toISOString(), counts, week: { guestsContactedByStaff: 3, guestsWhoReplied: 2, newEnquiries: 5, movedToQualified: 1, newBookings: 0, takenByAi: 4 }, verdicts, dates }
}

function names(d: FollowupProgressDetail): Map<string, string | null> {
  const m = new Map<string, string | null>()
  for (const id of d.verdicts.keys()) m.set(id, `Guest ${id}`)
  m.set('w1', 'jane.doe@example.com')
  return m
}

function report(newLeads: number, aiReady: number | null = 216) {
  const d = detail(newLeads)
  const weekAgo = { at: new Date(NOW.getTime() - 7 * 86_400_000).toISOString(), counts: { ...emptyCounts(), groups: { ...emptyCounts().groups, new_lead: newLeads - 2, cold: 1 } } }
  return buildWeeklyReport({ clientName: 'Acme <Tours>', day: 'Mon 30 Nov', detail: d, history: [weekAgo], names: names(d), aiReady, now: NOW })
}

describe('the weekly report', () => {
  it('asks for names of the two listed groups only', () => {
    expect(listedContactIds(detail(2)).sort()).toEqual(['n0', 'n1', 'w1'])
  })

  it('lists new leads newest first and caps the list, saying so next to the full count', () => {
    const r = report(LIST_MAX + 5)
    expect(r.newLeads.total).toBe(LIST_MAX + 5)
    expect(r.newLeads.shown).toHaveLength(LIST_MAX)
    expect(r.newLeads.shown[0].contactId).toBe('n0')
    const html = buildWeeklyBody(r, TZ)
    expect(html).toContain(`Showing the ${LIST_MAX} most recent of ${LIST_MAX + 5}`)
    expect(html).not.toContain(`Guest n${LIST_MAX + 4}`)
  })

  it('shows change against a week ago per group, and "no record yet" when there is no snapshot that old', () => {
    const r = report(5)
    expect(r.changes.new_lead).toBe(2)
    expect(r.changes.cold).toBe(0)
    const none = buildWeeklyReport({ clientName: 'A', day: 'd', detail: detail(1), history: [], names: new Map(), aiReady: null, now: NOW })
    expect(none.changes.new_lead).toBeNull()
    expect(buildWeeklyBody(none, TZ)).toContain('no record yet')
  })

  it('never prints an email address or a phone number: a name that is an address is cut at the @', () => {
    const html = buildWeeklyBody(report(2), TZ)
    expect(html).not.toContain('@example.com')
    expect(html).toContain('jane.doe')
    expect(html).not.toMatch(/\+64\d/)
  })

  it('escapes the client name and links each guest into the CRM', () => {
    const html = buildWeeklyBody(report(1), TZ)
    expect(html).toContain('Acme &lt;Tours&gt;')
    expect(html).not.toContain('Acme <Tours>')
    expect(html).toContain('https://app.magicengine.com.au/dashboard/clients/cid/crm/all?contact=n0')
    expect(html).toContain('https://app.magicengine.com.au/dashboard/clients/cid/crm/followup-progress')
  })

  it('says how many guests wait on the AI release page, and stays silent when the client does not use it', () => {
    expect(buildWeeklyBody(report(1, 216), TZ)).toContain('216 guests match the AI pickup rules')
    expect(buildWeeklyBody(report(1, 0), TZ)).toContain('nobody matches the AI pickup rules today')
    expect(buildWeeklyBody(report(1, null), TZ)).not.toContain('AI follow-up:')
  })

  it('unknown senders are counted in one sentence, never listed by name', () => {
    const d = detail(1)
    d.verdicts.set('u1', { inScope: true, group: 'unknown_sender' })
    d.counts.groups.unknown_sender = 1
    const n = names(d)
    n.set('u1', 'Pushy Supplier')
    const html = buildWeeklyBody(buildWeeklyReport({ clientName: 'A', day: 'd', detail: d, history: [], names: n, aiReady: null, now: NOW }), TZ)
    expect(html).toContain('1 sender emailed without ever filling a form')
    expect(html).not.toContain('Pushy Supplier')
    expect(listedContactIds(d)).not.toContain('u1')
  })

  it('a name that holds a phone number or an address is printed without them, in English', () => {
    expect(reportName('Mary 021 555 1234')).toBe('Mary')
    expect(reportName('Sue +6421987654')).not.toMatch(/\d{4}/)
    expect(reportName('Bob <bob@x.com> 0275551234')).not.toMatch(/@|\d{4}/)
    expect(reportName(null)).toBe('No name given')
    expect(reportName('Jane Doe')).toBe('Jane Doe')
    const d = detail(1)
    const n = names(d)
    n.set('n0', 'Mary 021 555 1234')
    const html = buildWeeklyBody(buildWeeklyReport({ clientName: 'A', day: 'd', detail: d, history: [], names: n, aiReady: null, now: NOW }), TZ)
    expect(html).not.toContain('555 1234')
    expect(html).not.toContain('号码略')
  })

  it('the reply list is ordered by when the guest last wrote, newest first, shown as a local date', () => {
    const d = detail(0)
    d.verdicts.set('w2', { inScope: true, group: 'awaiting_reply' })
    // 27 Nov 11:30 UTC is already 28 Nov in Auckland.
    d.dates.set('w2', { lastEnquiryAt: '2026-11-01T00:00:00Z', lastGuestMessageAt: '2026-11-27T11:30:00Z', lastStaffAt: null, lastEngagedAt: null, bulkLast7Days: 0 })
    const r = buildWeeklyReport({ clientName: 'A', day: 'd', detail: d, history: [], names: names(d), aiReady: null, now: NOW })
    expect(r.awaitingReply.shown.map((g) => g.contactId)).toEqual(['w2', 'w1'])
    expect(buildWeeklyBody(r, TZ)).toContain('last heard 28 Nov')
  })

  it('is marked Beta in the subject and at the top of the body, before any guest name', () => {
    const r = report(2)
    expect(buildWeeklySubject(r).startsWith('[Beta] ')).toBe(true)
    const html = buildWeeklyBody(r, TZ)
    expect(html).toContain('<b>Beta.</b>')
    expect(html.indexOf('<b>Beta.</b>')).toBeLessThan(html.indexOf('Guest n0'))
    expect(html).toContain('hello@magicengine.cloud')
    // An edition with nobody to call is still marked.
    const empty = report(0)
    expect(buildWeeklySubject(empty).startsWith('[Beta] ')).toBe(true)
    expect(buildWeeklyBody(empty, TZ)).toContain('<b>Beta.</b>')
  })

  it('says "on record", never that staff did not call, and says this list differs from the daily list', () => {
    const html = buildWeeklyBody(report(2), TZ)
    expect(html).not.toMatch(/nobody has (called|answered|emailed)/i)
    expect(html).not.toMatch(/never (called|contacted|emailed)/i)
    expect(html).toContain('no call or email on record')
    expect(html).toContain('can differ from the "今天先联系" page')
  })

  it('the subject carries the two numbers staff act on', () => {
    expect(buildWeeklySubject(report(1))).toBe('[Beta] Acme <Tours> · follow-up report Mon 30 Nov: 1 new lead to call, 1 waiting for a reply')
  })

  it('every group has English wording, and every group row is in the body', () => {
    const html = buildWeeklyBody(report(1), TZ)
    for (const g of FOLLOWUP_GROUPS) {
      expect(GROUP_LABEL_EN[g].length).toBeGreaterThan(0)
      expect(html).toContain(GROUP_LABEL_EN[g].replace(/"/g, '&quot;').replace(/&quot;/g, '"'))
    }
  })
})
