// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildInstagramState, getInstagramConfig, instagramAuthUrl, readInstagramIdentity, refreshInstagramToken, verifyInstagramState } from '../client'
import { instagramOutcomeMessage, normalizeInstagramHandle } from '../identity'

const context = { clientId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', handle: 'example.syd' }
const now = new Date('2026-10-19T00:00:00Z')
const short = { access_token: 'short-test', user_id: '123456789012345678', permissions: 'instagram_business_basic' }
const long = { access_token: 'long-test', token_type: 'bearer', expires_in: 5184000 }
const me = { user_id: '987654321098765432', username: 'Example.Syd', id: 'app-scoped-other-id' }
function replies(...values: unknown[]) {
  const fetcher = vi.fn()
  values.forEach(value => fetcher.mockResolvedValueOnce({ ok: true, json: async () => value }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://me.example.test')
  vi.stubEnv('INSTAGRAM_LOGIN_ENABLED', 'true')
  vi.stubEnv('INSTAGRAM_APP_ID', '123456')
  vi.stubEnv('INSTAGRAM_APP_SECRET', 'synthetic-instagram-secret')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Instagram context and default-off configuration', () => {
  it.each([undefined, '', 'false', '1'])('is off unless explicitly true (%s)', flag => {
    vi.stubEnv('INSTAGRAM_LOGIN_ENABLED', flag)
    expect(getInstagramConfig()).toBeNull()
  })
  it.each(['http://me.example.test', 'https://u:p@me.example.test', 'https://me.example.test/path', 'https://me.example.test/?secret=x'])('rejects unsafe callback origin %s', origin => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
    expect(getInstagramConfig()).toBeNull()
  })
  it('does not fall back to the Facebook product credentials', () => {
    vi.stubEnv('INSTAGRAM_APP_SECRET', '')
    vi.stubEnv('FACEBOOK_APP_SECRET', 'not-for-instagram')
    expect(getInstagramConfig()).toBeNull()
  })
  it('uses the official product URL, exact callback and basic scope only', () => {
    const config = getInstagramConfig()!
    const auth = new URL(instagramAuthUrl(config, 'bound-state'))
    expect(auth.origin + auth.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(Object.fromEntries(auth.searchParams)).toEqual({ client_id: '123456', redirect_uri: 'https://me.example.test/api/auth/instagram/callback',
      response_type: 'code', scope: 'instagram_business_basic', state: 'bound-state' })
    expect(auth.toString()).not.toContain('secret')
  })
  it('asks for the publish scope too only while the publish switch is on', () => {
    vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true')
    const auth = new URL(instagramAuthUrl(getInstagramConfig()!, 'bound-state'))
    expect(auth.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish')
  })
  it('round trips client, actor and canonical handle with a unique nonce', () => {
    const state = buildInstagramState(context, 'secret')
    expect(verifyInstagramState(state, 'secret')).toMatchObject(context)
    expect(buildInstagramState(context, 'secret')).not.toBe(state)
    expect(verifyInstagramState(state, 'wrong')).toBeNull()
    expect(verifyInstagramState(state + '.extra', 'secret')).toBeNull()
    vi.advanceTimersByTime(600000)
    expect(verifyInstagramState(state, 'secret')).toBeNull()
  })
  it.each([{ purpose: 'other' }, { exp: now.getTime() + 601000 }, { userId: '' }, { handle: '@example.syd' }, { nonce: 'short' }])('rejects even correctly signed incomplete or cross-purpose state %j', patch => {
    const state = buildInstagramState(context, 'secret')
    const raw = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString())
    const body = Buffer.from(JSON.stringify({ ...raw, ...patch })).toString('base64url')
    expect(verifyInstagramState(`${body}.${createHmac('sha256', 'secret').update(body).digest('base64url')}`, 'secret')).toBeNull()
  })
  it.each(['@@name', 'name-with-hyphen', '.name', 'name.', 'a..b', 'a'.repeat(31), 'https://instagram.com/name'])('rejects invalid handle %s', value => expect(normalizeInstagramHandle(value)).toBeNull())
  it('normalizes one @, whitespace and case but never approximate matches', () => {
    expect(normalizeInstagramHandle(' @Example.Syd ')).toBe('example.syd')
    expect(instagramOutcomeMessage('raw-provider-error')).toBeNull()
    expect(instagramOutcomeMessage('__proto__')).toBeNull()
  })
})

describe('publish switch and the grant the user actually gave', () => {
  it('🔴 switch on + grant without publish permission → rejected (not saved as publishable)', async () => {
    vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true')
    replies(short, long, me) // short.permissions is basic only
    expect(await readInstagramIdentity('one-time-code', getInstagramConfig()!)).toBeNull()
  })
  it('switch on + grant with both → accepted', async () => {
    vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true')
    replies({ ...short, permissions: 'instagram_business_basic,instagram_business_content_publish' }, long, me)
    expect(await readInstagramIdentity('one-time-code', getInstagramConfig()!)).not.toBeNull()
  })
})

describe('official Instagram protocol boundary', () => {
  it.each([false, true])('reads a single %s wrapped identity, actual grants and provider expiry', async wrapped => {
    const actualShort = { ...short, permissions: 'instagram_business_basic,instagram_business_content_publish' }
    const fetcher = replies(wrapped ? { data: [actualShort] } : actualShort, long, wrapped ? { data: [me] } : me)
    const config = getInstagramConfig()!
    const result = await readInstagramIdentity('one-time-code', config)
    expect(result).toEqual({ accessToken: 'long-test', tokenExpiry: new Date(now.getTime() + 5184000000),
      accountId: me.user_id, username: 'example.syd', scopes: ['instagram_business_basic', 'instagram_business_content_publish'] })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.instagram.com/oauth/access_token')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
    expect(Object.fromEntries((init.body as FormData).entries())).toEqual({ client_id: config.appId, client_secret: config.secret,
      redirect_uri: config.redirectUri, grant_type: 'authorization_code', code: 'one-time-code' })
    expect(new URL(fetcher.mock.calls[1][0]).origin).toBe('https://graph.instagram.com')
    expect(fetcher.mock.calls[2][0]).toBe('https://graph.instagram.com/v26.0/me?fields=user_id,username')
    expect(fetcher.mock.calls[2][1]).toMatchObject({ headers: { Authorization: 'Bearer long-test' }, redirect: 'error' })
  })
  it.each([{}, { ...short, permissions: undefined }, { ...short, permissions: ['instagram_business_basic'] },
    { ...short, permissions: 'instagram_business_content_publish' }, { ...short, permissions: 'instagram_business_basic,' },
    { ...short, user_id: 9007199254740992 }, { ...short, access_token: 'bad token' },
    { data: [] }, { data: [short, short] }, { ...short, data: [short] }, { error: 'private-error', data: [short] }])('fails closed for malformed short exchange %j', async bad => {
    const fetcher = replies(bad)
    expect(await readInstagramIdentity('code', getInstagramConfig()!)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([0, -1, '5184000', 5184001, 1.5, null])('rejects invalid long token lifetime %j', async expires_in => {
    const fetcher = replies(short, { ...long, expires_in })
    expect(await readInstagramIdentity('code', getInstagramConfig()!)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([{ ...long, token_type: 'other' }, { ...long, access_token: '' }])('rejects malformed long tokens %j', async bad => {
    replies(short, bad)
    expect(await readInstagramIdentity('code', getInstagramConfig()!)).toBeNull()
  })
  it.each([{ id: '123456', username: 'example.syd' }, { ...me, user_id: 123456 }, { ...me, username: 'bad-name' },
    { data: [me, me] }, { data: [me], user_id: '123456' }])('never falls back to exchange ID or app-scoped id: %j', async bad => {
    replies(short, long, bad)
    expect(await readInstagramIdentity('code', getInstagramConfig()!)).toBeNull()
  })
  it('sanitizes network/provider failures and makes no follow-up requests', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-token-in-url')))
    expect(await readInstagramIdentity('code', getInstagramConfig()!)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(errorLog).not.toHaveBeenCalled()
    errorLog.mockRestore()
  })
})

describe('refreshInstagramToken (official ig_refresh_token)', () => {
  const ok = { access_token: 'renewed-test', token_type: 'bearer', expires_in: 5184000 }
  it('calls the official endpoint without the app secret and returns the new value and lifetime', async () => {
    const fetcher = replies(ok)
    expect(await refreshInstagramToken('old-test')).toEqual({ accessToken: 'renewed-test', expiresIn: 5184000 })
    const [url, init] = fetcher.mock.calls[0]
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/refresh_access_token')
    expect(Object.fromEntries(u.searchParams)).toEqual({ grant_type: 'ig_refresh_token', access_token: 'old-test' })
    expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' })
  })
  it.each([{ ...ok, token_type: 'basic' }, { ...ok, expires_in: 0 }, { ...ok, expires_in: 5184001 },
    { ...ok, expires_in: '5184000' }, { ...ok, access_token: '' }, { error: { message: 'x' } }, { data: [ok, ok] }])(
    'rejects an unusable response %j', async bad => {
      replies(bad)
      expect(await refreshInstagramToken('old-test')).toBeNull()
    })
  it('returns null (never throws, never leaks) when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://graph.instagram.com/refresh_access_token?access_token=old-test')))
    expect(await refreshInstagramToken('old-test')).toBeNull()
  })
  it('refuses an empty or oversized input without calling the provider', async () => {
    const fetcher = replies(ok)
    expect(await refreshInstagramToken('')).toBeNull()
    expect(await refreshInstagramToken('x'.repeat(9000))).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
