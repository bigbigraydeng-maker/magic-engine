/**
 * 同事发出点名出发日的推荐邮件后，把「已联系」推进到「已报价」。
 *
 * 钉死的几件事：主题必须同时有「推荐措辞 + 出发日」· 转发 / 群发 / 自动回执不算 ·
 * 人在邮件之后手动定过阶段就不碰 · 写库再判一次阶段没被改 · 留痕写不上就退回。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { advanceContactedAfterQuoteEmail, isQuoteEmailSubject } from '../advance-after-quote'
import { CALL_REACHED_ACTOR, QUOTE_EMAIL_ACTOR } from '../actors'

const NOW = new Date('2026-11-01T00:00:00Z')
const CLIENT = 'client-1'
const STAGE_AT = '2026-10-10T00:00:00Z'
const MAIL_AT = '2026-10-07T00:00:00Z'
const QUOTE_SUBJECT = 'My recommendation for your travel to China - Best of China departing on 11 March 2027'

interface Touch {
  contact_id: string
  source: string | null
  summary?: string | null
  metadata: Record<string, unknown> | null
  occurred_at: string
}
interface Fake {
  stages: string[]
  contacts: { id: string; client_id: string; stage_updated_at: string | null }[]
  events: { contact_id: string; changed_by: string | null; created_at: string }[]
  touches: Touch[]
  updated: number
  auditErr?: string
}

let updates: Record<string, unknown>[]
let audits: Record<string, unknown>[]
let filters: [string, unknown][]
let gtValue: string | null
let limitValue: number | null

function chain(result: () => unknown) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'in', 'is', 'order']) b[m] = self
  b.limit = (n: number) => {
    limitValue = n
    return b
  }
  b.gt = (_c: string, v: string) => {
    gtValue = v
    return b
  }
  b.eq = (col: string, val: unknown) => {
    filters.push([col, val])
    return b
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
  return b
}

function mail(over: Partial<Touch> = {}): Touch {
  return { contact_id: 'c1', source: 'microsoft_mail', metadata: { subject: QUOTE_SUBJECT }, occurred_at: MAIL_AT, ...over }
}

function stubDb(over: Partial<Fake> = {}): SupabaseClient {
  const f: Fake = {
    stages: ['new', 'contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'],
    contacts: [{ id: 'c1', client_id: CLIENT, stage_updated_at: STAGE_AT }],
    events: [{ contact_id: 'c1', changed_by: CALL_REACHED_ACTOR, created_at: STAGE_AT }],
    touches: [mail()],
    updated: 1,
    ...over,
  }
  updates = []
  audits = []
  filters = []
  gtValue = null
  limitValue = null
  const from = (table: string) => {
    if (table === 'client_pipeline_stages') {
      return chain(() => ({ data: f.stages.map((stage_key) => ({ stage_key, client_id: CLIENT })), error: null }))
    }
    if (table === 'contacts') {
      return {
        select: () =>
          chain(() => {
            const rows = f.contacts.filter((c) => gtValue === null || c.id > gtValue)
            return { data: limitValue === null ? rows : rows.slice(0, limitValue), error: null }
          }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch)
          return chain(() => ({ data: Array.from({ length: f.updated }, () => ({ id: 'c1' })), error: null }))
        },
      }
    }
    if (table === 'contact_stage_events') {
      return {
        select: () => chain(() => ({ data: f.events, error: null })),
        insert: (row: Record<string, unknown>) => {
          audits.push(row)
          return Promise.resolve({ error: f.auditErr ? { message: f.auditErr } : null })
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return { select: () => chain(() => ({ data: f.touches, error: null })) }
    }
    throw new Error(`unexpected table ${table}`)
  }
  mocks.from.mockImplementation(from)
  return { from } as unknown as SupabaseClient
}

beforeEach(() => {
  mocks.from.mockReset()
})

describe('isQuoteEmailSubject', () => {
  it.each([
    QUOTE_SUBJECT,
    'my recommendation for your first travel to China -- Shanghai & Surroundings departing on 25 March 2027',
    'My suggestion for your travel to China- Best of China departing on 11 March 2027',
    'my recommendation for your travel to China- China Unveiled 30 July 2027',
    'Re: My recommendation for your travel to China - Golden China Tour departing on 16 Nov 2026',
  ])('accepts %s', (s) => expect(isQuoteEmailSubject(s)).toBe(true))

  it.each([
    ['recommendation only, no departure', 'My recommendation for your travel to China'],
    ['departure only, no recommendation', 'Shanghai & Beyond Tour departing on 25 March 2027'],
    ['a forward is not a quote to the customer', 'Fw: My recommendation for your travel to China - Golden China Tour departing on 16 Nov 2026'],
    ['forward (Fwd)', 'Fwd: My recommendation - Best of China departing on 11 March 2027'],
    ['generic reply', 'Re: Tour'],
    ['the customer\'s own quote-request subject', 'Re: Family Travel to China (6 Pax – November 2026) | Inquiry & Quote Request'],
    ['an itinerary-ready note without a recommendation', 'Re: Your Nov-Dec 2026 China itinerary is ready'],
    ['empty', ''],
  ])('rejects %s', (_why, s) => expect(isQuoteEmailSubject(s)).toBe(false))

  it('rejects null / undefined', () => {
    expect(isQuoteEmailSubject(null)).toBe(false)
    expect(isQuoteEmailSubject(undefined)).toBe(false)
  })
})

describe('advanceContactedAfterQuoteEmail', () => {
  it('moves a contacted lead with a one-to-one quote email to quoted, with an audit row', async () => {
    const db = stubDb()
    expect(await advanceContactedAfterQuoteEmail(NOW, db)).toEqual({ candidates: 1, advanced: 1, failed: 0 })
    expect(updates[0]).toMatchObject({ stage: 'quoted' })
    expect(audits[0]).toMatchObject({ contact_id: 'c1', from_stage: 'contacted', to_stage: 'quoted', changed_by: QUOTE_EMAIL_ACTOR })
    expect(String(audits[0].note)).toContain('Best of China')
    expect(filters).toContainEqual(['stage', 'contacted'])
    expect(filters).toContainEqual(['stage_updated_at', STAGE_AT])
    expect(filters).toContainEqual(['do_not_contact', false])
  })

  it('does nothing when the subject only names the departure (not a recommendation)', async () => {
    const db = stubDb({ touches: [mail({ metadata: { subject: 'Shanghai & Beyond Tour departing on 25 March 2027' } })] })
    expect((await advanceContactedAfterQuoteEmail(NOW, db)).advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('ignores a bulk / automated email even with a matching subject', async () => {
    const bulk = stubDb({ touches: [mail({ source: 'mailchimp' })] })
    expect((await advanceContactedAfterQuoteEmail(NOW, bulk)).advanced).toBe(0)
    const auto = stubDb({ touches: [mail({ metadata: { subject: QUOTE_SUBJECT, automated: true } })] })
    expect((await advanceContactedAfterQuoteEmail(NOW, auto)).advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('ignores a CRM-sent mail whose summary (body start) looks like a quote but has no real subject', async () => {
    const db = stubDb({ touches: [mail({ metadata: null, summary: 'My recommendation: Best of China departing on 11 March 2027 is filling fast' })] })
    expect((await advanceContactedAfterQuoteEmail(NOW, db)).advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('a human decision still counts after a later machine change', async () => {
    const db = stubDb({
      events: [
        { contact_id: 'c1', changed_by: CALL_REACHED_ACTOR, created_at: STAGE_AT },
        { contact_id: 'c1', changed_by: 'info@ctstours.co.nz', created_at: '2026-10-09T00:00:00Z' },
      ],
    })
    expect((await advanceContactedAfterQuoteEmail(NOW, db)).advanced).toBe(0)
  })

  it('leaves the contact alone when a human set the stage after the quote email', async () => {
    const db = stubDb({ events: [{ contact_id: 'c1', changed_by: 'info@ctstours.co.nz', created_at: '2026-10-09T00:00:00Z' }] })
    expect((await advanceContactedAfterQuoteEmail(NOW, db)).advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('still advances when a human set contacted BEFORE the quote email', async () => {
    const db = stubDb({ events: [{ contact_id: 'c1', changed_by: 'info@ctstours.co.nz', created_at: '2026-10-05T00:00:00Z' }] })
    expect((await advanceContactedAfterQuoteEmail(NOW, db)).advanced).toBe(1)
  })

  it('does not count a failed write as advanced when the staff member changed it first', async () => {
    const db = stubDb({ updated: 0 })
    expect(await advanceContactedAfterQuoteEmail(NOW, db)).toEqual({ candidates: 1, advanced: 0, failed: 0 })
    expect(audits).toHaveLength(0)
  })

  it('rolls the stage back when the audit row cannot be written', async () => {
    const db = stubDb({ auditErr: 'boom' })
    const r = await advanceContactedAfterQuoteEmail(NOW, db)
    expect(r).toEqual({ candidates: 1, advanced: 0, failed: 1 })
    expect(updates).toHaveLength(2)
    expect(updates[1]).toMatchObject({ stage: 'contacted', stage_updated_at: STAGE_AT })
  })

  it('skips clients whose pipeline has no quoted stage', async () => {
    const db = stubDb({ stages: ['new', 'contacted', 'deferred', 'no_response', 'traveling_soon'] })
    expect(await advanceContactedAfterQuoteEmail(NOW, db)).toEqual({ candidates: 0, advanced: 0, failed: 0 })
  })
})
