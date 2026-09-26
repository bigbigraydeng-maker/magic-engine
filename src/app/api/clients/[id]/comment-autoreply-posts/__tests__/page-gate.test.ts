/**
 * AD-SEC-4 — the comment auto-reply probe and post-list endpoints are callable
 * by client members and read the Page in social_comment_config, which client
 * members can also edit. With a token that can see several clients' Pages,
 * pointing it at another client's Page used to return that Page's posts and
 * comments. Both must go through authorizeConfiguredPage first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ fetchPagePosts: vi.fn(), fetchPageReels: vi.fn() }))
vi.mock('@/lib/meta/comments', () => ({ fetchPostCommentsResult: vi.fn() }))
vi.mock('@/lib/meta/ads-posts', () => ({ fetchAdStoryIds: vi.fn() }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizeConfiguredPage: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const row = table === 'social_comment_config' ? { fb_page_id: '227633594573276' } : { meta_ad_account_id: 'act_1234567890' }
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) }
      return chain
    },
  },
}))

import { GET as posts } from '../route'
import { GET as probe } from '../../comment-autoreply-probe/route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPagePosts, fetchPageReels } from '@/lib/meta/page-posts'
import { fetchPostCommentsResult } from '@/lib/meta/comments'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'

const ctx = { params: Promise.resolve({ id: 'client-a' }) }
const req = () => new NextRequest('http://localhost:3001/api/clients/client-a/comment-autoreply-posts')
const fetchSpy = vi.fn()

beforeEach(() => {
  vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: true, user: { email: 'staff@client-a.example' }, tier: 'paid_client', allowedClientId: 'client-a' } as never)
  vi.mocked(getMetaTokenForClient).mockResolvedValue('shared-sees-everyone')
  vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'bound_to_other_client' })
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] })))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('another client\'s Page in the comment config is never read', () => {
  it('post list → 403, no Graph call for posts / reels', async () => {
    const res = await posts(req(), ctx)
    expect(res.status).toBe(403)
    expect(authorizeConfiguredPage).toHaveBeenCalledWith(expect.anything(), 'client-a', '227633594573276', expect.anything())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fetchPageReels).not.toHaveBeenCalled()
  })

  it('probe → reports not ready, reads no posts or comments', async () => {
    const res = await probe(req(), ctx)
    const json = await res.json()
    expect(json.ready).toBe(false)
    expect(json.live_read_ok).toBe(false)
    expect(fetchPagePosts).not.toHaveBeenCalled()
    expect(fetchPostCommentsResult).not.toHaveBeenCalled()
  })
})
