/**
 * The callback is where a Meta grant becomes a stored connection. #1152 adds
 * one hard rule: what we persist must be what the provider ACTUALLY granted,
 * never the scope set we asked for. These tests exist to keep that honest — a
 * declined publishing permission must never be recorded as publish-ready, and
 * the publishing reauthorisation must fail closed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  verifyState:                vi.fn(),
  exchangeCode:               vi.fn(),
  exchangeForLongLivedToken:  vi.fn(),
  listPagesWithTokens:        vi.fn(),
  listGrantedScopes:          vi.fn(),
  upsertConnection:           vi.fn(),
  upsertCalls:                [] as Array<Record<string, unknown>>,
  boundPageId:                '1616575215312482' as string | null,
  factoryConfig:              { publish_target: { platform: 'facebook', page_id: '1616575215312482' } } as unknown,
  commentPageId:               '1616575215312482' as string | null,
}))

vi.mock('@/lib/meta-oauth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta-oauth/client')>()
  return {
    ...actual,
    verifyState:               mocks.verifyState,
    exchangeCode:              mocks.exchangeCode,
    exchangeForLongLivedToken: mocks.exchangeForLongLivedToken,
    listPagesWithTokens:       mocks.listPagesWithTokens,
    listGrantedScopes:         mocks.listGrantedScopes,
  }
})

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: (input: Record<string, unknown>) => {
    mocks.upsertCalls.push(input)
    return mocks.upsertConnection(input)
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            table === 'social_comment_config'
              ? Promise.resolve({ data: { fb_page_id: mocks.commentPageId }, error: null })
              : Promise.resolve({
                  data: { facebook_page_id: mocks.boundPageId, factory_config: mocks.factoryConfig },
                  error: null,
                }),
          ),
        })),
      })),
    })),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PAGE_ID = '1616575215312482'

function makeRequest(params: { code?: string; state?: string; error?: string }) {
  const url = new URL('http://localhost:3001/api/auth/facebook/callback')
  if (params.code)  url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  if (params.error) url.searchParams.set('error', params.error)
  return new NextRequest(url)
}

function locationOf(res: NextResponse): URL {
  return new URL(res.headers.get('location') ?? '')
}

function outcomeOf(res: NextResponse): string | null {
  return locationOf(res).searchParams.get('meta')
}

/** FacebookPagePanel — which renders every meta= outcome and the retry button —
 *  only mounts inside the client-page settings drawer opened by ?settings=platform.
 *  A callback that lands anywhere else hides the whole self-service loop. */
function landsOnMetaPanel(res: NextResponse, clientId: string): boolean {
  const url = locationOf(res)
  return (
    url.pathname === `/dashboard/clients/${clientId}` &&
    url.searchParams.get('settings') === 'platform'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertCalls.length = 0
  mocks.boundPageId = PAGE_ID
  mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PAGE_ID } }
  mocks.commentPageId = PAGE_ID
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  process.env.FACEBOOK_APP_SECRET = 'app-secret-456'
  mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID })
  mocks.exchangeCode.mockResolvedValue('short-token')
  mocks.exchangeForLongLivedToken.mockResolvedValue('long-token')
  mocks.listPagesWithTokens.mockResolvedValue([
    { pageId: PAGE_ID, pageName: 'CTS Tours', pageToken: 'page-token-xyz' },
  ])
  mocks.listGrantedScopes.mockResolvedValue([
    'pages_show_list',
    'pages_messaging',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_posts',
  ])
  mocks.upsertConnection.mockResolvedValue(undefined)
})

