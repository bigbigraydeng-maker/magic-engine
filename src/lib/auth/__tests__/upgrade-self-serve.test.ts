/**
 * TDD — Phase X.S3 H1: self_serve → paid upgrade.
 *
 * Verifies the state machine:
 *   - In-place upgrade preserves client_id
 *   - Idempotent on already-paid rows
 *   - Merge path retires the self_serve row only after the paid one commits
 *   - Failure modes return typed reasons (no throws)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
/** Test seam: set deleteShouldFail[<table>] = { message } to make DELETE return that error. */
const deleteShouldFail: Record<string, { message: string } | null> = {}

function builderFor(name: string) {
  const filters: Array<[string, unknown]> = []
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((c: string, v: unknown) => { filters.push([c, v]); return builder })

  function matches(r: Row): boolean { return filters.every(([c, v]) => r[c] === v) }

  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: (tables[name] ?? []).find(matches) ?? null, error: null }))
  ;(builder as { then?: (cb: (v: { data: Row[]; error: unknown }) => unknown) => unknown }).then = (cb) =>
    Promise.resolve({ data: (tables[name] ?? []).filter(matches), error: null }).then(cb)

  builder.update = vi.fn((patch: Row) => {
    const rows = (tables[name] ?? []).filter(matches)
    for (const r of rows) Object.assign(r, patch)
    return { eq: builder.eq, then: (cb: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(cb) }
  })

  builder.upsert = vi.fn((payload: Row, opts?: { onConflict?: string }) => {
    tables[name] ??= []
    const conflictCols = (opts?.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const dupe = (tables[name] ?? []).find(r => conflictCols.every(c => r[c] === payload[c]))
    if (dupe) Object.assign(dupe, payload)
    else tables[name].push({ ...payload, id: payload.id ?? `row-${tables[name].length + 1}` })
    return Promise.resolve({ data: null, error: null })
  })

  builder.delete = vi.fn(() => ({
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      // Test seam: tests can set deleteShouldFail[table] = errObj to simulate
      // a DB failure on the delete-side of merge.
      const failErr = deleteShouldFail[name]
      if (failErr) {
        return Promise.resolve({ data: null, error: failErr })
      }
      tables[name] = (tables[name] ?? []).filter(r => !matches(r))
      return Promise.resolve({ data: null, error: null })
    },
  }))

  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => builderFor(t) },
}))

import { upgradeSelfServeToPaid } from '../upgrade-self-serve'

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  for (const k of Object.keys(deleteShouldFail)) delete deleteShouldFail[k]
})

describe('upgradeSelfServeToPaid — in-place', () => {
  it('flips access_type self_serve → client and preserves client_id', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'alice@example.com', client_id: 'c-1', access_type: 'self_serve', display_name: 'Alice' },
    ]

    const r = await upgradeSelfServeToPaid({ email: 'alice@example.com' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.clientId).toBe('c-1')
    expect(r.merged).toBe(false)
    expect(r.alreadyUpgraded).toBe(false)
    expect(tables.client_portal_users?.[0]?.access_type).toBe('client')
  })

  it('honours toAccessType when set', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'fde@magiclab.com', client_id: 'c-1', access_type: 'self_serve' },
    ]
    await upgradeSelfServeToPaid({ email: 'fde@magiclab.com', toAccessType: 'fde' })
    expect(tables.client_portal_users?.[0]?.access_type).toBe('fde')
  })

  it('is idempotent when already on a paid tier', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'alice@example.com', client_id: 'c-1', access_type: 'client' },
    ]
    const r = await upgradeSelfServeToPaid({ email: 'alice@example.com' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.alreadyUpgraded).toBe(true)
      expect(r.clientId).toBe('c-1')
    }
  })

  it('returns no_self_serve_row when the email is unknown', async () => {
    tables.client_portal_users = []
    const r = await upgradeSelfServeToPaid({ email: 'nobody@example.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_self_serve_row')
  })

  it('lowercases the email before lookup', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'mixedcase@example.com', client_id: 'c-1', access_type: 'self_serve' },
    ]
    const r = await upgradeSelfServeToPaid({ email: '  MIXEDCASE@Example.COM  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.email).toBe('mixedcase@example.com')
  })
})

describe('upgradeSelfServeToPaid — merge into another client', () => {
  it('creates the paid row on target client and removes self_serve row', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'alice@example.com', client_id: 'c-old', access_type: 'self_serve' },
    ]
    tables.clients = [{ id: 'c-new' }]

    const r = await upgradeSelfServeToPaid({
      email: 'alice@example.com',
      mergeIntoClientId: 'c-new',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.merged).toBe(true)
      expect(r.clientId).toBe('c-new')
    }
    const rows = tables.client_portal_users ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.client_id).toBe('c-new')
    expect(rows[0]?.access_type).toBe('client')
  })

  it('rejects when target client does not exist', async () => {
    tables.client_portal_users = [
      { id: 'row-1', email: 'alice@example.com', client_id: 'c-old', access_type: 'self_serve' },
    ]
    tables.clients = []

    const r = await upgradeSelfServeToPaid({
      email: 'alice@example.com',
      mergeIntoClientId: 'nonexistent',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('target_client_missing')
    // self_serve row must still exist on failure.
    expect(tables.client_portal_users?.[0]?.access_type).toBe('self_serve')
  })

  // Phase X.S6 M-3 — cleanup pending when delete of orphan self_serve fails.
  it('returns cleanupPending=true when self_serve delete fails after merge', async () => {
    tables.client_portal_users = [
      { id: 'row-old', email: 'alice@example.com', client_id: 'c-old', access_type: 'self_serve' },
    ]
    tables.clients = [{ id: 'c-new' }]
    deleteShouldFail.client_portal_users = { message: 'connection lost during delete' }

    const r = await upgradeSelfServeToPaid({
      email: 'alice@example.com',
      mergeIntoClientId: 'c-new',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.merged).toBe(true)
    expect(r.cleanupPending).toBe(true)
    expect(r.cleanupRowId).toBe('row-old')
    // Both rows still present — the paid one was upserted, the orphan
    // self_serve survived the failed delete and is what cleanupRowId points to.
    const rows = tables.client_portal_users ?? []
    expect(rows).toHaveLength(2)
  })

  it('cleanupPending is undefined on a normal merge', async () => {
    tables.client_portal_users = [
      { id: 'row-old', email: 'alice@example.com', client_id: 'c-old', access_type: 'self_serve' },
    ]
    tables.clients = [{ id: 'c-new' }]

    const r = await upgradeSelfServeToPaid({
      email: 'alice@example.com',
      mergeIntoClientId: 'c-new',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cleanupPending).toBeUndefined()
    expect(r.cleanupRowId).toBeUndefined()
  })
})
