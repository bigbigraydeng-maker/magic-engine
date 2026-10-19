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
  requireDashboardClientAccess: vi.fn(),
  queryError: null as { message: string } | null,
  exchangeCode:               vi.fn(),
  exchangeForLongLivedToken:  vi.fn(),
  listPagesWithTokens:        vi.fn(),
  listGrantedScopes:          vi.fn(),
  upsertConnection:           vi.fn(),
  upsertCalls:                [] as Array<Record<string, unknown>>,
  boundPageId:                '1616575215312482' as string | null,
  factoryConfig:              { publish_target: { platform: 'facebook', page_id: '1616575215312482' } } as unknown,
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

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.requireDashboardClientAccess }))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: (input: Record<string, unknown>) => {
    mocks.upsertCalls.push(input)
    return mocks.upsertConnection(input)
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: { facebook_page_id: mocks.boundPageId, factory_config: mocks.factoryConfig },
              error: mocks.queryError,
            }),
          ),
        })),
      })),
    })),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'
import { META_STATE_COOKIE } from '@/lib/meta-oauth/client'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PAGE_ID = '1616575215312482'
const BINDING = { clientId: CLIENT_ID, userId: 'operator-one', targetPageId: PAGE_ID, nonce: 'a'.repeat(32) }

function makeRequest(params: { code?: string; state?: string; error?: string; cookie?: string | null }) {
  const url = new URL('http://localhost:3001/api/auth/facebook/callback')
  if (params.code)  url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  if (params.error) url.searchParams.set('error', params.error)
  const req = new NextRequest(url)
  const cookie = params.cookie === undefined ? params.state : params.cookie
  if (cookie) req.cookies.set(META_STATE_COOKIE, cookie)
  return req
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
  mocks.queryError = null
  mocks.requireDashboardClientAccess.mockResolvedValue({ ok: true, user: { id: BINDING.userId } })
  mocks.boundPageId = PAGE_ID
  mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: PAGE_ID } }
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  process.env.FACEBOOK_APP_SECRET = 'app-secret-456'
  mocks.verifyState.mockReturnValue({ ...BINDING })
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
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_manage_posts',
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
  })

  it('reports publish_not_granted AND stores scopes without pages_manage_posts when Meta declines it', async () => {
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
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
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
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
    mocks.verifyState.mockReturnValue({ ...BINDING, targetPageId: PUBLISH_PAGE, intent: 'publishing' })
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
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
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

describe('every outcome returns to the surface that renders FacebookPagePanel (#1152 P1-2)', () => {
  it('all three publishing outcomes land on the ?settings=platform drawer, not the panel-less /settings route', async () => {
    const cases: Array<{ granted: string[] | null; expect: string }> = [
      { granted: ['pages_show_list', 'pages_manage_posts'], expect: 'publish_ready' },
      { granted: ['pages_show_list'], expect: 'publish_not_granted' },
      { granted: null, expect: 'verify_failed' },
    ]

    for (const c of cases) {
      mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
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
    mocks.verifyState.mockReturnValue({ ...BINDING, clientId: stateClient, intent: 'publishing' })

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
    const res = await GET(makeRequest({ error: 'access_denied', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('denied')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(landsOnMetaPanel(res, CLIENT_ID)).toBe(true)
    expect(res.cookies.get(META_STATE_COOKIE)?.value).toBe('')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(res.headers.get('set-cookie')).toContain('Path=/api/auth/facebook')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it.each([null, 'another-browser-state'])('rejects a missing or mismatched browser cookie %s', async cookie => {
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state', cookie }))
    expect(outcomeOf(res)).toBe('bad_state')
    expect(locationOf(res).pathname).toBe('/dashboard')
    expect(mocks.verifyState).not.toHaveBeenCalled()
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
    expect(res.cookies.get(META_STATE_COOKIE)).toBeUndefined()
  })

  it('untrusted cancellation cannot choose a customer or bypass state checks', async () => {
    const res = await GET(makeRequest({ error: 'access_denied' }))
    expect(outcomeOf(res)).toBe('bad_state')
    expect(locationOf(res).pathname).toBe('/dashboard')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('an old attempt cannot erase the newer attempt in the same browser', async () => {
    const old = await GET(makeRequest({ code: 'old-code', state: 'old-state', cookie: 'sig.state' }))
    expect(outcomeOf(old)).toBe('bad_state')
    expect(old.headers.get('set-cookie')).toBeNull()
    const current = await GET(makeRequest({ code: 'current-code', state: 'sig.state' }))
    expect(outcomeOf(current)).toBe('connected')
    expect(mocks.exchangeCode).toHaveBeenCalledExactlyOnceWith('current-code', expect.any(String))
  })

  it.each([401, 403, 500])('rejects a missing or revoked customer session (%s)', async status => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status, error: 'private guard detail' })
    for (const params of [{ code: 'auth-code' }, { error: 'access_denied' }]) {
      const res = await GET(makeRequest({ ...params, state: 'sig.state' }))
      expect(outcomeOf(res)).toBe('bad_state')
      expect(locationOf(res).pathname).toBe('/dashboard')
      expect(res.headers.get('location')).not.toContain('private guard detail')
    }
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('rejects an operator switch even if both operators can access the client', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: true, user: { id: 'operator-two' } })
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('bad_state')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('rejects a changed publishing Page even when the grant includes both Pages', async () => {
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: '999888777' } }
    mocks.listPagesWithTokens.mockResolvedValue([
      { pageId: PAGE_ID, pageName: 'Original', pageToken: 'original-token' },
      { pageId: '999888777', pageName: 'Replacement', pageToken: 'replacement-token' },
    ])
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('verify_failed')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('rejects a changed inbox target and a failed target lookup before any exchange', async () => {
    mocks.boundPageId = '999888777'
    const changed = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(changed)).toBe('verify_failed')
    mocks.boundPageId = PAGE_ID
    mocks.queryError = { message: 'private target lookup error' }
    const failed = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(failed)).toBe('verify_failed')
    expect(failed.headers.get('location')).not.toContain('private target lookup error')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it.each(['target', 'revoked', 'actor', 'lookup'])('rejects %s changes during provider calls before persistence', async change => {
    mocks.listGrantedScopes.mockImplementationOnce(async () => {
      if (change === 'target') mocks.boundPageId = '999888777'
      if (change === 'revoked') mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403 })
      if (change === 'actor') mocks.requireDashboardClientAccess.mockResolvedValue({ ok: true, user: { id: 'operator-two' } })
      if (change === 'lookup') mocks.queryError = { message: 'private query failure' }
      return ['pages_show_list', 'pages_manage_posts']
    })
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe(['revoked', 'actor'].includes(change) ? 'bad_state' : 'verify_failed')
    expect(res.cookies.get(META_STATE_COOKIE)?.value).toBe('')
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('returns a safe failure and consumes this attempt when persistence throws', async () => {
    mocks.upsertConnection.mockRejectedValueOnce(new Error('private database detail with page-token-xyz'))
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('verify_failed')
    expect(res.cookies.get(META_STATE_COOKIE)?.value).toBe('')
    expect(res.headers.get('location')).not.toContain('page-token-xyz')
    expect(res.headers.get('location')).not.toContain('private database detail')
  })

  it('never puts a token or secret in the redirect the browser follows', async () => {
    mocks.verifyState.mockReturnValue({ ...BINDING, intent: 'publishing' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    const loc = res.headers.get('location') ?? ''

    expect(loc).not.toContain('page-token-xyz')
    expect(loc).not.toContain('long-token')
    expect(loc).not.toContain('app-secret-456')
  })
})