describe('scope persistence — provider-authoritative, never the requested constant (#1152)', () => {
  it('persists exactly the scopes Meta granted, and stamps last_synced_at', async () => {
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_messaging',
      'pages_manage_posts',
    ])

    await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(mocks.upsertCalls).toHaveLength(1)
    const row = mocks.upsertCalls[0]
    expect(row.scopes).toEqual(['pages_show_list', 'pages_messaging', 'pages_manage_posts'])
    // last_synced_at must be freshly set — the SCOUT flagged its null-forever
    // state as "readiness never re-verified".
    expect(row.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('does not drop the existing read/inbox scopes when publishing is added', async () => {
    // A full grant round-trips intact — nothing silently trimmed.
    const full = [
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
      'pages_read_user_content',
      'pages_manage_posts',
    ]
    mocks.listGrantedScopes.mockResolvedValue(full)

    await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(mocks.upsertCalls[0].scopes).toEqual(full)
  })

  it('writes NOTHING and stamps no timestamp when the permissions read fails — never fabricates a grant (#1152 P2)', async () => {
    mocks.listGrantedScopes.mockResolvedValue(null) // read failed / unparseable

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    // No upsert at all: the existing connection's known scope facts and its
    // last_synced_at must be left untouched rather than overwritten with the
    // requested constant + a false "just verified" timestamp.
    expect(mocks.upsertCalls).toHaveLength(0)
    expect(outcomeOf(res)).toBe('verify_failed')
  })
})

describe('publishing reauthorisation fails closed (#1152)', () => {
  it('reports publish_ready only when the provider authoritatively granted pages_manage_posts', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_manage_posts',
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
  })

  it('reports publish_not_granted AND stores scopes without pages_manage_posts when Meta declines it', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
    ]) // publishing declined

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_not_granted')
    // The stored truth must exclude the declined permission — no publish-ready lie.
    expect(mocks.upsertCalls[0].scopes).not.toContain('pages_manage_posts')
  })

  it('a publishing reauth with a failed permissions read is not-ready AND writes nothing — no false success or timestamp', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue(null)

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('verify_failed')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('an inbox connect (no intent) is unaffected — still lands on connected', async () => {
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('connected')
  })
})

describe('publishing reauth binds to factory_config.publish_target, not the inbox Page (#1152 P1)', () => {
  const PUBLISH_PAGE = '999888777'

  beforeEach(() => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
  })

  it('stores the token for the publish target when it differs from the inbox Page', async () => {
    mocks.boundPageId = PAGE_ID // inbox Page
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PUBLISH_PAGE } }
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PAGE_ID, pageName: 'Inbox Page', pageToken: 'inbox-token' },
      { pageId: PUBLISH_PAGE, pageName: 'Publish Page', pageToken: 'publish-token' },
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
    // The persisted account_id + token must be the PUBLISH Page, never the inbox one.
    expect(mocks.upsertCalls).toHaveLength(1)
    expect(mocks.upsertCalls[0].accountId).toBe(PUBLISH_PAGE)
    expect(mocks.upsertCalls[0].accessToken).toBe('publish-token')
  })

  it('works when only a publish target exists and the inbox binding is absent', async () => {
    mocks.boundPageId = null // no inbox binding
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PUBLISH_PAGE } }
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PUBLISH_PAGE, pageName: 'Publish Page', pageToken: 'publish-token' },
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
    expect(mocks.upsertCalls[0].accountId).toBe(PUBLISH_PAGE)
  })

  it('when publish target equals the inbox Page, still binds to that Page', async () => {
    mocks.boundPageId = PAGE_ID
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PAGE_ID } }

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
    expect(mocks.upsertCalls[0].accountId).toBe(PAGE_ID)
  })

  it('fails closed with no_publish_target and writes nothing when no publish target is configured', async () => {
    mocks.factoryConfig = {} // no publish_target

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('no_publish_target')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('fails closed with no_publish_target when the target is a non-Facebook platform', async () => {
    mocks.factoryConfig = { publish_target: { platform: 'instagram', page_id: PUBLISH_PAGE } }

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('no_publish_target')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('fails closed (page_not_granted, no write) when the granted Meta Pages do not include the publish target', async () => {
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PUBLISH_PAGE } }
    // Meta hands back only some OTHER page — not the configured publish target.
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PAGE_ID, pageName: 'Inbox Page', pageToken: 'inbox-token' },
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('page_not_granted')
    expect(mocks.upsertCalls).toHaveLength(0)
  })
})

