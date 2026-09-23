import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockGlobalAdmin = vi.mocked(guardGlobalAdmin)
const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function thenable(data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: Promise<unknown>['then'] } = {}
  for (const method of ['select', 'order', 'limit', 'eq', 'in', 'not']) {
    query[method] = vi.fn(() => query)
  }
  query.update = vi.fn(() => query)
  query.then = (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject)
  return query
}

afterEach(() => vi.clearAllMocks())

describe('content review collection auth', () => {
  it('rejects a scoped request before reading content', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const response = await GET(new NextRequest(`http://localhost/api/content/posts?client_id=${CLIENT}`))
    expect(response.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('requires a true global admin for the all-client view', async () => {
    mockGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const response = await GET(new NextRequest('http://localhost/api/content/posts'))
    expect(response.status).toBe(403)
    expect(mockAccess).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('is read-only when an authorised reviewer opens the board', async () => {
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)
    const posts = thenable([{ id: 'post-1', client_id: CLIENT }])
    const assets = thenable([{
      post_id: 'post-1',
      client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84',
      storage_url: 'https://foreign.test/image.jpg',
      asset_type: 'image',
    }])
    mockFrom.mockImplementation((table: string) => (table === 'content_posts' ? posts : assets) as never)

    const response = await GET(new NextRequest(`http://localhost/api/content/posts?client_id=${CLIENT}&status=draft`))
    expect(response.status).toBe(200)
    expect(posts.update).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({
      // guard: null —— 这条没跑过发布前自检。不是「查过没问题」，界面据此不亮红旗。
      posts: [{ id: 'post-1', client_id: CLIENT, guard: null, visual_asset_url: null, visual_asset_type: null }],
    })
  })

  it('surfaces the pre-publish flag, without the judging service\'s raw error', async () => {
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)
    const posts = thenable([{
      id: 'post-1',
      client_id: CLIENT,
      generation_context_snapshot: {
        content_guard: {
          status: 'unavailable',
          needs_human_review: true,
          target_language: 'en',
          language_findings: [],
          cliche_probability: null,
          judge_error: 'jev call failed (503)',
          cliche_threshold: 0.8,
          checked_at: '2026-09-23T00:00:00.000Z',
        },
      },
    }])
    mockFrom.mockImplementation((table: string) => (table === 'content_posts' ? posts : thenable([])) as never)

    const body = await (await GET(new NextRequest(`http://localhost/api/content/posts?client_id=${CLIENT}`))).json()

    expect(body.posts[0].guard.needsReview).toBe(true)
    expect(body.posts[0].guard.reasons).toEqual(['check_unavailable'])
    // 看板客户也能打开：判分服务的原始报错（带供应商名）绝不能出现在响应里，
    // 整份 snapshot 也不外送。
    expect(JSON.stringify(body)).not.toContain('jev')
    expect(body.posts[0].generation_context_snapshot).toBeUndefined()
  })
})
