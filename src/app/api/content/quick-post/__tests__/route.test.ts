import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  judge: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.requireAccess }))
vi.mock('@/lib/content/price-claim-gate', () => ({
  judgeOutgoingPost: mocks.judge,
  priceGateMessage: () => 'price gate',
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (row: unknown) => {
        mocks.insert(row)
        return { select: () => ({ single: async () => ({ data: { id: 'post-1' }, error: null }) }) }
      },
    }),
  },
}))

import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost:3001/api/content/quick-post', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAccess.mockResolvedValue({ ok: true })
  mocks.judge.mockResolvedValue({ blocked: false })
})

describe('POST /api/content/quick-post', () => {
  it('stages a draft in content_posts and makes no outbound call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await POST(req({ client_id: 'c1', caption: 'Hello', platform: 'facebook', hashtags: ['#a'], draft_only: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, post_id: 'post-1' })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'c1', status: 'draft', platforms: ['facebook'], caption: 'Hello\n\n#a', source: 'kanban',
    }))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('requires scheduled_at unless draft_only', async () => {
    const res = await POST(req({ client_id: 'c1', caption: 'Hello', platform: 'facebook' }))
    expect(res.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('blocks unbacked real-price captions with 409', async () => {
    mocks.judge.mockResolvedValue({ blocked: true, source: 'unknown' })
    const res = await POST(req({ client_id: 'c1', caption: 'From $99', platform: 'facebook', draft_only: true }))
    expect(res.status).toBe(409)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
