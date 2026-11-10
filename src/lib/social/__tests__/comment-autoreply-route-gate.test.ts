/**
 * Auto-reply must ask routeComment before any Meta write.
 * Price, complaint, refund, praise that is not a greeting or FAQ, an unknown
 * route, and a routing throw record the existing human handoff and do not
 * reply or DM. Confident spam is still hidden. A classifier throw does not
 * hide and is queued. A greeting and an FAQ still use the previous send path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const routingHold = vi.hoisted(() => ({
  actual: null as null | typeof import('../comment-routing').routeComment,
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizeConfiguredPage: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ fetchPagePosts: vi.fn(), fetchPageReels: vi.fn() }))
vi.mock('@/lib/meta/ads-posts', () => ({ fetchAdStoryIds: vi.fn() }))
vi.mock('@/lib/meta/comments', () => ({
  fetchPostCommentsResult: vi.fn(),
  replyToComment: vi.fn(),
  sendPrivateReply: vi.fn(),
  hideComment: vi.fn(),
}))
vi.mock('../comment-classifier', () => ({ classifyComment: vi.fn() }))
vi.mock('../comment-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comment-routing')>()
  routingHold.actual = actual.routeComment
  return { ...actual, routeComment: vi.fn(actual.routeComment) }
})

import { supabaseAdmin } from '@/lib/supabase'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { fetchPagePosts, fetchPageReels } from '@/lib/meta/page-posts'
import { fetchPostCommentsResult, hideComment, replyToComment, sendPrivateReply } from '@/lib/meta/comments'
import { classifyComment, type CommentDecision } from '../comment-classifier'
import { routeComment, type CommentRoutingInput } from '../comment-routing'
import { processClientComments, type CommentConfig } from '../comment-autoreply-engine'

const PAGE = 'page-test'
const POST = 'page-test_post-1'

const config: CommentConfig = {
  client_id: 'client-test',
  fb_page_id: PAGE,
  auto_reply_praise: true,
  auto_reply_question: true,
  auto_reply_complaint: true,
  auto_hide_spam: true,
  private_reply_enabled: true,
  lookback_days: 3,
  max_replies_per_run: 10,
}

interface DbResult {
  data: unknown
  error: { message: string } | null
}

interface Query {
  select: (...args: unknown[]) => Query
  eq: (...args: unknown[]) => Query
  in: (...args: unknown[]) => Query
  insert: (row: unknown) => Query
  update: (row: unknown) => Query
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
  then: (
    onFulfilled: (value: DbResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>
}

const engagementUpdates: unknown[] = []
const flywheelInserts: unknown[] = []

function query(resolve: () => DbResult, onUpdate?: (row: unknown) => void, onInsert?: (row: unknown) => void): Query {
  let mode: 'read' | 'insert' | 'update' = 'read'
  const q: Query = {
    select: () => q,
    eq: () => q,
    in: () => q,
    insert: (row) => {
      mode = 'insert'
      onInsert?.(row)
      return q
    },
    update: (row) => {
      mode = 'update'
      onUpdate?.(row)
      return q
    },
    maybeSingle: () => Promise.resolve(resolve()),
    single: () => Promise.resolve(mode === 'insert' ? { data: { id: 'row-1', attempts: 1 }, error: null } : resolve()),
    then: (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  }
  return q
}

function rowQuery(data: unknown): Query {
  return query(() => ({ data, error: null }))
}

function installDb(): void {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'clients') {
      return rowQuery({ name: 'Example Travel', domain: 'example.test', meta_ad_account_id: null }) as never
    }
    if (table === 'social_comment_config') return rowQuery({ unreadable_post_ids: [] }) as never
    if (table === 'social_comment_engagements') return query(() => ({ data: [], error: null }), (row) => engagementUpdates.push(row)) as never
    if (table === 'flywheel_actions') return query(() => ({ data: null, error: null }), undefined, (row) => flywheelInserts.push(row)) as never
    throw new Error(`unexpected table ${table}`)
  })
}

function wouldSend(over: Partial<CommentDecision> = {}): CommentDecision {
  return {
    category: 'question',
    confidence: 0.9,
    publicReply: 'public-template',
    publicReplyAfterDm: 'public-after-dm',
    privateReply: 'private-template',
    shouldHide: false,
    needsHuman: true,
    guardrailFlags: [],
    replySource: 'fallback',
    ...over,
  }
}

async function run(message: string, decision: CommentDecision | Error) {
  if (decision instanceof Error) vi.mocked(classifyComment).mockRejectedValue(decision)
  else vi.mocked(classifyComment).mockResolvedValue(decision)
  vi.mocked(fetchPagePosts).mockResolvedValue([{
    postId: 'post-1',
    fullId: POST,
    createdAt: new Date().toISOString(),
    message: 'a post',
    mediaType: 'photo',
    reactions: 0,
    comments: 1,
    shares: 0,
    score: 0,
  }])
  vi.mocked(fetchPageReels).mockResolvedValue([])
  vi.mocked(fetchPostCommentsResult).mockResolvedValue({
    ok: true,
    comments: [{
      commentId: 'comment-1',
      postId: POST,
      message,
      fromId: 'person-1',
      fromName: 'Sam',
      createdAt: new Date().toISOString(),
      isFromPage: false,
    }],
  })
  return processClientComments(config)
}

function expectNoMetaWrite(): void {
  expect(replyToComment).not.toHaveBeenCalled()
  expect(sendPrivateReply).not.toHaveBeenCalled()
  expect(hideComment).not.toHaveBeenCalled()
  expect(flywheelInserts).toEqual([])
  expect(engagementUpdates).toEqual([
    expect.objectContaining({
      needs_human: true,
      reply_status: 'pending',
      public_reply_id: null,
      public_reply_text: null,
      private_reply_sent: false,
      hidden: false,
    }),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  engagementUpdates.length = 0
  flywheelInserts.length = 0
  delete process.env.SOCIAL_COMMENT_AUTOREPLY_KILL
  vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'staff_verified' })
  vi.mocked(replyToComment).mockResolvedValue('reply-1')
  vi.mocked(sendPrivateReply).mockResolvedValue(true)
  vi.mocked(hideComment).mockResolvedValue(true)
  const actual = routingHold.actual
  if (!actual) throw new Error('routeComment actual missing')
  vi.mocked(routeComment).mockImplementation((input: CommentRoutingInput) => actual(input))
  installDb()
})

describe('comment auto-reply route gate', () => {
  it('a price question produces no Meta write', async () => {
    const res = await run('How much is this tour?', wouldSend())
    expectNoMetaWrite()
    expect(res).toMatchObject({ public_replies: 0, private_replies: 0, hidden: 0, needs_human: 1, failed: 0 })
    expect(engagementUpdates[0]).toMatchObject({ guardrail_flags: ['not_greeting_or_faq'] })
  })

  it('a complaint produces no Meta write', async () => {
    const res = await run('Terrible service', wouldSend({ category: 'complaint' }))
    expectNoMetaWrite()
    expect(res.needs_human).toBe(1)
  })

  it('a refund request produces no Meta write', async () => {
    const res = await run('I need a refund please', wouldSend({ category: 'complaint' }))
    expectNoMetaWrite()
    expect(res.needs_human).toBe(1)
  })

  it('a routing error produces no Meta write', async () => {
    vi.mocked(routeComment).mockImplementation(() => {
      throw new Error('routing blew up')
    })
    const res = await run('Hello, thank you', wouldSend({
      category: 'praise',
      publicReply: 'thanks-template',
      publicReplyAfterDm: null,
      privateReply: null,
      needsHuman: false,
      replySource: 'fallback',
    }))
    expectNoMetaWrite()
    expect(res).toMatchObject({ public_replies: 0, private_replies: 0, hidden: 0, needs_human: 1 })
    expect(engagementUpdates[0]).toMatchObject({ guardrail_flags: ['routing_error'] })
  })

  it('an unknown route produces no Meta write, even if marked auto_ok', async () => {
    vi.mocked(routeComment).mockReturnValue({ route: 'auto_ok', intent: 'unknown', guide_to_dm: false })
    const res = await run('Where did I leave my hat?', wouldSend())
    expectNoMetaWrite()
    expect(res.needs_human).toBe(1)
  })

  it('a non-praise comment that is not greeting or FAQ goes to a human with no thank-you', async () => {
    const res = await run('Where did I leave my hat?', wouldSend({
      category: 'other',
      publicReply: 'thanks-template',
      publicReplyAfterDm: null,
      privateReply: null,
      needsHuman: false,
      replySource: 'llm',
    }))
    expectNoMetaWrite()
    expect(res).toMatchObject({ public_replies: 0, private_replies: 0, hidden: 0, needs_human: 1 })
    expect(engagementUpdates[0]).toMatchObject({ guardrail_flags: ['not_greeting_or_faq'], needs_human: true })
  })

  it('confident spam is hidden and not replied to', async () => {
    const res = await run('Follow this page for daily photos', wouldSend({
      category: 'spam',
      confidence: 0.95,
      publicReply: null,
      publicReplyAfterDm: null,
      privateReply: null,
      shouldHide: true,
      needsHuman: false,
      replySource: 'none',
    }))
    expect(replyToComment).not.toHaveBeenCalled()
    expect(sendPrivateReply).not.toHaveBeenCalled()
    expect(hideComment).toHaveBeenCalledTimes(1)
    expect(hideComment).toHaveBeenCalledWith('comment-1', 'page-token')
    expect(flywheelInserts).toEqual([])
    expect(res).toMatchObject({ public_replies: 0, private_replies: 0, hidden: 1, needs_human: 0, failed: 0 })
    expect(engagementUpdates[0]).toMatchObject({
      reply_status: 'hidden',
      hidden: true,
      needs_human: false,
      public_reply_id: null,
      private_reply_sent: false,
    })
  })

  it('a classifier error does not hide and is queued', async () => {
    const res = await run('Follow this page for daily photos', new Error('classifier blew up'))
    expectNoMetaWrite()
    expect(res).toMatchObject({ public_replies: 0, private_replies: 0, hidden: 0, needs_human: 1 })
    expect(engagementUpdates[0]).toMatchObject({
      category: 'other',
      needs_human: true,
      reply_status: 'pending',
      hidden: false,
      guardrail_flags: ['classifier_error'],
    })
  })

  it('a greeting still gets the public reply', async () => {
    const res = await run('Hello, thank you', wouldSend({
      category: 'praise',
      publicReply: 'thanks-template',
      publicReplyAfterDm: null,
      privateReply: null,
      needsHuman: false,
      replySource: 'fallback',
    }))
    expect(sendPrivateReply).not.toHaveBeenCalled()
    expect(hideComment).not.toHaveBeenCalled()
    expect(replyToComment).toHaveBeenCalledTimes(1)
    expect(replyToComment).toHaveBeenCalledWith('comment-1', 'thanks-template', 'page-token')
    expect(res).toMatchObject({ public_replies: 1, private_replies: 0, hidden: 0, needs_human: 0, failed: 0 })
    expect(flywheelInserts).toHaveLength(1)
  })

  it('praise routed as auto_ok praise gets the public thank-you', async () => {
    const res = await run('What a wonderful day out', wouldSend({
      category: 'praise',
      publicReply: 'thanks-template',
      publicReplyAfterDm: null,
      privateReply: null,
      needsHuman: false,
      replySource: 'fallback',
    }))
    expect(replyToComment).toHaveBeenCalledWith('comment-1', 'thanks-template', 'page-token')
    expect(res).toMatchObject({ public_replies: 1, needs_human: 0, failed: 0 })
  })

  it('an FAQ still gets the private reply and the public reply', async () => {
    const res = await run('Do I need a visa?', wouldSend())
    expect(hideComment).not.toHaveBeenCalled()
    expect(sendPrivateReply).toHaveBeenCalledWith('comment-1', 'private-template', 'page-token')
    expect(replyToComment).toHaveBeenCalledWith('comment-1', 'public-after-dm', 'page-token')
    expect(res).toMatchObject({ public_replies: 1, private_replies: 1, hidden: 0, failed: 0 })
  })
})
