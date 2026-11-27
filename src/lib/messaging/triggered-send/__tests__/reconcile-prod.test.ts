// @vitest-environment node
/**
 * The overdue move is guarded: only a row still pending with the version it was read with is moved, and a moved row
 * is left as it is. Rows are read page by page to the end (the server answers at most 1000 per request, 魏征 P0-1).
 * The stop lines come from the authorization's own rule.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expireOverdue, limitsOf, loadReconcileRows } from '../reconcile-prod'
import { STRICTEST_LIMITS, type ReconcileRow } from '../reconcile'
import type { AuthorizationRecord } from '../authorization-store'

const NOW = new Date('2026-11-27T18:30:00.000Z')
const old = new Date(NOW.getTime() - 22 * 3_600_000).toISOString()
const pending = (id: string): ReconcileRow => ({
  id, clientId: 'c1', triggerKey: 'welcome', dedupeScope: 'lifetime', status: 'pending', reasonCode: null, bounceKind: null,
  firstAttemptAt: old, leaseExpiresAt: null, updatedAt: 'v1',
})

// The fakes below mirror only the query chain reconcile-prod.ts really calls (update→eq→select; select→neq→or→eq→order
// →range), the same way shadow-reads-prod.test.ts fakes its client. 变异验证: with paging removed from loadReconcileRows the
// 2500-row case fails (1000 rows), with the status/version guard removed the compare-and-set case fails.
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
  } as unknown as SupabaseClient // 实测 shape: same chain as reconcile-prod.ts expireOverdue
  return { db, calls }
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

/** A table of `total` rows served like PostgREST: at most 1000 per request, whatever was asked (实测 CTS 2026-07-29). */
function pagedDb(total: number, failAt: number | null = null) {
  const ranges: Array<[number, number]> = []
  const eqs: Array<[string, unknown]> = []
  const db = {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'neq', 'or', 'order']) chain[m] = () => chain
      chain.eq = (col: string, val: unknown) => { eqs.push([col, val]); return chain }
      chain.range = async (from: number, to: number) => {
        ranges.push([from, to])
        if (failAt !== null && from >= failAt) return { data: null, error: { message: 'timeout' } }
        const end = Math.min(total, from + 1000, to + 1)
        const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => ({
          id: `r${from + i}`, client_id: 'c1', trigger_key: 'welcome', dedupe_scope: 'lifetime', status: 'pending',
          reason_code: null, bounce_kind: null, first_attempt_at: old, lease_expires_at: null, updated_at: 'v1',
        }))
        return { data, error: null }
      }
      return chain
    },
  } as unknown as SupabaseClient // 实测 shape: same chain as reconcile-prod.ts loadReconcileRows
  return { db, ranges, eqs }
}

describe('loadReconcileRows', () => {
  it('reads every page: 2500 rows come back as 2500, not 1000', async () => {
    const { db, ranges } = pagedDb(2500)
    const out = await loadReconcileRows(db, NOW)
    expect(out.ok && out.rows.length).toBe(2500)
    expect(ranges.length).toBe(3)
  })

  it('a page that fails = the whole read fails (nothing judged on part of the rows)', async () => {
    const { db } = pagedDb(2500, 1000)
    expect((await loadReconcileRows(db, NOW)).ok).toBe(false)
  })

  it('reads only one client when asked (the receipt-time check)', async () => {
    const { db, eqs } = pagedDb(3)
    await loadReconcileRows(db, NOW, 'c9')
    expect(eqs).toContainEqual(['client_id', 'c9'])
  })
})

describe('limitsOf', () => {
  const record = (rule: unknown): AuthorizationRecord => ({
    id: 'a1', requestId: 'q1', clientId: 'c1', triggerKey: 'welcome', channel: 'email', account: 'cts', rule, ruleSha256: 'x',
    templateVersion: 1, templateSha256: 'y', dailyCap: 30, proposedByEmail: 'p@example.com', proposedAt: old,
    authorizedByEmail: 'p@example.com', authorizedAt: old, liveFrom: old, expiresAt: null, activatedAt: old,
    revokedAt: null, revokedBy: null, revokedReason: null,
  })
  it('an unreadable rule is judged on the strictest allowed stop lines and says so', () => {
    const out = limitsOf(record({ send: { nonsense: true } }))
    expect(out.limits).toEqual(STRICTEST_LIMITS)
    expect(out.error).toContain('rule unreadable')
  })
})
