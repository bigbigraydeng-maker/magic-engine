/**
 * TDD — Phase X.S6 M-1: deductMtc atomic RPC path + legacy fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()

// Supabase mock — RPC handles the primary path; .from() handles legacy fallback.
// The legacy path is only exercised when rpcMock returns an error.
const ledgerInserts: unknown[] = []

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'mtc_ledger') {
        return {
          insert: (row: unknown) => {
            ledgerInserts.push(row)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'led-legacy' }, error: null }),
              }),
            }
          },
        }
      }
      if (table === 'mtc_purchases') {
        return {
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }
      return {}
    }),
  },
}))

vi.mock('./balance', () => ({
  getMtcBalance: vi.fn(),
}))

import { deductMtc } from './deduct'
import { getMtcBalance } from './balance'

const balanceMock = vi.mocked(getMtcBalance)

beforeEach(() => {
  vi.clearAllMocks()
  ledgerInserts.length = 0
})

describe('deductMtc — atomic RPC happy path', () => {
  it('calls mtc_deduct_atomic and returns the ledger id', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ ok: true, ledger_entry_id: 'led-rpc-1', balance_remaining: 460 }],
      error: null,
    })
    const result = await deductMtc('c1', 'image_single', 40, { referenceId: 'p1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ledgerEntryId).toBe('led-rpc-1')
    expect(rpcMock).toHaveBeenCalledWith('mtc_deduct_atomic', expect.objectContaining({
      p_client_id:    'c1',
      p_service_key:  'image_single',
      p_mtc_amount:   40,
      p_reference_id: 'p1',
    }))
    // Legacy ledger insert must NOT have run.
    expect(ledgerInserts).toHaveLength(0)
  })

  it('returns insufficient_balance with current balance when RPC says so', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ ok: false, ledger_entry_id: null, balance_remaining: 5 }],
      error: null,
    })
    const result = await deductMtc('c1', 'blog_seo', 40)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('insufficient_balance')
    expect(result.balance).toBe(5)
  })

  it('accepts a single-object RPC response (not array)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: true, ledger_entry_id: 'led-1', balance_remaining: 100 },
      error: null,
    })
    const result = await deductMtc('c1', 'image_single', 10)
    expect(result.ok).toBe(true)
  })

  it('treats malformed RPC row as db_error (defensive)', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deductMtc('c1', 'image_single', 10)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('db_error')
    spy.mockRestore()
  })
})

describe('deductMtc — legacy fallback', () => {
  it('falls back to non-atomic path when RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'function does not exist', code: '42883' },
    })
    balanceMock.mockResolvedValueOnce({
      balance: 100,
      batches: [{ purchaseId: 'b1', remaining: 100, expiresAt: '2030-01-01' }],
    })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await deductMtc('c1', 'image_single', 40)
    expect(result.ok).toBe(true)
    expect(ledgerInserts).toHaveLength(1)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('legacy path returns insufficient_balance when batches are empty', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'transient', code: '57P03' },
    })
    balanceMock.mockResolvedValueOnce({ balance: 5, batches: [] })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await deductMtc('c1', 'image_single', 40)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('insufficient_balance')
    expect(result.balance).toBe(5)
    spy.mockRestore()
  })
})
