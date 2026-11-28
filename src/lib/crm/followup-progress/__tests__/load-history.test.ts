import { describe, expect, it } from 'vitest'
import { touchFacts, type TouchRow } from '../load'
import { delta, pointDaysAgo, pointFromSummary, FOLLOWUP_PROGRESS_JOB_NAME, type DayPoint } from '../history'
import { emptyCounts } from '../groups'
import { FOLLOWUP_PROGRESS_JOB } from '@/lib/inngest/functions/crm-followup-progress-daily'

function touch(over: Partial<TouchRow>): TouchRow {
  return { contact_id: 'c1', channel: 'email', direction: 'outbound', source: 'microsoft_mail', occurred_at: '2026-11-20T00:00:00Z', metadata: null, ...over }
}

describe('touchFacts', () => {
  it('a bulk mail and a machine-marked mail are not a staff contact', () => {
    const a = touchFacts([touch({ source: 'mailchimp' }), touch({ metadata: { automated: true } })])
    expect(a.staff).toBeNull()
  })

  it('a Messenger send is not a staff contact, and a Messenger thread row is not the guest speaking', () => {
    const a = touchFacts([touch({ channel: 'messenger', source: 'messenger' }), touch({ channel: 'messenger', source: 'messenger', direction: 'inbound' })])
    expect(a.staff).toBeNull()
    expect(a.guest).toBeNull()
  })

  it('a staff mail is a staff contact; the latest one wins', () => {
    const a = touchFacts([touch({ occurred_at: '2026-11-21T00:00:00Z' }), touch({ occurred_at: '2026-11-10T00:00:00Z' })])
    expect(a.staff).toBe('2026-11-21T00:00:00Z')
  })

  it('a reply mail is the guest speaking; an open or click of our mail is engagement, not a message', () => {
    const a = touchFacts([
      touch({ direction: 'inbound', occurred_at: '2026-11-22T00:00:00Z' }),
      touch({ direction: 'inbound', source: 'mailchimp', occurred_at: '2026-11-25T00:00:00Z' }),
      touch({ direction: 'inbound', metadata: { email_clicked: true }, occurred_at: '2026-11-26T00:00:00Z' }),
    ])
    expect(a.guest).toBe('2026-11-22T00:00:00Z')
    expect(a.engaged).toBe('2026-11-26T00:00:00Z')
  })

  it('a call the guest made and we missed is the guest speaking and not a staff contact', () => {
    const a = touchFacts([touch({ channel: 'phone', source: 'twilio', direction: 'inbound', metadata: { outcome: 'missed_inbound' } })])
    expect(a.staff).toBeNull()
    expect(a.guest).toBe('2026-11-20T00:00:00Z')
  })

  it('a call the guest made and we answered is both, at the same instant', () => {
    const a = touchFacts([touch({ channel: 'phone', source: 'twilio', direction: 'inbound', metadata: { outcome: 'spoke' } })])
    expect(a.guest).toBe('2026-11-20T00:00:00Z')
    expect(a.staff).toBe('2026-11-20T00:00:00Z')
  })

  it('an outbound call nobody answered is not a staff contact', () => {
    const a = touchFacts([touch({ channel: 'phone', source: 'twilio', metadata: { answered: false } })])
    expect(a.staff).toBeNull()
  })

  it('an enquiry form is an enquiry, not a message', () => {
    const a = touchFacts([touch({ channel: 'meta_lead_form', source: 'meta_lead_form', direction: 'inbound' })])
    expect(a.enquiry).toBe('2026-11-20T00:00:00Z')
    expect(a.guest).toBeNull()
  })
})

describe('history', () => {
  const counts = (cold: number) => ({ ...emptyCounts(), groups: { ...emptyCounts().groups, cold } })
  const summary = (clientId: string, ok: boolean, c: unknown) => ({ results: [{ client_id: 'other', ok: true, created_at: '2026-11-27T17:30:00Z', counts: counts(1) }, { client_id: clientId, ok, created_at: '2026-11-27T17:30:00Z', counts: c }] })

  it('the page and the job agree on the job name', () => {
    expect(FOLLOWUP_PROGRESS_JOB_NAME).toBe(FOLLOWUP_PROGRESS_JOB)
  })

  it('reads this client only, and only a good snapshot', () => {
    expect(pointFromSummary(summary('a', true, counts(7)), 'a')?.counts.groups.cold).toBe(7)
    expect(pointFromSummary(summary('a', false, counts(7)), 'a')).toBeNull()
    expect(pointFromSummary(summary('a', true, { groups: { cold: 'x' } }), 'a')).toBeNull()
    expect(pointFromSummary(null, 'a')).toBeNull()
    expect(pointFromSummary(summary('a', true, counts(7)), 'missing')).toBeNull()
  })

  it('picks the newest snapshot that is old enough, and reports no change as null when there is none', () => {
    const now = new Date('2026-11-28T20:00:00Z')
    const h: DayPoint[] = [
      { at: '2026-11-28T17:30:00Z', counts: counts(10) },
      { at: '2026-11-27T17:30:00Z', counts: counts(12) },
      { at: '2026-11-21T17:30:00Z', counts: counts(20) },
    ]
    expect(pointDaysAgo(h, now, 1)?.at).toBe('2026-11-27T17:30:00Z')
    expect(pointDaysAgo(h, now, 7)?.at).toBe('2026-11-21T17:30:00Z')
    expect(pointDaysAgo(h, now, 30)).toBeNull()
    expect(delta(counts(9), pointDaysAgo(h, now, 1), 'cold')).toBe(-3)
    expect(delta(counts(9), null, 'cold')).toBeNull()
  })
})
