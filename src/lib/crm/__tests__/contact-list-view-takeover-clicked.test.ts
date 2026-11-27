/**
 * PM 11-27: guests handed to the AI with the 2027 catalogue who then opened it (a human click on our own mail link)
 * were never put back on the staff list. They now come back to 「今天要联系」 as 「点了邮件里的链接」 until a person
 * actually talks to them; an unanswered call keeps them there.
 */
import { describe, expect, it } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, TouchpointRowLike } from '../contact-model'
import type { SiteReading } from '../segments'
import { applyTakeoverToDayList } from '../ai-takeover/day-list-filter'
import { attachLastClicks } from '../email-templates/link-tracking/site-reading'

const NOW = new Date('2026-11-27T03:00:00Z')
const DAY_START = Date.parse('2026-11-26T11:00:00Z')
const SINCE = '2026-11-12T01:00:00Z' // catalogue sent, AI follow-up on
const CLICK = '2026-11-13T08:00:00Z'

function row(id: string): ContactRowLike {
  return { id, display_name: id, primary_phone: '+64211230001', primary_email: `${id}@example.com`, do_not_contact: false, snooze_until: null, stage: 'contacted' }
}
const enquiry = (id: string): TouchpointRowLike => ({ contact_id: id, channel: 'meta_lead_form', direction: 'inbound', occurred_at: '2026-11-01T00:00:00Z', source: 'meta_lead_form', raw: null, metadata: null })
const call = (id: string, at: string, outcome: string): TouchpointRowLike => ({ contact_id: id, channel: 'phone', direction: 'outbound', occurred_at: at, source: 'me_manual', raw: null, metadata: { outcome } })
const catalogue = (id: string): TouchpointRowLike => ({ contact_id: id, channel: 'email', direction: 'outbound', occurred_at: SINCE, source: 'microsoft_mail', raw: null, metadata: { automated: false } })
const clicked: SiteReading = { tours: [], brochureVisits: 0, lastAt: CLICK, lastClickAt: CLICK }

function view(touchpoints: TouchpointRowLike[], reading: Map<string, SiteReading>) {
  const out = buildPriorityView(
    {
      contacts: [row('g')],
      touchpoints,
      stageMeta: new Map(),
      now: NOW,
      open: { hot: true, cold: true },
      dayStartMs: DAY_START,
      touchedToday: new Set(),
      takeoverSince: new Map([['g', SINCE]]),
      siteReading: reading,
    },
    (_r, ranked) => ({ segment: ranked.seg.segment, reason: ranked.seg.reason, aiTakeover: ranked.aiTakeover }),
  )
  const items = (key: 'hot' | 'cold') => out.sections.find((s) => s.key === key)?.items ?? []
  return { hot: items('hot'), cold: items('cold') }
}

const base = (id: string) => [enquiry(id), call(id, '2026-11-11T22:00:00Z', 'spoke'), catalogue(id)]

describe('AI follow-up guests who opened the catalogue we sent', () => {
  it('come back to 「今天要联系」 as 「点了邮件里的链接」, still marked AI follow-up', () => {
    const v = view(base('g'), new Map([['g', clicked]]))
    expect(v.hot).toHaveLength(1)
    expect(v.hot[0]).toMatchObject({ segment: 'clicked_link', aiTakeover: true })
    expect(v.hot[0].reason).toContain('点开了我们邮件里的链接')
  })

  it('stay hidden in 「先放着」 when they never clicked', () => {
    const v = view(base('g'), new Map())
    expect(v.hot).toHaveLength(0)
    expect(v.cold).toHaveLength(1)
  })

  it('an unanswered call after the click keeps them on the list (system call or staff-logged no answer)', () => {
    // Same rule as every other guest: after three days of no answer the list hands him to the system (handoff_sop).
    const missed = { ...call('g', '2026-11-26T03:00:00Z', 'no_answer'), source: 'twilio', metadata: { answered: false } }
    expect(view([...base('g'), missed], new Map([['g', clicked]])).hot).toHaveLength(1)
    expect(view([...base('g'), call('g', '2026-11-26T03:00:00Z', 'no_answer')], new Map([['g', clicked]])).hot).toHaveLength(1)
  })

  it('a staff-logged no answer without any click stays with the AI', () => {
    expect(view([...base('g'), call('g', '2026-11-26T03:00:00Z', 'no_answer')], new Map()).hot).toHaveLength(0)
  })

  it('a real conversation after the click takes them off again', () => {
    const v = view([...base('g'), call('g', '2026-11-20T00:00:00Z', 'spoke')], new Map([['g', clicked]]))
    expect(v.hot).toHaveLength(0)
  })

  it('the today board shows the same guest (filter reads the guest group)', () => {
    const opts = { takeoverSince: new Map([['g', SINCE]]), touchesOf: () => [], dayStartMs: DAY_START, now: NOW }
    const seg = (segment: 'clicked_link' | 'stale_conversation') => ({ segment, temperature: 'warm', priority: 5, reason: '', suggestedChannel: 'phone' }) as never
    expect(applyTakeoverToDayList([{ id: 'g', seg: seg('clicked_link') }], opts)).toHaveLength(1)
    expect(applyTakeoverToDayList([{ id: 'g', seg: seg('stale_conversation') }], opts)).toHaveLength(0)
  })
})

describe('attachLastClicks', () => {
  it('keeps the latest click per guest within 60 days, ignores the future and older clicks', () => {
    const c = (contact: string, at: string) => ({ contact_id: contact, token: 'T', path: null, occurred_at: at })
    const out = attachLastClicks(
      new Map([['a', { tours: ['X'], brochureVisits: 1, lastAt: '2026-11-26T00:00:00Z' }]]),
      [c('a', '2026-11-26T00:00:00Z'), c('b', '2026-11-13T08:00:00Z'), c('b', '2026-11-10T08:00:00Z'), c('old', '2026-09-01T00:00:00Z'), c('fut', '2026-11-28T00:00:00Z')],
      NOW,
    )
    expect(out.get('a')).toMatchObject({ tours: ['X'], lastClickAt: '2026-11-26T00:00:00.000Z' })
    expect(out.get('b')).toEqual({ tours: [], brochureVisits: 0, lastAt: '2026-11-13T08:00:00.000Z', lastClickAt: '2026-11-13T08:00:00.000Z' })
    expect(out.has('old')).toBe(false)
    expect(out.has('fut')).toBe(false)
  })
})
