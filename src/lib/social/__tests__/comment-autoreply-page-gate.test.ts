/**
 * AD-SEC-4 — comment auto-reply reads, replies to, hides and DMs on the Page in
 * social_comment_config, which client members can edit. It must only act when the
 * ownership gate (authorizeConfiguredPage — rules tested against the fake DB in
 * lib/meta/__tests__/page-sync-authorization.test.ts) lets that Page through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizeConfiguredPage: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ fetchPagePosts: vi.fn(), fetchPageReels: vi.fn() }))
vi.mock('@/lib/meta/ads-posts', () => ({ fetchAdStoryIds: vi.fn() }))
vi.mock('@/lib/meta/comments', () => ({
  fetchPostCommentsResult: vi.fn(), replyToComment: vi.fn(), sendPrivateReply: vi.fn(), hideComment: vi.fn(),
}))

import { processClientComments, type CommentConfig } from '../comment-autoreply-engine'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { fetchPagePosts, fetchPageReels } from '@/lib/meta/page-posts'
import { replyToComment, sendPrivateReply, hideComment } from '@/lib/meta/comments'

const mockAuth = vi.mocked(authorizeConfiguredPage)
const OWN_PAGE = '1616575215312482'
const OTHER_PAGE = '227633594573276'

const config = (fb_page_id: string): CommentConfig => ({
  client_id: 'client-a', fb_page_id, auto_reply_praise: true, auto_reply_question: true,
  auto_reply_complaint: true, auto_hide_spam: true, private_reply_enabled: true, lookback_days: 3, max_replies_per_run: 10,
})

const nothingTouched = () => {
  expect(fetchPagePosts).not.toHaveBeenCalled()
  expect(fetchPageReels).not.toHaveBeenCalled()
  expect(replyToComment).not.toHaveBeenCalled()
  expect(sendPrivateReply).not.toHaveBeenCalled()
  expect(hideComment).not.toHaveBeenCalled()
}

beforeEach(() => {
  delete process.env.SOCIAL_COMMENT_AUTOREPLY_KILL
  mockAuth.mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'staff_verified' })
})
afterEach(() => vi.clearAllMocks())

describe('comment auto-reply page gate', () => {
  it('gate refuses the configured Page (not the client\'s) → refused, nothing read, replied, hidden or DMed', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'not_bound_page' })
    const res = await processClientComments(config(OTHER_PAGE))
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), 'client-a', OTHER_PAGE, expect.anything())
    expect(res).toMatchObject({ ok: false, error: 'page_not_verified: not_bound_page' })
    nothingTouched()
  })

  it('bound Page not verified → refused', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'unverified_shared_token' })
    const res = await processClientComments(config(OWN_PAGE))
    expect(res.error).toBe('page_not_verified: unverified_shared_token')
    nothingTouched()
  })

  it('no token → refused with the old message, nothing touched', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'no_meta_token' })
    const res = await processClientComments(config(OWN_PAGE))
    expect(res).toMatchObject({ ok: false, error: 'no Meta token configured' })
    nothingTouched()
  })
})
