import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPartyHint } from '../crm-deal-party-read'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown>

function fakeDb(tables: Record<string, Row[]>): { db: SupabaseClient; orders: string[] } {
  const orders: string[] = []
  const db = {
    from(table: string) {
      return {
        select() {
          const filters: Array<(row: Row) => boolean> = []
          const chain = {
            eq(column: string, value: string) {
              filters.push((row) => row[column] === value)
              return chain
            },
            in(column: string, values: string[]) {
              filters.push((row) => values.includes(String(row[column])))
              return chain
            },
            order(column: string) {
              orders.push(`${table}.${column}`)
              return chain
            },
            then(onfulfilled: (value: { data: Row[]; error: null }) => unknown) {
              const data = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)))
              return Promise.resolve({ data, error: null }).then(onfulfilled)
            },
          }
          return chain
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, orders }
}

function touch(over: Row): Row {
  return {
    client_id: CLIENT,
    contact_id: CONTACT,
    direction: 'inbound',
    channel: 'email',
    occurred_at: '2026-01-02T00:00:00.000Z',
    ...over,
  }
}

describe('readPartyHint', () => {
  it('reads the guest message and skips our outgoing mail', async () => {
    const { db } = fakeDb({
      contact_touchpoints: [
        touch({ summary: '4 pax', direction: 'outbound', occurred_at: '2026-01-01T00:00:00.000Z' }),
        touch({ summary: '2 pax', direction: 'inbound' }),
      ],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toEqual({ size: 2, source: 'guest_message' })
  })

  it('asks for time order and does not guess a total from adults plus children', async () => {
    const { db, orders } = fakeDb({
      contact_touchpoints: [touch({ summary: '2 adults and 1 child' })],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toBeNull()
    expect(orders).toContain('contact_touchpoints.occurred_at')
    expect(orders).toContain('conversations.last_message_at')
  })

  it('uses one agreed conversation summary before the mail', async () => {
    const { db, orders } = fakeDb({
      conversations: [{ id: 'c1', client_id: CLIENT, contact_id: CONTACT, channel: 'email' }],
      conversation_briefs: [{ conversation_id: 'c1', trip: { party_size: 3 }, generated_at: '2026-01-02' }],
      contact_touchpoints: [touch({ summary: '4 pax' })],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toEqual({ size: 3, source: 'ai_summary' })
    expect(orders).toContain('conversation_briefs.generated_at')
  })

  it('does not fill a number when two summaries disagree', async () => {
    const { db } = fakeDb({
      conversations: [{ id: 'c1', client_id: CLIENT, contact_id: CONTACT, channel: 'email' }],
      conversation_briefs: [
        { conversation_id: 'c1', trip: { party_size: 3 }, generated_at: '2026-01-01' },
        { conversation_id: 'c1', trip: { party_size: 4 }, generated_at: '2026-01-02' },
      ],
      contact_touchpoints: [touch({ summary: '2 pax' })],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toBeNull()
  })

  it('keeps a phone call even when we placed it, and reads the stored fact list', async () => {
    const { db } = fakeDb({
      contact_touchpoints: [
        touch({
          channel: 'phone',
          direction: 'outbound',
          summary: '9 pax',
          metadata: { call_analysis_id: 'call-1' },
        }),
      ],
      telephony_call_analyses: [{
        id: 'call-1',
        client_id: CLIENT,
        facts: [{ key: 'party_size', value: '4' }],
      }],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toEqual({ size: 4, source: 'call' })
  })

  it('reads an inbound email body and skips the copy we sent', async () => {
    const { db, orders } = fakeDb({
      conversations: [{ id: 'c1', client_id: CLIENT, contact_id: CONTACT, channel: 'email' }],
      conversation_messages: [
        { conversation_id: 'c1', direction: 'outbound', body: 'party of 9', sent_at: '2026-01-01' },
        { conversation_id: 'c1', direction: 'inbound', body: 'party of 5', sent_at: '2026-01-02' },
      ],
    })
    expect(await readPartyHint(db, CLIENT, CONTACT)).toEqual({ size: 5, source: 'guest_message' })
    expect(orders).toContain('conversation_messages.sent_at')
  })
})
