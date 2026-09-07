import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMessengerSendGate } from '../messenger-send-gate'

type Row = Record<string, unknown>

function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table]
      if (!rows) throw new Error(`missing table ${table}`)
      const filters: Array<(row: Row) => boolean> = []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return chain
      }
      chain.order = () => chain
      chain.maybeSingle = async () => ({
        data: rows.filter((row) => filters.every((filter) => filter(row)))[0] ?? null,
        error: null,
      })
      chain.range = async (from: number) => ({
        data: from === 0 ? rows.filter((row) => filters.every((filter) => filter(row))) : [],
        error: null,
      })
      return chain
    },
  } as unknown as SupabaseClient
}

const INPUT = { clientId: 'c1', contactId: 'p1', conversationId: 'v1' }

describe('loadMessengerSendGate', () => {
  it('reads only inbound messages; our outbound footer cannot create a stop signal', async () => {
    const result = await loadMessengerSendGate(
      fakeDb({
        contacts: [{ id: 'p1', client_id: 'c1', do_not_contact: false }],
        contact_touchpoints: [],
        conversation_messages: [
          { id: 'm1', conversation_id: 'v1', direction: 'outbound', body: 'do not follow up', sent_at: '2026-08-20T00:00:00Z' },
          { id: 'm2', conversation_id: 'v1', direction: 'inbound', body: 'thanks', sent_at: '2026-08-21T00:00:00Z' },
        ],
      }),
      INPUT,
    )
    expect(result).toEqual({ kind: 'allow' })
  })

  it('fails closed when the contact does not belong to the same client', async () => {
    const result = await loadMessengerSendGate(
      fakeDb({
        contacts: [{ id: 'p1', client_id: 'other', do_not_contact: false }],
        contact_touchpoints: [],
        conversation_messages: [],
      }),
      INPUT,
    )
    expect(result).toEqual({ kind: 'unknown' })
  })
})
