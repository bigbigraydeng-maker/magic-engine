/**
 * Store guards that sit in front of the database: payment before approval, refund before the original,
 * trigger rejections surfaced as conflicts, rules changed without a new version, and paged listing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown; range?: [number, number] }
type Result = { data: unknown; error: { message: string; code?: string } | null }

const h = vi.hoisted(() => ({
  respond: (() => ({ data: null, error: null })) as (op: Op) => Result,
  calls: [] as Op[],
}))

function builder(table: string) {
  const state: Op = { table, op: 'select', filters: {} }
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => { state.filters[k] = v; return b },
    order: () => b,
    limit: () => b,
    range: (from: number, to: number) => { state.range = [from, to]; return b },
    upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; return b },
    insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return b },
    update: (p: unknown) => { state.op = 'update'; state.payload = p; return b },
    single: () => b,
    maybeSingle: () => b,
    then: (resolve: (r: Result) => unknown) => {
      h.calls.push({ ...state, filters: { ...state.filters } })
      return Promise.resolve(resolve(h.respond(state)))
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }))

import { AI_STEWARD_RULES_V1 } from '../config'
import { canonicalJson, DistributorStoreError, listDistributors, recordRefund, recordSale } from '../store'

const APPROVED = { id: 'd1', parent_id: null, display_name: 'A', contact_email: null, contact_phone: null, status: 'approved', approved_by: 'pm', approved_at: '2026-11-05T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }
const SALE_INPUT = { distributorId: 'd1', kind: 'plan' as const, planCode: 'videos-16', months: 1, extraAvatars: 0, isSelfPurchase: false, orderRef: 'INV-1', paidAt: '2026-11-06T00:00:00.000Z', listPriceCents: 79_900, amountCents: 79_900 }

function happy(op: Op): Result {
  if (op.table === 'distributors') return { data: APPROVED, error: null }
  if (op.table === 'distributor_rule_versions') return { data: op.op === 'upsert' ? null : { config: JSON.parse(JSON.stringify(AI_STEWARD_RULES_V1)) }, error: null }
  if (op.table === 'distributor_level_history') return { data: [{ effective_from: '2026-11-05T00:00:00Z' }], error: null }
  if (op.table === 'distributor_sales' && op.op === 'insert') return { data: { id: 's1' }, error: null }
  return { data: null, error: null }
}

beforeEach(() => {
  h.calls = []
  h.respond = happy
})

describe('recordSale', () => {
  it('records a sale paid after approval', async () => {
    await expect(recordSale(SALE_INPUT, 'pm@x')).resolves.toEqual({ id: 's1' })
    expect(h.calls.find((c) => c.table === 'distributor_sales' && c.op === 'insert')?.payload).toMatchObject({ amount_cents: 79_900, recorded_by: 'pm@x', currency: 'NZD' })
  })

  it('refuses a payment dated before the distributor was approved', async () => {
    const early = { ...SALE_INPUT, paidAt: '2026-11-04T00:00:00.000Z' }
    await expect(recordSale(early, 'pm@x')).rejects.toMatchObject({ status: 409 })
    expect(h.calls.some((c) => c.table === 'distributor_sales' && c.op === 'insert')).toBe(false)
  })

  it('refuses when the stored rule config differs from the code under the same version', async () => {
    h.respond = (op) => (op.table === 'distributor_rule_versions' && op.op !== 'upsert'
      ? { data: { config: { ...AI_STEWARD_RULES_V1, peerRateBp: 900 } }, error: null }
      : happy(op))
    await expect(recordSale(SALE_INPUT, 'pm@x')).rejects.toBeInstanceOf(DistributorStoreError)
    expect(h.calls.some((c) => c.table === 'distributor_sales' && c.op === 'insert')).toBe(false)
  })
})

describe('recordRefund', () => {
  const original = { id: 's1', kind: 'plan', distributor_id: 'd1', amount_cents: 79_900, currency: 'NZD', paid_at: '2026-11-06T00:00:00Z' }
  const refund = { refundOfSaleId: 's1', amountCents: 10_000, orderRef: 'RF-1', paidAt: '2026-11-07T00:00:00.000Z' }

  function withOriginal(extra: (op: Op) => Result | null = () => null) {
    h.respond = (op) => {
      const custom = extra(op)
      if (custom) return custom
      if (op.table === 'distributor_sales' && op.op === 'select' && 'id' in op.filters) return { data: original, error: null }
      if (op.table === 'distributor_sales' && op.op === 'select') return { data: [{ amount_cents: -60_000 }], error: null }
      return { data: { id: 'r1' }, error: null }
    }
  }

  it('refuses a refund dated before the original payment', async () => {
    withOriginal()
    await expect(recordRefund({ ...refund, paidAt: '2026-11-05T00:00:00.000Z' }, 'pm@x')).rejects.toMatchObject({ status: 409 })
  })

  it('refuses more than what is left of the sale', async () => {
    withOriginal()
    await expect(recordRefund({ ...refund, amountCents: 20_000 }, 'pm@x')).rejects.toMatchObject({ status: 409 })
    await expect(recordRefund({ ...refund, amountCents: 19_900 }, 'pm@x')).resolves.toEqual({ id: 'r1' })
  })

  it('surfaces a guard-trigger rejection as a conflict, not a database outage', async () => {
    withOriginal((op) => (op.op === 'insert' ? { data: null, error: { message: 'refunds of s1 would exceed the original amount', code: 'P0001' } } : null))
    await expect(recordRefund(refund, 'pm@x')).rejects.toMatchObject({ status: 409 })
  })
})

describe('listing and helpers', () => {
  it('pages through more than 1000 sales', async () => {
    h.respond = (op) => {
      if (op.table !== 'distributor_sales') return { data: op.table === 'distributors' ? [APPROVED] : [], error: null }
      const [from] = op.range ?? [0, 0]
      const size = from === 0 ? 1000 : 5
      return { data: Array.from({ length: size }, () => ({ distributor_id: 'd1', amount_cents: 100 })), error: null }
    }
    const [row] = await listDistributors()
    expect(row.net_sales_cents).toBe(1005 * 100)
  })

  it('compares configs regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }))
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  })
})
