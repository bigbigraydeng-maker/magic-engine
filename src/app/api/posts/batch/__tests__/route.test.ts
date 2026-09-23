import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT_A = 'a0000000-0000-0000-0000-000000000000'
const CLIENT_B = 'b0000000-0000-0000-0000-000000000000'

afterEach(() => vi.clearAllMocks())

describe('batch content Post auth', () => {
  it('rejects a mixed-client batch before update when any owner is forbidden', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {}
    query.select = vi.fn(() => query)
    query.in = vi.fn().mockResolvedValue({
      data: [
        { id: 'post-a', client_id: CLIENT_A },
        { id: 'post-b', client_id: CLIENT_B },
      ],
      error: null,
    })
    query.update = vi.fn(() => query)
    mockFrom.mockReturnValue(query as never)
    mockAccess
      .mockResolvedValueOnce({ ok: true, tier: 'paid_client' } as never)
      .mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' } as never)

    const response = await POST(new NextRequest('http://localhost/api/posts/batch', {
      method: 'POST',
      body: JSON.stringify({ post_ids: ['post-a', 'post-b'], action: 'updateStatus', status: 'approved' }),
    }))
    expect(response.status).toBe(403)
    expect(query.update).not.toHaveBeenCalled()
  })
})

// ── Pre-publish content guard ────────────────────────────────────────────────
// Bulk approval is a machine flipping rows nobody read. A post the guard sent to
// human review must not ride along; single-post approval stays allowed.

interface Builder { [k: string]: unknown }

/** Chainable + awaitable stub; one per supabaseAdmin.from() call, in order. */
function builder(result: unknown): Builder {
  const b: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq', 'update', 'delete']) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onOk, onErr)
  return b
}

const guardReceipt = (over: Record<string, unknown> = {}) => ({
  content_guard: {
    status: 'fail',
    needs_human_review: true,
    target_language: 'en',
    language_findings: [{ kind: 'embedded_fragment', sentence: 'Book the 黄金之旅.', fragment: '黄金之旅' }],
    cliche_probability: 0.2,
    judge_error: null,
    cliche_threshold: 0.8,
    checked_at: '2026-09-23T00:00:00.000Z',
    ...over,
  },
})

function callBatch(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/posts/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

describe('batch approval respects the pre-publish content guard', () => {
  // mockReturnValueOnce queues survive clearAllMocks — a test that returns early
  // would otherwise leave a stub behind and shift the next test's queue by one.
  beforeEach(() => { mockFrom.mockReset(); mockAccess.mockReset() })

  it('approves the clean posts, skips the flagged one and names it', async () => {
    const owners = builder({ data: [{ id: 'clean', client_id: CLIENT_A }, { id: 'flagged', client_id: CLIENT_A }], error: null })
    const guardRead = builder({
      data: [
        { id: 'clean', title: '干净的', generation_context_snapshot: { lesson_no: 1 } },
        { id: 'flagged', title: '中英混杂的', generation_context_snapshot: guardReceipt() },
      ],
      error: null,
    })
    const update = builder({ data: [{ id: 'clean', status: 'approved' }], error: null })
    mockFrom.mockReturnValueOnce(owners as never).mockReturnValueOnce(guardRead as never).mockReturnValueOnce(update as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const response = await callBatch({ post_ids: ['clean', 'flagged'], action: 'updateStatus', status: 'approved' })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.updated).toBe(1)
    expect(json.skipped).toEqual([{ id: 'flagged', title: '中英混杂的', reasons: ['mixed_language'] }])
    // The flagged id never reaches the update.
    expect(update.in).toHaveBeenCalledWith('id', ['clean'])
  })

  it('refuses outright (409, nothing written) when every post in the batch is flagged', async () => {
    const owners = builder({ data: [{ id: 'flagged', client_id: CLIENT_A }], error: null })
    const guardRead = builder({
      data: [{ id: 'flagged', title: '套话开头的', generation_context_snapshot: guardReceipt({ language_findings: [], cliche_probability: 0.95 }) }],
      error: null,
    })
    const update = builder({ data: [], error: null })
    mockFrom.mockReturnValueOnce(owners as never).mockReturnValueOnce(guardRead as never).mockReturnValue(update as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const response = await callBatch({ post_ids: ['flagged'], action: 'updateStatus', status: 'approved' })
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.success).toBe(false)
    expect(json.skipped[0].reasons).toEqual(['cliche_opener'])
    expect(update.update).not.toHaveBeenCalled()
  })

  it('a receipt that cannot be read still blocks — never checked is different from checked and clean', async () => {
    const owners = builder({ data: [{ id: 'weird', client_id: CLIENT_A }, { id: 'old', client_id: CLIENT_A }], error: null })
    const guardRead = builder({
      data: [
        { id: 'weird', title: '回执坏了的', generation_context_snapshot: { content_guard: 'oops' } },
        { id: 'old', title: '老内容没跑过自检', generation_context_snapshot: null },
      ],
      error: null,
    })
    const update = builder({ data: [{ id: 'old', status: 'approved' }], error: null })
    mockFrom.mockReturnValueOnce(owners as never).mockReturnValueOnce(guardRead as never).mockReturnValueOnce(update as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const json = await (await callBatch({ post_ids: ['weird', 'old'], action: 'updateStatus', status: 'approved' })).json()

    expect(json.skipped.map((p: { id: string }) => p.id)).toEqual(['weird'])
    expect(update.in).toHaveBeenCalledWith('id', ['old'])
  })

  it('does not gate non-approval bulk actions — rejecting flagged content in bulk is the point', async () => {
    const owners = builder({ data: [{ id: 'flagged', client_id: CLIENT_A }], error: null })
    const update = builder({ data: [{ id: 'flagged', status: 'rejected' }], error: null })
    mockFrom.mockReturnValueOnce(owners as never).mockReturnValueOnce(update as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const json = await (await callBatch({ post_ids: ['flagged'], action: 'updateStatus', status: 'rejected' })).json()

    expect(json.updated).toBe(1)
    expect(json.skipped).toEqual([])
    expect(update.in).toHaveBeenCalledWith('id', ['flagged'])
  })
})
