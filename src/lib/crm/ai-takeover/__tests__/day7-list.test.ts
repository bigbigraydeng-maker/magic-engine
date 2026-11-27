/**
 * The day-7 list end to end on fake tables: the stop line is judged live from the same inputs as the daily run,
 * each due guest gets the mail check and its fixed request id, everyone else is counted (nobody silently missing).
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDay7List, day7RequestId } from '../day7-list'

const NOW = new Date('2026-11-27T22:00:00.000Z')
const D = 24 * 3_600_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const guests = [
  { id: 'old', ai_takeover_since: ago(12 * D), do_not_contact: false, stage: null },
  { id: 'new', ai_takeover_since: ago(8 * D), do_not_contact: false, stage: null },
  { id: 'booked', ai_takeover_since: ago(9 * D), do_not_contact: false, stage: null },
  { id: 'young', ai_takeover_since: ago(3 * D), do_not_contact: false, stage: null },
  { id: 'clicker', ai_takeover_since: ago(9 * D), do_not_contact: false, stage: null },
  { id: 'written', ai_takeover_since: ago(10 * D), do_not_contact: false, stage: null },
]
const catalogueOf = (g: (typeof guests)[number]) => ({
  id: `t-${g.id}`, contact_id: g.id, channel: 'email', direction: 'outbound', occurred_at: g.ai_takeover_since,
  summary: null, raw: null, metadata: { automated: false }, source: 'microsoft_mail',
})
const tables: Record<string, unknown[]> = {
  contacts: guests,
  client_pipeline_stages: [],
  contact_touchpoints: guests.map(catalogueOf),
  crm_bookings: [{ id: 'b1', contact_id: 'booked' }],
}

// The fake answers each table the rows above, once (page 1), whatever the filters: it mirrors the query chain
// stop-line-run.ts / day7-list.ts call (select→eq→not/in→order→range). 变异验证: removing the live stop-line call lists
// 'booked' as due and this test fails.
function fakeDb(): SupabaseClient {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'in', 'order', 'gte']) chain[m] = () => chain
      chain.range = async (from: number) => ({ data: from === 0 ? tables[table] ?? [] : [], error: null })
      return chain
    },
  } as unknown as SupabaseClient // 实测 shape: same chain as the two loaders
}

describe('loadDay7List', () => {
  it('lists only due guests, oldest first, with mail check and fixed request id; counts the rest', async () => {
    const out = await loadDay7List(fakeDb(), 'c1', {
      timeZone: 'Pacific/Auckland',
      loadLastClicks: async () => new Map([['clicker', ago(D)]]),
      loadLastSends: async () => new Map([['written', ago(2 * D)]]),
      loadNames: async (ids) => new Map(ids.map((id) => [id, id.toUpperCase()])),
      compose: async (id) => (id === 'new'
        ? { canCompose: false, reason: 'do_not_contact', message: '别再联系' }
        : { canCompose: true, recipient: `${id}@example.com`, mailbox: 'info', sentToContactLast7Days: 0 }),
    }, NOW)
    expect(out.rows.map((r) => [r.contactId, r.status])).toEqual([['old', 'ready'], ['new', 'cannot_send']])
    expect(out.rows[0]).toMatchObject({ name: 'OLD', day: 12, recipient: 'old@example.com', requestId: day7RequestId('old', guests[0].ai_takeover_since) })
    expect(out.counts).toMatchObject({ due: 2, stopped: 1, not_yet: 1, clicked: 1, already_written: 1 })
  })

  it('a failed click read is no list at all (子牙 P1-3)', async () => {
    await expect(loadDay7List(fakeDb(), 'c1', {
      timeZone: 'Pacific/Auckland',
      loadLastClicks: async () => { throw new Error('clicks: timeout') },
      loadLastSends: async () => new Map(),
      loadNames: async () => new Map(),
      compose: async () => ({ canCompose: false, reason: 'not_found', message: '' }),
    }, NOW)).rejects.toThrow('clicks')
  })
})
