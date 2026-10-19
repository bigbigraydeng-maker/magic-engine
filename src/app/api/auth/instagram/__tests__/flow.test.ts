// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), single: vi.fn(), eq: vi.fn(), select: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ upsertConnection: mocks.upsert }))
import { GET as start } from '../connect/route'
import { GET as callback } from '../callback/route'
import { INSTAGRAM_STATE_COOKIE, buildInstagramState } from '@/lib/instagram-oauth/client'

const clientId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const secret = 'synthetic-secret'
let fetcher: ReturnType<typeof vi.fn>
const request = () => new NextRequest(`https://me.example.test/api/auth/instagram/connect?client_id=${clientId}`)
function consent(state = buildInstagramState({ clientId, userId, handle: 'example' }, secret), params = 'code=synthetic-code', cookie = state) {
  return new NextRequest(`https://me.example.test/api/auth/instagram/callback?${params}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `${INSTAGRAM_STATE_COOKIE}=${cookie}` },
  })
}
const outcome = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('instagram')
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://me.example.test')
  vi.stubEnv('INSTAGRAM_LOGIN_ENABLED', 'true'); vi.stubEnv('INSTAGRAM_APP_ID', '123456'); vi.stubEnv('INSTAGRAM_APP_SECRET', secret)
  mocks.access.mockResolvedValue({ ok: true, user: { id: userId } })
  mocks.from.mockReturnValue({ select: mocks.select }); mocks.select.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockReturnValue({ maybeSingle: mocks.single })
  mocks.single.mockResolvedValue({ data: { instagram_handle: ' @Example ' }, error: null })
  mocks.upsert.mockResolvedValue(undefined)
  fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ access_token: 'short-test', user_id: '123456', permissions: 'instagram_business_basic' }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'long-test', token_type: 'bearer', expires_in: 5184000 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ user_id: '987654321098765432', username: 'Example' }] }) })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Instagram actual handlers / state and cookie boundary', () => {
  it('passes the real start response state/cookie through callback and saves only the verified identity', async () => {
    const begun = await start(request())
    const state = new URL(begun.headers.get('location')!).searchParams.get('state')!
    expect(begun.cookies.get(INSTAGRAM_STATE_COOKIE)?.value).toBe(state)
    expect(begun.headers.get('set-cookie')).toMatch(/Path=\/api\/auth\/instagram;.*Secure; HttpOnly; SameSite=lax/)
    const response = await callback(consent(state))
    expect(outcome(response)).toBe('connected')
    expect(response.headers.get('location')).toContain(`/clients/${clientId}/settings?tab=content&section=social-connections`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.access).toHaveBeenCalledTimes(3)
    expect(mocks.eq.mock.calls.every(call => call[0] === 'id' && call[1] === clientId)).toBe(true)
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientId, provider: 'instagram', purpose: 'legacy',
      accountId: '987654321098765432', locationName: 'example', displayName: '@example', accessToken: 'long-test', refreshToken: '',
      authorizingPrincipalId: userId, scopes: ['instagram_business_basic'] }))
  })
  it.each([401, 403, 500])('denies unauthorised start %s before DB/network', async status => {
    mocks.access.mockResolvedValue({ ok: false, status, error: 'Access denied' })
    expect((await start(request())).status).toBe(status)
    expect(mocks.from).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('default-off prevents DB reads, redirects or provider exchange at both ends', async () => {
    const req = consent()
    vi.stubEnv('INSTAGRAM_LOGIN_ENABLED', 'false')
    expect(outcome(await start(request()))).toBe('unavailable')
    expect(outcome(await callback(req))).toBe('bad_state')
    expect(mocks.from).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it.each([null, 'bad-handle', '@@example'])('rejects missing/invalid target %s before official consent', async instagram_handle => {
    mocks.single.mockResolvedValue({ data: { instagram_handle }, error: null })
    expect(outcome(await start(request()))).toBe('target_missing')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves a newer browser attempt when an old callback arrives', async () => {
    const response = await callback(consent(undefined, 'error=access_denied', 'newer-state'))
    expect(outcome(response)).toBe('bad_state')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.access).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects HMAC tampering even when attacker controls the cookie', async () => {
    const state = buildInstagramState({ clientId, userId, handle: 'example' }, secret) + 'x'
    expect(outcome(await callback(consent(state)))).toBe('bad_state')
    expect(mocks.access).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['actor', 'access'])('rejects changed %s before handling cancellation', async variant => {
    mocks.access.mockResolvedValue(variant === 'actor' ? { ok: true, user: { id: 'other' } } : { ok: false, status: 403 })
    const response = await callback(consent(undefined, 'error=access_denied&client_id=other'))
    expect(outcome(response)).toBe('bad_state')
    expect(response.headers.get('location')).not.toContain(`/clients/${clientId}`)
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns trusted cancellation to the original client, not query targets, with no provider or DB writes', async () => {
    const response = await callback(consent(undefined, 'error=access_denied&client_id=other&error_description=private-error'))
    expect(outcome(response)).toBe('denied')
    expect(response.headers.get('location')).toContain(`/clients/${clientId}/settings`)
    expect(response.headers.get('location')).not.toContain('private-error')
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('rejects a target changed before exchange', async () => {
    mocks.single.mockResolvedValue({ data: { instagram_handle: 'another' }, error: null })
    expect(outcome(await callback(consent()))).toBe('target_changed')
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('does not save a different authorised Instagram username', async () => {
    fetcher.mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'short', user_id: '123456', permissions: 'instagram_business_basic' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'long', token_type: 'bearer', expires_in: 5184000 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user_id: '987654', username: 'other' }) })
    expect(outcome(await callback(consent()))).toBe('account_mismatch')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it.each(['actor', 'access', 'target', 'flag', 'credentials'])('rechecks %s after provider waits, never overwrites prior grant', async variant => {
    if (variant === 'actor') mocks.access.mockResolvedValueOnce({ ok: true, user: { id: userId } }).mockResolvedValueOnce({ ok: true, user: { id: 'other' } })
    if (variant === 'access') mocks.access.mockResolvedValueOnce({ ok: true, user: { id: userId } }).mockResolvedValueOnce({ ok: false, status: 403 })
    if (variant === 'target') mocks.single.mockResolvedValueOnce({ data: { instagram_handle: 'example' }, error: null })
      .mockResolvedValueOnce({ data: { instagram_handle: 'other' }, error: null })
    if (variant === 'flag' || variant === 'credentials') {
      fetcher.mockReset().mockImplementationOnce(async () => {
        vi.stubEnv(variant === 'flag' ? 'INSTAGRAM_LOGIN_ENABLED' : 'INSTAGRAM_APP_SECRET', variant === 'flag' ? 'false' : 'rotated')
        return { ok: true, json: async () => ({ access_token: 'short', user_id: '123456', permissions: 'instagram_business_basic' }) }
      }).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'long', token_type: 'bearer', expires_in: 5184000 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ user_id: '987654', username: 'example' }) })
    }
    expect(outcome(await callback(consent()))).not.toBe('connected')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it.each(['db-read', 'db-write', 'provider'])('returns finite feedback without raw %s errors', async source => {
    if (source === 'db-read') mocks.single.mockResolvedValue({ data: null, error: { message: 'private-db-error' } })
    if (source === 'db-write') mocks.upsert.mockRejectedValue(new Error('private-db-error'))
    if (source === 'provider') fetcher.mockReset().mockRejectedValue(new Error('private-access-token'))
    const response = await callback(consent())
    expect(outcome(response)).toBe('verify_failed')
    expect(response.headers.get('location')).not.toContain('private-')
  })
  it.each(['flag', 'state-expiry', 'token-expiry'])('rechecks %s after the FINAL target DB wait, with no persistence', async variant => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    fetcher.mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'short', user_id: '123456', permissions: 'instagram_business_basic' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'long', token_type: 'bearer', expires_in: variant === 'token-expiry' ? 1 : 5184000 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user_id: '987654', username: 'example' }) })
    mocks.single.mockResolvedValueOnce({ data: { instagram_handle: 'example' }, error: null })
      .mockImplementationOnce(async () => {
        if (variant === 'flag') vi.stubEnv('INSTAGRAM_LOGIN_ENABLED', 'false')
        else clock.mockReturnValue(now + (variant === 'state-expiry' ? 600001 : 2000))
        return { data: { instagram_handle: 'example' }, error: null }
      })
    const response = await callback(consent())
    expect(outcome(response)).toBe(variant === 'flag' ? 'unavailable' : 'bad_state')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
