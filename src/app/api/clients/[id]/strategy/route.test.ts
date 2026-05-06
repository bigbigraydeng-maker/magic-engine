/**
 * Tests for GET /api/clients/[id]/strategy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db/strategy-items', () => ({
  listStrategyItems: vi.fn(),
  countStrategyItemsByStatus: vi.fn(),
}))

import { GET } from './route'
import {
  listStrategyItems,
  countStrategyItemsByStatus,
} from '@/lib/db/strategy-items'

const CLIENT_ID = 'client-1'

function reqWithQuery(q: string) {
  return new NextRequest(
    `http://localhost/api/clients/x/strategy${q ? '?' + q : ''}`
  )
}

describe('GET /api/clients/[id]/strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countStrategyItemsByStatus).mockResolvedValue({
      pending: 3,
      approved: 1,
    })
    vi.mocked(listStrategyItems).mockResolvedValue([] as any)
  })

  it('returns items + status counts', async () => {
    const res = await GET(reqWithQuery(''), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status_counts.pending).toBe(3)
    expect(listStrategyItems).toHaveBeenCalledWith(CLIENT_ID, {})
  })

  it('passes valid status filter', async () => {
    await GET(reqWithQuery('status=approved'), { params: { id: CLIENT_ID } })
    expect(listStrategyItems).toHaveBeenCalledWith(CLIENT_ID, {
      status: 'approved',
    })
  })

  it('rejects invalid status filter', async () => {
    await GET(reqWithQuery('status=nope'), { params: { id: CLIENT_ID } })
    expect(listStrategyItems).toHaveBeenCalledWith(CLIENT_ID, {})
  })

  it('parses limit', async () => {
    await GET(reqWithQuery('limit=10'), { params: { id: CLIENT_ID } })
    expect(listStrategyItems).toHaveBeenCalledWith(CLIENT_ID, { limit: 10 })
  })

  it('returns 500 on db error', async () => {
    vi.mocked(listStrategyItems).mockRejectedValueOnce(new Error('boom'))
    const res = await GET(reqWithQuery(''), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(500)
  })
})
