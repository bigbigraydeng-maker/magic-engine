// @vitest-environment node
/**
 * The overdue move is guarded: only a row still pending with the version it was read with is moved, and a moved row
 * is left as it is. The breaker never runs on a full read.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expireOverdue, loadReconcileRows } from '../reconcile-prod'
import type { ReconcileRow } from '../reconcile'

const NOW = new Date('2026-11-27T18:30:00.000Z')
const old = new Date(NOW.getTime() - 21 * 3_600_000).toISOString()
const pending = (id: string): ReconcileRow => ({
  id, clientId: 'c1', dedupeScope: 'lifetime', status: 'pending', reasonCode: null, bounceKind: null,
  firstAttemptAt: old, leaseExpiresAt: null, updatedAt: 'v1',
})

function fakeUpdate(answer: (id: string) => { data: unknown[] | null; error: { code: string } | null }) {
  const calls: Array<{ patch: unknown; eqs: Array<[string, unknown]> }> = []
  const db = {
    from: () => ({
      update: (patch: unknown) => {
        const call = { patch, eqs: [] as Array<[string, unknown]> }
        calls.push(call)
        const chain = {
          eq: (col: string, val: unknown) => { call.eqs.push([col, val]); return chain },
          select: async () => answer(String(call.eqs.find(([c]) => c === 'id')?.[1])),
        }
        return chain
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, calls }
}

describe('expireOverdue', () => {
  it('moves with compare-and-set and leaves a row that moved first', async () => {
    const { db, calls } = fakeUpdate((id) => ({ data: id === 'a' ? [{ id }] : [], error: null }))
    const out = await expireOverdue(db, [pending('a'), pending('b')], NOW)
    expect(out).toEqual({ expired: ['a'], moved: ['b'], errors: [] })
    expect(calls[0].patch).toEqual({ status: 'unknown_outcome', provider_impact: 'PROVIDER_UNKNOWN', reason_code: 'expired_20h' })
    expect(calls[0].eqs).toEqual([['id', 'a'], ['status', 'pending'], ['updated_at', 'v1']])
  })
})

describe('loadReconcileRows', () => {
  it('a full read is an error, never judged on part of the rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}` }))
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'neq', 'or', 'order']) chain[m] = vi.fn(() => chain)
    chain.limit = vi.fn(async () => ({ data: rows, error: null }))
    const db = { from: () => chain } as unknown as SupabaseClient
    const out = await loadReconcileRows(db, NOW)
    expect(out.ok).toBe(false)
  })
})
