/**
 * 第 7 天跟进信：谁今天该收。PM 11-27「继续做第二件，第 7 天跟进信」；设计 2026-11-14 重排 v1 §2。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { day7Status } from '../day7'
import { loadDay7List } from '../day7-list'
import type { CameBackRow } from '../came-back'

const NOW = new Date('2026-11-27T22:00:00.000Z')
const D = 24 * 3_600_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const SINCE = ago(10 * D)
const catalogue: CameBackRow = { channel: 'email', direction: 'outbound', occurred_at: ago(10 * D - 60_000), raw: null, metadata: { automated: false }, source: 'microsoft_mail' }
const v = (touches: CameBackRow[], lastClickAt: string | null = null, since = SINCE) => day7Status({ since, touches, lastClickAt }, NOW)

describe('day7Status', () => {
  it('due on day 7..29 when nothing happened since the catalogue', () => {
    expect(v([catalogue])).toEqual({ status: 'due', day: 10 })
    expect(v([catalogue], null, ago(7 * D)).status).toBe('due')
  })

  it('not yet before day 7, and no longer from day 30', () => {
    const sentAt = (since: string): CameBackRow => ({ ...catalogue, occurred_at: since })
    expect(v([sentAt(ago(6 * D))], null, ago(6 * D)).status).toBe('not_yet')
    expect(v([sentAt(ago(30 * D))], null, ago(30 * D)).status).toBe('past_30')
  })

  it('a guest who opened what we sent belongs to staff (today list), not to this letter', () => {
    expect(v([catalogue], ago(2 * D)).status).toBe('clicked')
    expect(v([catalogue], ago(11 * D)).status).toBe('due') // a click before the catalogue does not count
  })

  it('a guest who came back belongs to staff', () => {
    const reply: CameBackRow = { channel: 'email', direction: 'inbound', occurred_at: ago(3 * D), raw: 'Hi, still have May?', metadata: null, source: 'microsoft_mail' }
    expect(v([catalogue, reply]).status).toBe('came_back')
  })

  it('one follow-up only: anyone writing after the catalogue takes the guest off; automated mail does not', () => {
    const staff: CameBackRow = { ...catalogue, occurred_at: ago(2 * D) }
    const bulk: CameBackRow = { ...catalogue, occurred_at: ago(2 * D), source: 'mailchimp', metadata: {} }
    expect(v([catalogue, staff]).status).toBe('already_written')
    expect(v([catalogue, bulk]).status).toBe('due')
  })
})

describe('loadDay7List', () => {
  // Fake mirrors the query chain day7-list.ts really calls (from→select→eq→in→order→order→range); 实测 shape like
  // ai-takeover tests' fakes. 变异验证: dropping the mail check leaves status 'cannot_send' for everyone → test fails.
  function db(rows: Array<CameBackRow & { contact_id: string }>) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
    chain.range = async (from: number) => ({ data: from === 0 ? rows : [], error: null })
    return { from: () => chain } as unknown as SupabaseClient
  }

  it('lists only due guests, oldest first, each with its mail check, and counts the rest', async () => {
    const since = new Map([['old', ago(12 * D)], ['new', ago(8 * D)], ['young', ago(3 * D)], ['clicker', ago(9 * D)]])
    const touches = [...since.keys()].map((id) => ({ ...catalogue, contact_id: id, occurred_at: since.get(id) ?? '' }))
    const out = await loadDay7List(db(touches), 'c1', {
      loadTakeoverSince: async () => since,
      loadLastClicks: async () => new Map([['clicker', ago(D)]]),
      loadNames: async (ids) => new Map(ids.map((id) => [id, id.toUpperCase()])),
      compose: async (id) => (id === 'new' ? { canCompose: false, reason: 'do_not_contact', message: '别再联系' } : { canCompose: true, recipient: `${id}@example.com`, mailbox: 'info', sentToContactLast7Days: 0 }),
    }, NOW)
    expect(out.rows.map((r) => [r.contactId, r.status])).toEqual([['old', 'ready'], ['new', 'cannot_send']])
    expect(out.rows[0]).toMatchObject({ name: 'OLD', day: 12, recipient: 'old@example.com' })
    expect(out.counts).toMatchObject({ due: 2, not_yet: 1, clicked: 1 })
  })
})
