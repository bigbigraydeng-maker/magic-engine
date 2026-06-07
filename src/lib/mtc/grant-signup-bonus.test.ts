/**
 * TDD — Phase X.S3 H2: signup bonus must dedup at the canonical-email level
 * so that Gmail aliases (a+1, a.b, googlemail) can't grab the bonus twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Per-table builder mock for supabaseAdmin.from() ──────────────────────────
//
// Each table gets its own builder with the chainable methods the function uses
// and a terminal queued-result list. Insert builders also expose what was
// passed in so assertions can read it.

interface QueueEntry { data: unknown; error: unknown }
type TableMockState = {
  // Result for terminal calls (.single, .limit, .insert .select, .delete .eq etc)
  results: QueueEntry[]
  // Captured inserts so the test can check what was written.
  inserts: unknown[]
  updates: unknown[]
  deletes: number
}

const state: Record<string, TableMockState> = {}

function table(name: string): TableMockState {
  state[name] ??= { results: [], inserts: [], updates: [], deletes: 0 }
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
  // Chainable no-ops that always return the builder
  for (const method of ['select', 'eq', 'gt', 'gte', 'order', 'limit', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(nextResult(name)))
  // `await query` resolves with the next result for terminal SELECTs without .single
  ;(builder as { then?: (cb: (v: QueueEntry) => unknown) => unknown }).then = (cb) =>
    Promise.resolve(nextResult(name)).then(cb)

  builder.insert = vi.fn((payload: unknown) => {
    table(name).inserts.push(payload)
    return builder
  })
  builder.update = vi.fn((payload: unknown) => {
    table(name).updates.push(payload)
    return builder
  })
  builder.delete = vi.fn(() => {
    table(name).deletes += 1
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

describe('grantSignupBonus — happy path', () => {
  it('grants 500 MTC on first call and records canonical email', async () => {
    // clients.select.eq.single → self_serve, not verified
    queue('clients', { source: 'self_serve', email_verified_at: null })
    // client_portal_users.select.eq.eq.limit → user email
    queue('client_portal_users', [{ email: 'A.B+promo@Gmail.com' }])
    // signup_bonus_grants.insert.select → wins the race
    queue('signup_bonus_grants', [{ client_id: CLIENT_ID }])
    // clients.update → stamps email_verified_at
    queue('clients', null)
    // mtc_purchases.insert.select.single → ok
    queue('mtc_purchases', { id: 'purch-1' })
    // signup_bonus_grants.update purchase_id → ok
    queue('signup_bonus_grants', null)
    // mtc_ledger.insert → ok
    queue('mtc_ledger', null)

    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(true)

    // The bonus_grants insert was keyed by the canonical Gmail form.
    const grantInsert = table('signup_bonus_grants').inserts[0] as { email_canonical: string; email_lower: string }
    expect(grantInsert.email_canonical).toBe('ab@gmail.com')
    expect(grantInsert.email_lower).toBe('a.b+promo@gmail.com')
  })
})

describe('grantSignupBonus — dedup', () => {
  it('returns false when the email is already claimed (23505)', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: null })
    queue('client_portal_users', [{ email: 'alice@gmail.com' }])
    // signup_bonus_grants insert returns unique_violation
    queue('signup_bonus_grants', null, { code: '23505', message: 'duplicate key value' })

    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
    // No purchase or ledger write should have happened.
    expect(table('mtc_purchases').inserts).toHaveLength(0)
    expect(table('mtc_ledger').inserts).toHaveLength(0)
  })

  it('rejects a second sign-up using a Gmail alias of an already-bonused email', async () => {
    // First grant: alice@gmail.com claims the canonical key.
    queue('clients', { source: 'self_serve', email_verified_at: null })
    queue('client_portal_users', [{ email: 'alice@gmail.com' }])
    queue('signup_bonus_grants', [{ client_id: 'first-client' }])
    queue('clients', null)
    queue('mtc_purchases', { id: 'purch-1' })
    queue('signup_bonus_grants', null)
    queue('mtc_ledger', null)
    expect(await grantSignupBonus('first-client')).toBe(true)

    // Second grant attempt with a Gmail alias — must NOT credit again.
    queue('clients', { source: 'self_serve', email_verified_at: null })
    queue('client_portal_users', [{ email: 'a.l.i.c.e+promo@googlemail.com' }])
    queue('signup_bonus_grants', null, { code: '23505' })

    const second = await grantSignupBonus(CLIENT_ID)
    expect(second).toBe(false)
    // Only one purchase across both attempts.
    expect(table('mtc_purchases').inserts).toHaveLength(1)
  })
})

describe('grantSignupBonus — safety guards', () => {
  it('refuses non-self_serve clients', async () => {
    queue('clients', { source: 'fde', email_verified_at: null })
    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
    expect(table('signup_bonus_grants').inserts).toHaveLength(0)
  })

  it('refuses when no portal email can be found', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: null })
    queue('client_portal_users', [])  // empty
    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
    expect(table('signup_bonus_grants').inserts).toHaveLength(0)
  })

  it('rolls back the grant claim when mtc_purchases insert fails', async () => {
    queue('clients', { source: 'self_serve', email_verified_at: null })
    queue('client_portal_users', [{ email: 'bob@example.com' }])
    queue('signup_bonus_grants', [{ client_id: CLIENT_ID }])
    queue('clients', null)
    // purchases insert errors
    queue('mtc_purchases', null, { message: 'db down' })

    const result = await grantSignupBonus(CLIENT_ID)
    expect(result).toBe(false)
    // The rollback DELETE must have run.
    expect(table('signup_bonus_grants').deletes).toBe(1)
  })
})
