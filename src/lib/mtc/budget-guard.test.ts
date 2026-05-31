/**
 * TDD — Phase 21.6 Token Budget Governance + circuit breaker
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock (hoisted before imports) ────────────────────────────────────
//
// Routes .from(table) to a per-table chainable builder. Terminal calls
// (.gte for mtc_ledger, .maybeSingle for clients) resolve to the queued result.

const ledgerResult = { data: [] as Array<{ mtc_amount: number }>, error: null as null | { message: string } }
const clientResult = { data: null as null | { monthly_mtc_cap: number | null }, error: null as null | { message: string } }

function makeLedgerBuilder() {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.gte = vi.fn(() => Promise.resolve(ledgerResult))
  return builder
}

function makeClientBuilder() {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => Promise.resolve(clientResult))
  return builder
}

const fromMock = vi.fn((table: string) =>
  table === 'clients' ? makeClientBuilder() : makeLedgerBuilder(),
)

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  monthStartIso,
  getMonthlySpend,
  getMonthlyCap,
  checkBudget,
} from './budget-guard'
import { DEFAULT_MONTHLY_MTC_CAP } from './types'

beforeEach(() => {
  ledgerResult.data = []
  ledgerResult.error = null
  clientResult.data = null
  clientResult.error = null
  fromMock.mockClear()
})

// ── monthStartIso ─────────────────────────────────────────────────────────────

describe('monthStartIso', () => {
  it('returns first instant of the month in UTC', () => {
    const iso = monthStartIso(new Date('2026-05-31T13:46:00Z'))
    expect(iso).toBe('2026-05-01T00:00:00.000Z')
  })

  it('handles January boundary', () => {
    const iso = monthStartIso(new Date('2026-01-15T08:00:00Z'))
    expect(iso).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ── getMonthlySpend ───────────────────────────────────────────────────────────

describe('getMonthlySpend', () => {
  it('sums this month debit amounts', async () => {
    ledgerResult.data = [{ mtc_amount: 40 }, { mtc_amount: 60 }, { mtc_amount: 5 }]
    expect(await getMonthlySpend('client-1')).toBe(105)
  })

  it('returns 0 when no debits this month', async () => {
    ledgerResult.data = []
    expect(await getMonthlySpend('client-1')).toBe(0)
  })

  it('throws on db error', async () => {
    ledgerResult.error = { message: 'boom' }
    await expect(getMonthlySpend('client-1')).rejects.toThrow(/monthly spend lookup failed/i)
  })
})

// ── getMonthlyCap ─────────────────────────────────────────────────────────────

describe('getMonthlyCap', () => {
  it('uses per-client override when set', async () => {
    clientResult.data = { monthly_mtc_cap: 8000 }
    expect(await getMonthlyCap('client-1')).toEqual({ cap: 8000, capIsCustom: true })
  })

  it('falls back to global default when override is null', async () => {
    clientResult.data = { monthly_mtc_cap: null }
    expect(await getMonthlyCap('client-1')).toEqual({
      cap: DEFAULT_MONTHLY_MTC_CAP,
      capIsCustom: false,
    })
  })

  it('falls back to default when row missing', async () => {
    clientResult.data = null
    expect(await getMonthlyCap('client-1')).toEqual({
      cap: DEFAULT_MONTHLY_MTC_CAP,
      capIsCustom: false,
    })
  })

  it('degrades to default when column not migrated (read error)', async () => {
    clientResult.error = { message: 'column "monthly_mtc_cap" does not exist' }
    expect(await getMonthlyCap('client-1')).toEqual({
      cap: DEFAULT_MONTHLY_MTC_CAP,
      capIsCustom: false,
    })
  })

  it('ignores a non-positive override and uses default', async () => {
    clientResult.data = { monthly_mtc_cap: 0 }
    expect(await getMonthlyCap('client-1')).toEqual({
      cap: DEFAULT_MONTHLY_MTC_CAP,
      capIsCustom: false,
    })
  })
})

// ── checkBudget (the circuit breaker) ─────────────────────────────────────────

describe('checkBudget', () => {
  it('allows when spend + projected is under cap', async () => {
    ledgerResult.data = [{ mtc_amount: 1000 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1', 500)
    expect(status).toEqual({
      allowed: true,
      spent: 1000,
      cap: 5000,
      remaining: 4000,
      capIsCustom: true,
    })
  })

  it('trips (allowed=false) when projected would exceed cap', async () => {
    ledgerResult.data = [{ mtc_amount: 4800 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1', 300)
    expect(status.allowed).toBe(false)
    expect(status.remaining).toBe(200)
  })

  it('trips when already exactly at cap', async () => {
    ledgerResult.data = [{ mtc_amount: 5000 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1', 1)
    expect(status.allowed).toBe(false)
    expect(status.remaining).toBe(0)
  })

  it('allows exactly hitting the cap (projected fills remaining)', async () => {
    ledgerResult.data = [{ mtc_amount: 4500 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1', 500)
    expect(status.allowed).toBe(true)
    expect(status.remaining).toBe(500)
  })

  it('clamps remaining to 0 when already over cap', async () => {
    ledgerResult.data = [{ mtc_amount: 5200 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1')
    expect(status.allowed).toBe(false)
    expect(status.remaining).toBe(0)
  })

  it('uses global default cap when client has no override', async () => {
    ledgerResult.data = [{ mtc_amount: 100 }]
    clientResult.data = { monthly_mtc_cap: null }
    const status = await checkBudget('client-1', 0)
    expect(status.cap).toBe(DEFAULT_MONTHLY_MTC_CAP)
    expect(status.capIsCustom).toBe(false)
    expect(status.allowed).toBe(true)
  })

  it('pure status read (projected=0) reports current headroom', async () => {
    ledgerResult.data = [{ mtc_amount: 2000 }]
    clientResult.data = { monthly_mtc_cap: 5000 }
    const status = await checkBudget('client-1')
    expect(status.allowed).toBe(true)
    expect(status.spent).toBe(2000)
    expect(status.remaining).toBe(3000)
  })
})
