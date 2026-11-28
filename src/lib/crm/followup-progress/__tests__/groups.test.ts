import { describe, expect, it } from 'vitest'
import { countGroups, DEFAULT_GROUP_CONFIG, FOLLOWUP_GROUPS, groupMeta, groupOf, type GuestFacts } from '../groups'

const NOW = new Date('2026-11-28T00:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function facts(over: Partial<GuestFacts> = {}): GuestFacts {
  return {
    doNotContact: false,
    hasActiveBooking: false,
    stage: 'contacted',
    stageAction: 'nurture',
    stageTerminal: false,
    qualified: false,
    notGuest: false,
    aiTakeoverSince: null,
    snoozed: false,
    hasEmail: true,
    hasPhone: true,
    lastStaffAt: null,
    lastGuestMessageAt: null,
    lastGuestMessageChannel: null,
    lastEnquiryAt: null,
    lastEngagedAt: null,
    ...over,
  }
}

describe('groupOf', () => {
  it('do-not-contact wins over everything', () => {
    const f = facts({ doNotContact: true, hasActiveBooking: true, aiTakeoverSince: daysAgo(3) })
    expect(groupOf(f, NOW)).toEqual({ inScope: false, why: 'do_not_contact' })
  })

  it('active booking is out of scope', () => {
    expect(groupOf(facts({ hasActiveBooking: true }), NOW)).toEqual({ inScope: false, why: 'booked' })
  })

  it('a guest nobody has moved yet (no stage) is an open new lead, not "cannot judge"', () => {
    expect(groupOf(facts({ stage: null, stageAction: null, lastEnquiryAt: daysAgo(2) }), NOW)).toEqual({ inScope: true, group: 'new_lead' })
    expect(groupOf(facts({ stage: '', stageAction: null, lastEnquiryAt: daysAgo(40) }), NOW)).toEqual({ inScope: true, group: 'never_contacted' })
  })

  it('not a guest (staff, trade, system account, test lead) is out of scope, after do-not-contact only', () => {
    expect(groupOf(facts({ notGuest: true, hasActiveBooking: true, lastGuestMessageAt: daysAgo(1) }), NOW)).toEqual({ inScope: false, why: 'not_guest' })
  })

  it('with the AI: stays "ai" until the guest speaks after the takeover and nobody answers', () => {
    expect(groupOf(facts({ aiTakeoverSince: daysAgo(5), lastGuestMessageAt: daysAgo(9), lastStaffAt: null }), NOW)).toEqual({ inScope: true, group: 'ai' })
    expect(groupOf(facts({ aiTakeoverSince: daysAgo(5), lastGuestMessageAt: daysAgo(1), lastStaffAt: daysAgo(8) }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
    expect(groupOf(facts({ aiTakeoverSince: daysAgo(5), lastGuestMessageAt: daysAgo(2), lastStaffAt: daysAgo(1) }), NOW)).toEqual({ inScope: true, group: 'ai' })
  })

  it('snoozed by staff is "later", but a guest who wrote since still waits for a reply', () => {
    expect(groupOf(facts({ snoozed: true, lastEnquiryAt: daysAgo(2) }), NOW)).toEqual({ inScope: true, group: 'later' })
    expect(groupOf(facts({ snoozed: true, lastGuestMessageAt: daysAgo(1), lastEnquiryAt: daysAgo(30) }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
  })

  it('never contacted and never filled a form is its own group, not "filled a form"', () => {
    expect(groupOf(facts({}), NOW)).toEqual({ inScope: true, group: 'no_enquiry' })
  })

  it('unknown stage is out of scope', () => {
    expect(groupOf(facts({ stage: 'x', stageAction: null }), NOW)).toEqual({ inScope: false, why: 'unknown_stage' })
  })

  it('closed stages are out of scope', () => {
    expect(groupOf(facts({ stageAction: 'suppress' }), NOW)).toEqual({ inScope: false, why: 'closed_stage' })
    expect(groupOf(facts({ stageAction: 'postsale' }), NOW)).toEqual({ inScope: false, why: 'closed_stage' })
    expect(groupOf(facts({ stageAction: 'won' }), NOW)).toEqual({ inScope: false, why: 'closed_stage' })
    expect(groupOf(facts({ stageAction: 'nurture', stageTerminal: true }), NOW)).toEqual({ inScope: false, why: 'closed_stage' })
  })

  it('ai takeover wins over qualified', () => {
    expect(groupOf(facts({ aiTakeoverSince: daysAgo(3), qualified: true }), NOW)).toEqual({ inScope: true, group: 'ai' })
  })

  it('qualified stays with staff even when the guest wrote last', () => {
    const f = facts({ qualified: true, lastGuestMessageAt: daysAgo(1), lastStaffAt: daysAgo(5) })
    expect(groupOf(f, NOW)).toEqual({ inScope: true, group: 'qualified' })
  })

  it('no email and no phone is no_contact_details', () => {
    expect(groupOf(facts({ hasEmail: false, hasPhone: false }), NOW)).toEqual({ inScope: true, group: 'no_contact_details' })
  })

  it('guest wrote after staff (or with no staff) is awaiting_reply', () => {
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastStaffAt: daysAgo(5) }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastEnquiryAt: daysAgo(9) }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
  })

  it('wrote out of the blue (no form, never contacted) is kept apart from guests waiting for a reply', () => {
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastGuestMessageChannel: 'email' }), NOW)).toEqual({ inScope: true, group: 'unknown_sender' })
    // A call or a WhatsApp message from someone we do not know is a guest: stays on the reply list.
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastGuestMessageChannel: 'phone' }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastGuestMessageChannel: 'whatsapp' }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
    // With the AI and wrote since: staff must see this guest, whatever the channel.
    expect(groupOf(facts({ aiTakeoverSince: daysAgo(5), lastGuestMessageAt: daysAgo(1), lastGuestMessageChannel: 'email' }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
    expect(groupOf(facts({ lastGuestMessageAt: daysAgo(2), lastStaffAt: daysAgo(5) }), NOW)).toEqual({ inScope: true, group: 'awaiting_reply' })
  })

  it('staff replied after the guest and no engagement is cold', () => {
    const f = facts({ lastGuestMessageAt: daysAgo(5), lastStaffAt: daysAgo(2) })
    expect(groupOf(f, NOW)).toEqual({ inScope: true, group: 'cold' })
  })

  it('guest and staff at the same instant is not awaiting_reply', () => {
    const at = daysAgo(2)
    const f = facts({ lastGuestMessageAt: at, lastStaffAt: at })
    expect(groupOf(f, NOW)).toEqual({ inScope: true, group: 'cold' })
  })

  it('recent enquiry with no staff contact after it is new_lead', () => {
    expect(groupOf(facts({ lastEnquiryAt: daysAgo(3) }), NOW)).toEqual({ inScope: true, group: 'new_lead' })
    expect(groupOf(facts({ lastEnquiryAt: daysAgo(3), lastStaffAt: daysAgo(10) }), NOW)).toEqual({ inScope: true, group: 'new_lead' })
  })

  it('recent enquiry with staff contact after it is cold', () => {
    const f = facts({ lastEnquiryAt: daysAgo(3), lastStaffAt: daysAgo(1) })
    expect(groupOf(f, NOW)).toEqual({ inScope: true, group: 'cold' })
  })

  it('old enquiry with no staff contact is never_contacted', () => {
    expect(groupOf(facts({ lastEnquiryAt: daysAgo(20) }), NOW)).toEqual({ inScope: true, group: 'never_contacted' })
  })

  it('new-lead boundary is inclusive', () => {
    expect(groupOf(facts({ lastEnquiryAt: daysAgo(DEFAULT_GROUP_CONFIG.newLeadDays) }), NOW)).toEqual({ inScope: true, group: 'new_lead' })
    expect(groupOf(facts({ lastEnquiryAt: daysAgo(DEFAULT_GROUP_CONFIG.newLeadDays + 1) }), NOW)).toEqual({ inScope: true, group: 'never_contacted' })
  })

  it('defer is later, but a fresh form beats later', () => {
    expect(groupOf(facts({ stageAction: 'defer', lastStaffAt: daysAgo(40) }), NOW)).toEqual({ inScope: true, group: 'later' })
    expect(groupOf(facts({ stageAction: 'defer', lastEnquiryAt: daysAgo(3) }), NOW)).toEqual({ inScope: true, group: 'new_lead' })
  })

  it('recent engagement makes a quiet guest warm, older is cold', () => {
    expect(groupOf(facts({ lastStaffAt: daysAgo(40), lastEngagedAt: daysAgo(10) }), NOW)).toEqual({ inScope: true, group: 'warm' })
    expect(groupOf(facts({ lastStaffAt: daysAgo(40), lastEngagedAt: daysAgo(31) }), NOW)).toEqual({ inScope: true, group: 'cold' })
  })

  it('an unparseable staff date counts as no staff contact', () => {
    const f = facts({ lastStaffAt: 'not a date', lastEnquiryAt: daysAgo(20) })
    expect(groupOf(f, NOW)).toEqual({ inScope: true, group: 'never_contacted' })
  })
})

describe('countGroups', () => {
  it('counts in-scope groups and out-of-scope reasons', () => {
    const verdicts = [
      groupOf(facts({ doNotContact: true }), NOW),
      groupOf(facts({ lastStaffAt: daysAgo(40) }), NOW),
      groupOf(facts({ lastStaffAt: daysAgo(40) }), NOW),
      groupOf(facts({ lastStaffAt: daysAgo(40), lastEngagedAt: daysAgo(10) }), NOW),
    ]
    const counts = countGroups(verdicts)
    expect(counts.total).toBe(4)
    expect(counts.inScope).toBe(3)
    expect(counts.groups.cold).toBe(2)
    expect(counts.groups.warm).toBe(1)
    expect(counts.out.do_not_contact).toBe(1)
  })
})

describe('GROUP_META', () => {
  it('has a labelled entry for every follow-up group', () => {
    for (const group of FOLLOWUP_GROUPS) {
      const meta = groupMeta()[group]
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.howTo.length).toBeGreaterThan(0)
    }
  })
})
