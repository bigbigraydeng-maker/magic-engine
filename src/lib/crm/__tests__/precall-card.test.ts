/**
 * Read-side wiring of the pre-call card: industry gate for the "ask on the call"
 * list, latest-brief pick, read-failure flag, and the quiet (null) case.
 * All names / phones in fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { loadPrecallCard } from '../precall-card'

let industry: string | null = 'Travel — Tour Operator'
let briefResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null }

function mockDb(): void {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { industry }, error: null }) }) }),
      }
    }
    return {
      select: () => ({ eq: () => ({ in: async () => briefResult }) }),
    }
  })
}

const BRIEF_ROW = {
  summary: 'Wants a China tour',
  intent_level: 'high',
  next_action: 'Call',
  customer_needs: [],
  promises_made: [],
  risk_flags: [],
  trip: { tour_interest: 'Test Tour', travel_window: null, party_size: 2, departure_city: null, first_time_to_china: null },
  contact: { phone: null, email: null },
  generated_at: '2026-10-05T00:00:00Z',
}

const FORM_LINE = 'Hello! I filled out your form and would like to know more about your business.'

const BASE = {
  clientId: 'client-a',
  conversationIds: ['conv-1'],
  contact: { phone: '021 000 0000', email: null, doNotContactFlag: false },
  touches: [],
  messages: [{ direction: 'inbound' as const, body: FORM_LINE, sentAt: '2026-10-05T01:00:00Z' }],
  now: new Date('2026-10-14T00:00:00Z'),
}

describe('loadPrecallCard', () => {
  beforeEach(() => {
    industry = 'Travel — Tour Operator'
    briefResult = { data: [BRIEF_ROW], error: null }
    mockDb()
  })

  it('travel client: lists the empty trip facts to ask on the call', async () => {
    const card = await loadPrecallCard(BASE)
    expect(card?.brief?.askMissing).toEqual([
      '想什么时候出行',
      '从哪个城市出发',
      '是不是第一次去',
    ])
    expect(card?.brief?.phone).toBe('021 000 0000')
  })

  it('non-travel client: no travel ask list', async () => {
    industry = 'Logistics'
    const card = await loadPrecallCard(BASE)
    expect(card?.brief?.askMissing).toEqual([])
  })

  it('form lead with no human touch past the due time is overdue; guest has not replied', async () => {
    const card = await loadPrecallCard(BASE)
    expect(card?.lead).toMatchObject({ isFormLead: true, overdue: true, guestReplied: false })
  })

  it('a phone touch after the form clears overdue', async () => {
    const card = await loadPrecallCard({
      ...BASE,
      touches: [
        { channel: 'phone', direction: 'outbound', occurredAt: '2026-10-06T01:00:00Z', source: null, metadata: null },
      ],
    })
    expect(card?.lead.overdue).toBe(false)
  })

  it('do-not-contact flag never shows overdue', async () => {
    const card = await loadPrecallCard({ ...BASE, contact: { ...BASE.contact, doNotContactFlag: true } })
    expect(card?.lead.overdue).toBe(false)
  })

  it('brief read failure is flagged, not shown as empty', async () => {
    briefResult = { data: null, error: { message: 'boom' } }
    const card = await loadPrecallCard(BASE)
    expect(card?.briefReadFailed).toBe(true)
    expect(card?.brief).toBeNull()
  })

  it('nothing to show -> null', async () => {
    briefResult = { data: [], error: null }
    const card = await loadPrecallCard({ ...BASE, messages: [] })
    expect(card).toBeNull()
  })
})
