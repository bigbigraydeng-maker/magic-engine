/**
 * 2026-09-02 rewrite — signup bonus retired (ME 会员分档 v2, free tier = 0 MTC).
 * grantSignupBonus() now only stamps `email_verified_at` for self_serve
 * clients and always returns false. Old dedup/grant/rollback tests removed
 * along with the behavior they covered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface QueueEntry { data: unknown; error: unknown }
type TableMockState = {
  results: QueueEntry[]
  updates: unknown[]
}

const state: Record<string, TableMockState> = {}

function table(name: string): TableMockState {
  state[name] ??= { results: [], updates: [] }
  return state[name]
}

function queue(name: string, data: unknown, error: unknown = null) {
  table(name).results.push({ data, error })
}

function nextResult(name: string): QueueEntry {
  const t = table(name)
  return t.results.shift() ?? { data: null, error: null }
}

function makeBuilder(name: string) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(nextResult(name)))
  builder.update = vi.fn((payload: unknown) => {
    table(name).updates.push(payload)
    return builder
  })
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (name: string) => makeBuilder(name) },
}))

import { grantSignupBonus } from './grant-signup-bonus'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k]
})

describe('grantSignupBonus — retired, no MTC granted', () => {
  it('always returns false for a self_serve client, even when unverified', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: null })
    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
  })

  it('stamps email_verified_at on first verification', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: null })
    await grantSignupBonus(CLIENT_ID)
    expect(table('clients').updates).toHaveLength(1)
    expect(table('clients').updates[0]).toHaveProperty('email_verified_at')
  })

  it('does not re-stamp email_verified_at when already set', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: '2026-01-01T00:00:00Z' })
    await grantSignupBonus(CLIENT_ID)
    expect(table('clients').updates).toHaveLength(0)
  })

  it('refuses non-self_serve clients and does not touch email_verified_at', async () => {
    queue('clients', { source: 'fde', email_verified_at: null })
    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
    expect(table('clients').updates).toHaveLength(0)
  })

  it('returns false when the client row cannot be found', async () => {
    queue('clients', null)
    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
  })
})