describe('comment_reply reauth binds to social_comment_config.fb_page_id, not the inbox Page (Codex round 8 复审 P1)', () => {
  const COMMENT_PAGE = '444555666'

  beforeEach(() => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'comment_reply' })
  })

  it('stores the token for the comment-reply Page when it differs from the inbox Page', async () => {
    mocks.boundPageId = PAGE_ID // inbox Page
    mocks.commentPageId = COMMENT_PAGE
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PAGE_ID, pageName: 'Inbox Page', pageToken: 'inbox-token' },
      { pageId: COMMENT_PAGE, pageName: 'Comment Page', pageToken: 'comment-token' },
    ])
    mocks.listGrantedScopes.mockResolvedValue(['pages_show_list', 'pages_manage_engagement'])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('comment_reply_ready')
    // The persisted account_id + token must be the COMMENT-REPLY Page, never the inbox one —
    // this is exactly the bug: a plain reconnect used to always bind clients.facebook_page_id.
    expect(mocks.upsertCalls).toHaveLength(1)
    expect(mocks.upsertCalls[0].accountId).toBe(COMMENT_PAGE)
    expect(mocks.upsertCalls[0].accessToken).toBe('comment-token')
  })

  it('works when only a comment-reply Page exists and the inbox binding is absent', async () => {
    mocks.boundPageId = null // no inbox binding
    mocks.commentPageId = COMMENT_PAGE
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: COMMENT_PAGE, pageName: 'Comment Page', pageToken: 'comment-token' },
    ])
    mocks.listGrantedScopes.mockResolvedValue(['pages_show_list', 'pages_manage_engagement'])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('comment_reply_ready')
    expect(mocks.upsertCalls[0].accountId).toBe(COMMENT_PAGE)
  })

  it('fails closed with no_comment_page and writes nothing when social_comment_config has no fb_page_id', async () => {
    mocks.commentPageId = null

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('no_comment_page')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('fails closed (page_not_granted, no write) when the granted Meta Pages do not include the comment-reply Page', async () => {
    mocks.commentPageId = COMMENT_PAGE
    // Meta hands back only some OTHER page — not the configured comment-reply Page.
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PAGE_ID, pageName: 'Inbox Page', pageToken: 'inbox-token' },
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('page_not_granted')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  // Codex round 9 复审 P1: comment_reply used to fall through to the generic
  // 'connected' outcome even when Meta declined pages_manage_engagement,
  // telling the FDE the fix worked when public replies would keep failing.
  it('reports comment_reply_ready only when the provider authoritatively granted pages_manage_engagement', async () => {
    mocks.commentPageId = COMMENT_PAGE
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: COMMENT_PAGE, pageName: 'Comment Page', pageToken: 'comment-token' },
    ])
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_manage_engagement',
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('comment_reply_ready')
  })

  it('reports comment_reply_not_granted AND still stores the token when Meta declines pages_manage_engagement', async () => {
    mocks.commentPageId = COMMENT_PAGE
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: COMMENT_PAGE, pageName: 'Comment Page', pageToken: 'comment-token' },
    ])
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
    ]) // pages_manage_engagement declined

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('comment_reply_not_granted')
    // The connection still gets stored (whatever WAS granted) — declining one
    // scope should not also block the read/inbox scopes that did come through.
    expect(mocks.upsertCalls).toHaveLength(1)
    expect(mocks.upsertCalls[0].scopes).not.toContain('pages_manage_engagement')
  })
})

describe('every outcome returns to the surface that renders FacebookPagePanel (#1152 P1-2)', () => {
  it('all three publishing outcomes land on the ?settings=platform drawer, not the panel-less /settings route', async () => {
    const cases: Array<{ granted: string[] | null; expect: string }> = [
      { granted: ['pages_show_list', 'pages_manage_posts'], expect: 'publish_ready' },
      { granted: ['pages_show_list'], expect: 'publish_not_granted' },
      { granted: null, expect: 'verify_failed' },
    ]

    for (const c of cases) {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
      mocks.listGrantedScopes.mockResolvedValue(c.granted)

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(outcomeOf(res)).toBe(c.expect)
      // Must land where the panel + retry button actually render.
      expect(landsOnMetaPanel(res, CLIENT_ID)).toBe(true)
    }
  })

  it('the ordinary inbox connect also lands on the panel surface — behaviour not regressed', async () => {
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('connected')
    expect(landsOnMetaPanel(res, CLIENT_ID)).toBe(true)
  })

  it('the redirect client id is the one from the verified signed state, never a raw request param', async () => {
    const stateClient = '22222222-2222-2222-2222-222222222222'
    mocks.verifyState.mockReturnValue({ clientId: stateClient, intent: 'publishing' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    // Path is built from the HMAC-verified clientId — this is what keeps it from
    // being an open redirect.
    expect(locationOf(res).pathname).toBe(`/dashboard/clients/${stateClient}`)
  })
})

describe('guards — a rejected callback must write nothing and leak nothing', () => {
  it('a forged/expired state never reaches token exchange or a DB write', async () => {
    mocks.verifyState.mockReturnValue(null)

    const res = await GET(makeRequest({ code: 'auth-code', state: 'tampered' }))

    expect(outcomeOf(res)).toBe('bad_state')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('a cancelled consent lands on denied without any exchange', async () => {
    const res = await GET(makeRequest({ error: 'access_denied' }))
    expect(outcomeOf(res)).toBe('denied')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('never puts a token or secret in the redirect the browser follows', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    const loc = res.headers.get('location') ?? ''

    expect(loc).not.toContain('page-token-xyz')
    expect(loc).not.toContain('long-token')
    expect(loc).not.toContain('app-secret-456')
  })
})
