/**
 * Tests for MTC wiring on POST /api/visual/image.
 *
 * Verifies:
 *   - Auth check still runs.
 *   - chargeForGeneration is called with 'image_single' before generation.
 *   - When balance is insufficient, returns 402 without calling generateImage.
 *   - When generation throws, refundOnFail is invoked.
 *   - When the upload throws, refundOnFail is still invoked (post-charge fail path).
 *   - On success, no refund is issued.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/visual/openai-images', () => ({
  generateImage: vi.fn(),
}))

vi.mock('@/lib/visual/storage', () => ({
  uploadFromBase64: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/mtc/charge', () => ({
  chargeForGeneration: vi.fn(),
  refundOnFail: vi.fn(),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { chargeForGeneration, refundOnFail } from '@/lib/mtc/charge'

const mockFrom        = vi.mocked(supabaseAdmin.from)
const mockGenImage    = vi.mocked(generateImage)
const mockUpload      = vi.mocked(uploadFromBase64)
const mockAccess      = vi.mocked(requireDashboardClientAccess)
const mockCharge      = vi.mocked(chargeForGeneration)
const mockRefund      = vi.mocked(refundOnFail)

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://test/api/visual/image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAccess.mockResolvedValue({ ok: true, user: { email: 't@t' } as never, role: 'admin', tier: 'admin', allowedClientId: null })

  // Default supabase chain — content_posts.select.eq.single
  const postChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { visual_brief: 'brand hero image, sunset', revision_notes: null },
      error: null,
    }),
  }
  // visual_assets insert chain
  const assetChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'asset-1' },
      error: null,
    }),
  }
  mockFrom.mockImplementation((table: string) =>
    table === 'content_posts' ? postChain as never : assetChain as never,
  )

  mockGenImage.mockResolvedValue({ b64: 'AAA' } as never)
  mockUpload.mockResolvedValue({ storage_url: 'https://s.example/img.png', file_size_kb: 200 } as never)
  mockCharge.mockResolvedValue({ ok: true, ledgerEntryId: 'led-1', mtcAmount: 10 } as never)
  mockRefund.mockResolvedValue(undefined)
})

describe('POST /api/visual/image — MTC charge wiring', () => {
  it('deducts MTC then generates on happy path; no refund', async () => {
    const res = await POST(makePostRequest({ post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(200)
    expect(mockCharge).toHaveBeenCalledWith('c1', 'image_single', expect.objectContaining({
      referenceId: 'p1',
    }))
    expect(mockGenImage).toHaveBeenCalled()
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('returns 402 when balance insufficient — does NOT call generateImage', async () => {
    mockCharge.mockResolvedValueOnce({
      ok: false,
      reason: 'insufficient_balance',
      status: 402,
      body: {
        success: false,
        error: '余额不足',
        reason: 'insufficient_balance',
        balance: 0,
        required: 10,
      },
    } as never)

    const res = await POST(makePostRequest({ post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.reason).toBe('insufficient_balance')
    expect(mockGenImage).not.toHaveBeenCalled()
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('refunds when generateImage throws', async () => {
    mockGenImage.mockRejectedValueOnce(new Error('openai timeout'))
    const res = await POST(makePostRequest({ post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(500)
    expect(mockRefund).toHaveBeenCalledWith('c1', 'image_single', 10, expect.objectContaining({
      referenceId: 'p1',
      reason: expect.stringContaining('openai timeout'),
    }))
  })

  it('refunds when storage upload throws (post-charge failure)', async () => {
    mockUpload.mockRejectedValueOnce(new Error('s3 503'))
    const res = await POST(makePostRequest({ post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(500)
    expect(mockRefund).toHaveBeenCalledWith('c1', 'image_single', 10, expect.objectContaining({
      reason: expect.stringContaining('s3 503'),
    }))
  })

  it('still rejects unauthorized callers (auth runs before charge)', async () => {
    mockAccess.mockResolvedValueOnce({ ok: false, status: 403, error: 'No access' })
    const res = await POST(makePostRequest({ post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(403)
    expect(mockCharge).not.toHaveBeenCalled()
    expect(mockGenImage).not.toHaveBeenCalled()
  })
})
