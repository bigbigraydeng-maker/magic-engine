/**
 * 评论自动回复一整轮：扫描能不能扫完、扫不完会不会被看见、没权限会不会乱发。
 *
 * Meta 这边用真实形状的 Graph 响应（CTS 2026-09-14 的原话）走全局 fetch；
 * 数据库按表建模，记下每张表被写了什么。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PAGE = '1616575215312482'
const POST = `${PAGE}_1672828167982705`
const REDUCE_DATA_BODY = {
  error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" },
}

// ---- database fake, modelled per table ------------------------------------

const writes: Array<{ table: string; op: 'insert' | 'update'; row: Record<string, unknown> }> = []
const db = { adAccountId: null as string | null }

function tableFake(table: string) {
  const reads: Record<string, unknown> = {
    clients: { name: 'Test Client', domain: 'example.co.nz', meta_ad_account_id: db.adAccountId },
    social_comment_config: { unreadable_post_ids: [] },
  }
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.in = chain
  b.insert = (row: Record<string, unknown>) => { writes.push({ table, op: 'insert', row }); return b }
  b.update = (row: Record<string, unknown>) => { writes.push({ table, op: 'update', row }); return b }
  b.maybeSingle = async () => ({ data: reads[table] ?? null, error: null })
  b.single = async () => ({ data: { id: 'row-1', attempts: 1 }, error: null })
  // `await supabase.from(t).select().in(...)` — engagements pre-filter: nothing seen yet
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => tableFake(t) } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'user-token' }))
const PRAISE = {
  category: 'praise', confidence: 0.95, publicReply: 'Thanks so much!', publicReplyAfterDm: null,
  privateReply: null, shouldHide: false, needsHuman: false, guardrailFlags: [], replySource: 'llm',
}
const classifier = { decision: PRAISE as Record<string, unknown> }
vi.mock('../comment-classifier', () => ({ classifyComment: async () => classifier.decision }))

import { processClientComments, describeFailedClients, type CommentConfig } from '../comment-autoreply-engine'

// ---- Graph fake ------------------------------------------------------------

interface GraphScript {
  publishedPosts: Array<{ status: number; body: unknown }>
  permissions: { status: number; body: unknown }
  reels?: { status: number; body: unknown }
  ads?: { status: number; body: unknown }
  comments?: { status: number; body: unknown }
}

const calls: Array<{ method: string; path: string }> = []

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

function installGraph(script: GraphScript) {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname })
    const p = url.pathname.replace('/v20.0', '').replace('/v21.0', '')
    if (p === '/me/accounts') return json(200, { data: [{ id: PAGE, access_token: 'page-token' }] })
    if (p === '/me/permissions') return json(script.permissions.status, script.permissions.body)
    if (p === `/${PAGE}/published_posts`) {
      const next = script.publishedPosts.shift()
      if (!next) throw new Error('fake graph: published_posts called more times than scripted')
      return json(next.status, next.body)
    }
    if (p === `/${PAGE}/video_reels`) {
      const r = script.reels ?? { status: 200, body: { data: [], paging: { cursors: { before: 'x', after: 'y' } } } }
      return json(r.status, r.body)
    }
    if (p === '/act_123/ads') {
      const r = script.ads ?? { status: 200, body: { data: [] } }
      // a raw string body = a truncated / proxied response that is not JSON
      return typeof r.body === 'string' ? new Response(r.body, { status: r.status }) : json(r.status, r.body)
    }
    if (p === `/${POST}/comments` && method === 'GET') {
      const r = script.comments ?? {
        status: 200,
        body: { data: [{ id: `${POST}_900`, message: 'Loved this trip!', created_time: new Date().toISOString(), from: { id: '42', name: 'Jane Doe' } }] },
      }
      return json(r.status, r.body)
    }
    if (p === `/${POST}_900/comments` && method === 'POST') return json(200, { id: `${POST}_901` })
    if (p === `/${POST}_900/private_replies` && method === 'POST') return json(200, { id: 'm_1', recipient_id: '42' })
    throw new Error(`fake graph: unmodelled ${method} ${p}`)
  }))
}

const onePostPage = { status: 200, body: { data: [{ id: POST }], paging: { cursors: { before: 'a', after: 'b' } } } }
const grants = (...scopes: string[]) => ({
  status: 200,
  body: { data: ['pages_show_list', 'pages_read_engagement', ...scopes].map((permission) => ({ permission, status: 'granted' })) },
})

const config: CommentConfig = {
  client_id: 'client-1', fb_page_id: PAGE,
  auto_reply_praise: true, auto_reply_question: true, auto_reply_complaint: true,
  auto_hide_spam: true, private_reply_enabled: false, lookback_days: 7, max_replies_per_run: 10,
}

const sends = () => calls.filter((c) => c.method !== 'GET')
const engagementWrites = (op: 'insert' | 'update') =>
  writes.filter((w) => w.table === 'social_comment_engagements' && w.op === op)

beforeEach(() => {
  writes.length = 0
  calls.length = 0
  db.adAccountId = null
  classifier.decision = PRAISE
})
afterEach(() => vi.unstubAllGlobals())

describe('processClientComments — scan', () => {
  it('🔴 CTS case: code 1 on the post list is recovered by a smaller page, and the comment is found', async () => {
    installGraph({ publishedPosts: [{ status: 500, body: REDUCE_DATA_BODY }, onePostPage], permissions: grants('pages_manage_engagement') })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.scan_error).toBeUndefined()
    expect(r.posts_scanned).toBe(1)
    expect(r.new_comments).toBe(1)
  })

  it('🔴 a post list that cannot be read → ok=false with the reason, never a quiet healthy run', async () => {
    installGraph({
      publishedPosts: [REDUCE_DATA_BODY, REDUCE_DATA_BODY, REDUCE_DATA_BODY, REDUCE_DATA_BODY].map((body) => ({ status: 500, body })),
      permissions: grants('pages_manage_engagement'),
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.scan_error).toContain('published_posts')
    expect(r.scan_error).toContain('code=1')
    expect(r.error).toContain('comment scan incomplete')
  })

  it('🔴 a transient comment read (rate limit) is a missed post this run → ok=false, not "0 new comments"', async () => {
    installGraph({
      publishedPosts: [onePostPage],
      permissions: grants('pages_manage_engagement'),
      comments: { status: 400, body: { error: { code: 4, message: 'Application request limit reached' } } },
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.posts_comment_read_failed).toBe(1)
    expect(r.scan_error).toContain('comments unreadable on 1/1 posts')
  })

  it('a Page whose Reels list Meta refuses (#10) is skipped, not failed every run', async () => {
    installGraph({
      publishedPosts: [onePostPage],
      permissions: grants('pages_manage_engagement'),
      reels: { status: 400, body: { error: { code: 10, message: '(#10) Application does not have permission for this action' } } },
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.sources_skipped?.[0]).toContain('video_reels')
  })

  it('🔴 but a Reels list failing with code 1 / 5xx is a real miss → ok=false', async () => {
    installGraph({
      publishedPosts: [onePostPage],
      permissions: grants('pages_manage_engagement'),
      reels: { status: 500, body: { error: { code: 2, message: 'An unexpected error has occurred' } } },
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.scan_error).toContain('video_reels')
  })

  it('🔴 a boosted-post list that breaks (5xx) is reported, not swallowed', async () => {
    db.adAccountId = '123'
    installGraph({
      publishedPosts: [onePostPage],
      permissions: grants('pages_manage_engagement'),
      ads: { status: 500, body: { error: { code: 2, message: 'Service temporarily unavailable' } } },
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.scan_error).toContain('ads act_123')
  })

  it('🔴 a boosted-post list whose body is not JSON does not abort the organic comments', async () => {
    db.adAccountId = '123'
    installGraph({
      publishedPosts: [onePostPage],
      permissions: grants('pages_manage_engagement'),
      ads: { status: 200, body: '{"data":[{"creative":' },
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.scan_error).toContain('not valid JSON')
    expect(r.public_replies).toBe(1)
  })
})

describe('processClientComments — reply permission', () => {
  it('🔴 without pages_manage_engagement: no public reply, comment recorded as needs-human (never auto-replied later)', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: grants('pages_read_user_content') })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.engagement_scope_missing).toBe(true)
    expect(r.replies_blocked).toBe(1)
    expect(r.public_replies).toBe(0)
    expect(sends()).toEqual([])
    // claimed + finalised as pending/needs_human → stays in the human queue and
    // is not retried, so a hand-written reply cannot be doubled once granted
    expect(engagementWrites('insert')).toHaveLength(1)
    const final = engagementWrites('update').at(-1)!.row
    expect(final.reply_status).toBe('pending')
    expect(final.needs_human).toBe(true)
    expect(final.error_message).toContain('pages_manage_engagement')
  })

  it('without the permission, spam is not hidden but left for a human', async () => {
    classifier.decision = { ...PRAISE, category: 'spam', publicReply: null, shouldHide: true }
    installGraph({ publishedPosts: [onePostPage], permissions: grants() })
    const r = await processClientComments(config)

    expect(r.hidden).toBe(0)
    expect(r.replies_blocked).toBe(1)
    expect(sends()).toEqual([])
    expect(engagementWrites('update').at(-1)!.row.reply_status).toBe('pending')
  })

  it('DMs use a different permission (pages_messaging) and still go out', async () => {
    classifier.decision = {
      ...PRAISE, category: 'question', publicReply: 'Details on our site', publicReplyAfterDm: "We've messaged you",
      privateReply: 'Hi Jane, here are the tour dates',
    }
    installGraph({ publishedPosts: [onePostPage], permissions: grants('pages_messaging') })
    const r = await processClientComments({ ...config, private_reply_enabled: true })

    expect(r.private_replies).toBe(1)
    expect(sends()).toEqual([{ method: 'POST', path: `/v20.0/${POST}_900/private_replies` }])
    expect(engagementWrites('update').at(-1)!.row.needs_human).toBe(true)
  })

  it('🔴 permission list unreadable → fail closed (no public reply) and the run is not ok', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: { status: 500, body: { error: { code: 2, message: 'Service temporarily unavailable' } } } })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.engagement_scope_missing).toBeUndefined()
    expect(r.scan_error).toContain('/me/permissions')
    expect(sends()).toEqual([])
    // 🔴 a blip must not park comments as needs-human forever — nothing claimed, retried next run
    expect(engagementWrites('insert')).toEqual([])
    expect(engagementWrites('update')).toEqual([])
  })

  it('with the permission granted the reply path still runs (the guard does not block a healthy client)', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: grants('pages_manage_engagement') })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.engagement_scope_missing).toBeUndefined()
    expect(r.replies_blocked).toBeUndefined()
    expect(r.public_replies).toBe(1)
    expect(sends()).toEqual([{ method: 'POST', path: `/v20.0/${POST}_900/comments` }])
    expect(engagementWrites('update').at(-1)!.row.reply_status).toBe('replied')
  })
})

describe('describeFailedClients', () => {
  it('all clean → no run-level error (the run stays completed)', () => {
    expect(describeFailedClients([{ client_id: 'a', ok: true }])).toBeUndefined()
  })

  it('🔴 any failed client → run-level error naming the client and the reason', () => {
    const msg = describeFailedClients([
      { client_id: 'a', ok: true },
      { client_id: 'client-1', ok: false, error: 'comment scan incomplete: published_posts 1616575215312482: 500 code=1' },
    ])
    expect(msg).toContain('1/2 clients failed')
    expect(msg).toContain('client-1: comment scan incomplete')
  })
})
