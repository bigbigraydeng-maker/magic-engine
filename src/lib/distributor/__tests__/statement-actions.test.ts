/**
 * actOnStatement guards: forward-only status, approver needed for approve / paid / voiding an approved
 * statement, only the latest live statement may be voided, and a concurrent change is a conflict.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }
type Result = { data: unknown; error: { message: string; code?: string } | null }

const h = vi.hoisted(() => ({
  respond: (() => ({ data: null, error: null })) as (op: Op) => Result,
  calls: [] as Op[],
}))

function builder(table: string) {
  const state: Op = { table, op: 'select', filters: {} }
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => { state.filters[`eq:${k}`] = v; return b },
    gt: (k: string, v: unknown) => { state.filters[`gt:${k}`] = v; return b },
    neq: (k: string, v: unknown) => { state.filters[`neq:${k}`] = v; return b },
    limit: () => b,
    update: (p: unknown) => { state.op = 'update'; state.payload = p; return b },
    maybeSingle: () => b,
    then: (resolve: (r: Result) => unknown) => {
      h.calls.push({ ...state, filters: { ...state.filters } })
      return Promise.resolve(resolve(h.respond(state)))
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }))

import { actOnStatement } from '../settlement-store'

const ID = 'st-1'
function world(status: string, opts: { later?: boolean; raced?: boolean } = {}) {
  h.respond = (op) => {
    if (op.op === 'update') return { data: opts.raced ? null : { id: ID, period_month: '2026-10-01', status: 'next' }, error: null }
    if ('gt:period_month' in op.filters) return { data: opts.later ? [{ id: 'st-2' }] : [], error: null }
    return { data: { id: ID, period_month: '2026-10-01', status }, error: null }
  }
}
const updates = () => h.calls.filter((c) => c.op === 'update')

beforeEach(() => { h.calls = [] })

describe('actOnStatement', () => {
  it('only the payout approver may approve or mark paid', async () => {
    world('computed')
    await expect(actOnStatement(ID, 'approve', 'admin@x', { actorIsPayoutApprover: false })).rejects.toMatchObject({ status: 403 })
    world('approved')
    await expect(actOnStatement(ID, 'mark_paid', 'admin@x', { actorIsPayoutApprover: false })).rejects.toMatchObject({ status: 403 })
    expect(updates()).toHaveLength(0)
    world('computed')
    await actOnStatement(ID, 'approve', 'payer@x', { actorIsPayoutApprover: true })
    expect(updates()[0].payload).toMatchObject({ status: 'approved', approved_by: 'payer@x' })
    expect(updates()[0].filters).toMatchObject({ 'eq:status': 'computed' })
  })

  it('any admin may void a computed statement, but voiding an approved one needs the approver', async () => {
    world('computed')
    await actOnStatement(ID, 'void', 'admin@x', { actorIsPayoutApprover: false })
    expect(updates()).toHaveLength(1)
    world('approved')
    await expect(actOnStatement(ID, 'void', 'admin@x', { actorIsPayoutApprover: false })).rejects.toMatchObject({ status: 403 })
    expect(updates()).toHaveLength(1)
  })

  it('refuses backwards steps, voiding when a later live statement exists, and lost races', async () => {
    world('paid')
    await expect(actOnStatement(ID, 'void', 'payer@x', { actorIsPayoutApprover: true })).rejects.toMatchObject({ status: 409 })
    world('computed', { later: true })
    await expect(actOnStatement(ID, 'void', 'payer@x', { actorIsPayoutApprover: true })).rejects.toMatchObject({ status: 409 })
    world('computed', { raced: true })
    await expect(actOnStatement(ID, 'approve', 'payer@x', { actorIsPayoutApprover: true })).rejects.toMatchObject({ status: 409 })
  })
})
