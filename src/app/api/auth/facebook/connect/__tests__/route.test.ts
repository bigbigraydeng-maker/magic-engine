/**
 * Anyone who can reach this URL could otherwise start a consent flow that
 * attaches their Meta account to a client they have no business touching. The
 * tenant guard is the whole point, so these tests care most about rejection —
 * plus one check that the #1152 publishing intent actually reaches the state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  factoryConfig: { publish_target: { platform: 'facebook', page_id: '778899' } } as unknown,
  queryError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { facebook_page_id: '778899', factory_config: mocks.factoryConfig }, error: mocks.queryError }),
          ),
        })),
      })),
    })),
  },
}))

import { GET } from '../route'
import { verifyState, META_STATE_COOKIE } from '@/lib/meta-oauth/client'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

function makeRequest(params: { clientId?: string; intent?: string; rerequest?: string }) {
  const url = new URL('http://localhost:3001/api/auth/facebook/connect')
  if (params.clientId) url.searchParams.set('client_id', params.clientId)
  if (params.intent)   url.searchParams.set('intent', params.intent)
  if (params.rerequest) url.searchParams.set('rerequest', params.rerequest)
  return new NextRequest(url)
}

function adminAccess() {
  return { ok: true as const, user: { id: 'operator-one', email: 'admin@test.com' }, role: 'admin' as const, tier: 'admin' as const, allowedClientId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_ID = 'app-id-123'
  process.env.FACEBOOK_APP_SECRET = 'app-secret-456'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
  mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: '778899' } }
  mocks.queryError = null
})

describe('tenant isolation — no unauthenticated / cross-tenant reauthorisation', () => {
  it('rejects when the caller has no access to this client, without redirecting to Meta', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull() // never issued a redirect to Meta
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID }))

    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('gates the reauthorisation on the exact client id from the URL', async () => {
    await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))
    expect(mocks.requireDashboardClientAccess).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('returns 400 when client_id is missing', async () => {
    const res = await GET(makeRequest({ intent: 'publishing' }))
    expect(res.status).toBe(400)
  })
})

describe('publishing intent reaches the signed state and requests the publishing scope', () => {
  it('intent=publishing round-trips into the state, asks for pages_manage_posts, and forces rerequest', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    expect(res.status).toBe(307)
    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.hostname).toContain('facebook.com')
    expect(authUrl.searchParams.get('scope')).toContain('pages_manage_posts')
    // Without rerequest, a permission the user already declined once is silently
    // omitted from the consent screen — reauth could never recover publishing.
    expect(authUrl.searchParams.get('auth_type')).toBe('rerequest')

    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID, userId: 'operator-one', targetPageId: '778899', nonce: expect.any(String), intent: 'publishing' })
    expect(res.cookies.get(META_STATE_COOKIE)?.value).toBe(state)
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
    expect(res.headers.get('set-cookie')).toContain('Secure')
    expect(res.headers.get('set-cookie')).toContain('SameSite=lax')
    expect(res.headers.get('set-cookie')).toContain('Path=/api/auth/facebook')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=600')
  })

  it('a plain connect (no intent) carries no intent and no rerequest — inbox flow unchanged', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.searchParams.get('auth_type')).toBeNull()
    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID, userId: 'operator-one', targetPageId: '778899', nonce: expect.any(String) })
  })

  it('ignores an unrecognised intent value rather than trusting it', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'delete_everything' }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID, userId: 'operator-one', targetPageId: '778899', nonce: expect.any(String) })
  })

  it('rerequest=1 forces auth_type=rerequest without changing intent, state or scopes (comment-reply reauthorisation entry)', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, rerequest: '1' }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.searchParams.get('auth_type')).toBe('rerequest')
    expect(authUrl.searchParams.get('scope')).toContain('pages_manage_engagement')

    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID, userId: 'operator-one', targetPageId: '778899', nonce: expect.any(String) })
  })

  it('any rerequest value other than 1 is ignored', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, rerequest: 'true' }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.searchParams.get('auth_type')).toBeNull()
  })

  it('rerequest=1 still requires access to the client — rejected callers never reach Meta', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID, rerequest: '1' }))

    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull() // never issued a redirect to Meta
  })
})

describe('publishing reauth must not even start without a valid Facebook publish target (#1152 P1)', () => {
  it('fails closed to the panel with no_publish_target when no publish target is configured — never reaches Meta', async () => {
    mocks.factoryConfig = {} // no publish_target

    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    const url = new URL(res.headers.get('location') ?? '')
    expect(url.hostname).not.toContain('facebook.com')
    expect(url.pathname).toBe(`/dashboard/clients/${CLIENT_ID}`)
    expect(url.searchParams.get('settings')).toBe('platform')
    expect(url.searchParams.get('meta')).toBe('no_publish_target')
  })

  it('fails closed when the publish target is a non-Facebook platform', async () => {
    mocks.factoryConfig = { publish_target: { platform: 'instagram', page_id: '778899' } }

    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    const url = new URL(res.headers.get('location') ?? '')
    expect(url.hostname).not.toContain('facebook.com')
    expect(url.searchParams.get('meta')).toBe('no_publish_target')
  })

  it('proceeds to Meta when a valid Facebook publish target exists', async () => {
    mocks.factoryConfig = { publish_target: { platform: 'facebook', page_id: '778899' } }

    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    expect(new URL(res.headers.get('location') ?? '').hostname).toContain('facebook.com')
  })

  it('ordinary inbox connect never consults the publish target — not regressed', async () => {
    mocks.factoryConfig = {} // even with no publish target...
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    // ...a plain connect still proceeds to Meta (inbox anchored to facebook_page_id).
    expect(new URL(res.headers.get('location') ?? '').hostname).toContain('facebook.com')
  })

  it('does not start consent when the server target lookup fails', async () => {
    mocks.queryError = { message: 'private database failure' }
    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('meta')).toBe('verify_failed')
    expect(res.cookies.get(META_STATE_COOKIE)).toBeUndefined()
    expect(res.headers.get('location')).not.toContain('private database failure')
  })
})
