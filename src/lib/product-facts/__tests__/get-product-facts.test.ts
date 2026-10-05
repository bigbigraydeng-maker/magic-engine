import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown }))
vi.mock('@/lib/supabase', () => {
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: state.rows, error: state.error }) }
  return { supabaseAdmin: { from: () => q } }
})
import { getProductFacts } from '../store'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const row = (path: string, observed_at: string, payload: Record<string, unknown>) =>
  ({ canonical_url: `https://s.test/${path}`, observed_at, excerpt: JSON.stringify({ name: path, duration_days: 5, from_price: { amount: 100, currency: 'NZD' }, status: 'ok', ...payload }) })
const now = new Date('2026-10-20T00:00:00Z')

describe('getProductFacts', () => {
  beforeEach(() => { state.rows = []; state.error = null })

  it('refuses a malformed client id', async () => {
    expect(await getProductFacts('nope')).toEqual({ ok: false, reason: 'invalid_client_id' })
  })
  it('says never_measured (not an empty list) when nothing was ever recorded', async () => {
    expect(await getProductFacts(CLIENT, now)).toEqual({ ok: false, reason: 'never_measured' })
  })
  it('says read_failed when the database errors', async () => {
    state.error = { message: 'boom' }
    expect(await getProductFacts(CLIENT, now)).toEqual({ ok: false, reason: 'read_failed' })
  })
  it('keeps ok within 14 days and flags it stale after', async () => {
    state.rows = [row('a', '2026-10-10T00:00:00Z', {})]
    expect((await getProductFacts(CLIENT, now) as { facts: { status: string; verified_at: string }[] }).facts[0]).toMatchObject({ status: 'ok', verified_at: '2026-10-10T00:00:00Z' })
    const later = new Date('2026-10-25T00:00:00Z')
    expect((await getProductFacts(CLIENT, later) as { facts: { status: string }[] }).facts[0].status).toBe('stale')
  })
  it('uses only the latest refresh and never falls back to an older good read when the latest failed', async () => {
    state.rows = [
      row('a', '2026-10-19T00:00:00Z', { status: 'fetch_failed', name: null, from_price: null, duration_days: null, error: 'http_500' }),
      row('a', '2026-10-01T00:00:00Z', {}),
      row('gone', '2026-10-01T00:00:00Z', {}),
    ]
    const res = await getProductFacts(CLIENT, now)
    expect(res.ok && res.facts).toHaveLength(1)
    expect(res.ok && res.facts[0]).toMatchObject({ status: 'fetch_failed', name: null, from_price: null, verified_at: null })
  })
  it('marks a corrupted snapshot not_measured instead of dropping it', async () => {
    state.rows = [{ canonical_url: 'https://s.test/x', observed_at: '2026-10-19T00:00:00Z', excerpt: '{not json' }]
    const res = await getProductFacts(CLIENT, now)
    expect(res.ok && res.facts[0]).toMatchObject({ status: 'not_measured', error: 'unreadable_snapshot' })
  })
})
