/**
 * Tests for PATCH /api/clients/[id]/strategy/[itemId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db/strategy-items', () => ({
  updateStrategyStatus: vi.fn(),
}))

import { PATCH } from './route'
import { updateStrategyStatus } from '@/lib/db/strategy-items'

const params = { id: 'client-1', itemId: 'item-1' }

function buildReq(body: unknown) {
  return new NextRequest('http://localhost/api/clients/x/strategy/y', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/clients/[id]/strategy/[itemId]', () => {
  it('updates status', async () => {
    vi.mocked(updateStrategyStatus).mockResolvedValue({
      id: 'item-1',
      status: 'approved',
    } as any)
    const res = await PATCH(buildReq({ status: 'approved' }), { params })
    expect(res.status).toBe(200)
    expect(updateStrategyStatus).toHaveBeenCalledWith('item-1', {
      status: 'approved',
      linked_blog_post_id: undefined,
    })
  })

  it('passes linked_blog_post_id when provided', async () => {
    vi.mocked(updateStrategyStatus).mockResolvedValue({} as any)
    await PATCH(
      buildReq({ status: 'done', linked_blog_post_id: 'blog-9' }),
      { params }
    )
    expect(updateStrategyStatus).toHaveBeenCalledWith('item-1', {
      status: 'done',
      linked_blog_post_id: 'blog-9',
    })
  })

  it('rejects invalid status', async () => {
    const res = await PATCH(buildReq({ status: 'bogus' }), { params })
    expect(res.status).toBe(400)
    expect(updateStrategyStatus).not.toHaveBeenCalled()
  })

  it('rejects missing status', async () => {
    const res = await PATCH(buildReq({}), { params })
    expect(res.status).toBe(400)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(updateStrategyStatus).mockRejectedValue(new Error('boom'))
    const res = await PATCH(buildReq({ status: 'approved' }), { params })
    expect(res.status).toBe(500)
  })
})
