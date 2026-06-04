/**
 * TDD — Unified MTC charge helper
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock dependencies (hoisted) ───────────────────────────────────────────────

const balanceMock = vi.fn()
const deductMock = vi.fn()
const refundMock = vi.fn()
const budgetMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('./balance', () => ({ getMtcBalance: (...a: unknown[]) => balanceMock(...a) }))
vi.mock('./deduct', () => ({ deductMtc: (...a: unknown[]) => deductMock(...a) }))
vi.mock('./refund', () => ({ refundMtc: (...a: unknown[]) => refundMock(...a) }))
vi.mock('./budget-guard', () => ({ checkBudget: (...a: unknown[]) => budgetMock(...a) }))

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  chargeForGeneration,
  refundOnFail,
  precheckCharge,
  commitCharge,
} from './charge'

const ALLOW_BUDGET = { allowed: true, spent: 100, cap: 5000, remaining: 4900, capIsCustom: false }
const BLOCK_BUDGET = { allowed: false, spent: 4990, cap: 5000, remaining: 10, capIsCustom: false }

beforeEach(() => {
  vi.clearAllMocks()
  budgetMock.mockResolvedValue(ALLOW_BUDGET)
  balanceMock.mockResolvedValue({ balance: 1000, batches: [] })
  deductMock.mockResolvedValue({ ok: true, ledgerEntryId: 'led-1' })
  refundMock.mockResolvedValue({ ok: true, ledgerEntryId: 'led-r' })
})

describe('chargeForGeneration', () => {
  it('deducts unit price × units and returns ledger id', async () => {
    const result = await chargeForGeneration('c1', 'image_single', { units: 4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mtcAmount).toBe(40) // image_single = 10 × 4
    expect(deductMock).toHaveBeenCalledWith('c1', 'image_single', 40, expect.any(Object))
  })

  it('returns 402 with required + balance when balance insufficient', async () => {
    balanceMock.mockResolvedValueOnce({ balance: 5, batches: [] })
    const result = await chargeForGeneration('c1', 'blog_seo')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(402)
    expect(result.body.reason).toBe('insufficient_balance')
    expect(result.body.balance).toBe(5)
    expect(result.body.required).toBe(40)
    expect(deductMock).not.toHaveBeenCalled()
  })

  it('returns 429 when monthly cap reached', async () => {
    budgetMock.mockResolvedValueOnce(BLOCK_BUDGET)
    const result = await chargeForGeneration('c1', 'blog_dual_signal')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(429)
    expect(result.body.reason).toBe('monthly_cap_reached')
    expect(result.body.budget?.cap).toBe(5000)
    expect(deductMock).not.toHaveBeenCalled()
    expect(balanceMock).not.toHaveBeenCalled()
  })

  it('returns 500 when deduct fails with db_error', async () => {
    deductMock.mockResolvedValueOnce({ ok: false, reason: 'db_error' })
    const result = await chargeForGeneration('c1', 'image_single')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.body.reason).toBe('db_error')
  })

  it('clamps units to floor of 1', async () => {
    const result = await chargeForGeneration('c1', 'image_single', { units: 0 })
    expect(result.ok).toBe(true)
    expect(deductMock).toHaveBeenCalledWith('c1', 'image_single', 10, expect.any(Object))
  })

  it('passes referenceId and notes through to deduct', async () => {
    await chargeForGeneration('c1', 'image_single', {
      referenceId: 'post-99',
      notes: 'test',
    })
    expect(deductMock).toHaveBeenCalledWith(
      'c1',
      'image_single',
      10,
      expect.objectContaining({
        referenceId: 'post-99',
        notes: 'test',
        source: 'auto',
      }),
    )
  })
})

describe('refundOnFail', () => {
  it('writes refund ledger when work fails', async () => {
    await refundOnFail('c1', 'blog_seo', 40, { referenceId: 'post-7', reason: 'LLM timeout' })
    expect(refundMock).toHaveBeenCalledWith(
      'c1',
      'blog_seo',
      40,
      expect.objectContaining({
        referenceId: 'post-7',
        notes: expect.stringContaining('LLM timeout'),
      }),
    )
  })

  it('does not throw when refund fails — caller already handling main failure', async () => {
    refundMock.mockRejectedValueOnce(new Error('db down'))
    await expect(refundOnFail('c1', 'blog_seo', 40)).resolves.toBeUndefined()
  })

  it('logs when refund returns ok=false instead of throwing', async () => {
    refundMock.mockResolvedValueOnce({ ok: false })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await refundOnFail('c1', 'blog_seo', 40)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('precheckCharge', () => {
  it('returns projected MTC when balance + budget allow', async () => {
    const result = await precheckCharge('c1', 'reels_720p_15s')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projectedMtc).toBe(80)
    expect(deductMock).not.toHaveBeenCalled() // precheck does NOT deduct
  })

  it('returns 402 when balance too low', async () => {
    balanceMock.mockResolvedValueOnce({ balance: 10, batches: [] })
    const result = await precheckCharge('c1', 'blog_dual_signal')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(402)
  })
})

describe('commitCharge', () => {
  it('deducts exact projected amount when worker reports success', async () => {
    const result = await commitCharge('c1', 'blog_seo', 40, { referenceId: 'post-1' })
    expect(result.ok).toBe(true)
    expect(deductMock).toHaveBeenCalledWith('c1', 'blog_seo', 40, expect.objectContaining({
      referenceId: 'post-1',
      source: 'auto',
    }))
  })

  it('returns ok=false but does not throw if deduct fails — never block successful work', async () => {
    deductMock.mockResolvedValueOnce({ ok: false, reason: 'db_error' })
    const result = await commitCharge('c1', 'blog_seo', 40)
    expect(result.ok).toBe(false)
  })

  it('catches thrown errors from deduct silently', async () => {
    deductMock.mockRejectedValueOnce(new Error('connection lost'))
    const result = await commitCharge('c1', 'blog_seo', 40)
    expect(result.ok).toBe(false)
  })
})
