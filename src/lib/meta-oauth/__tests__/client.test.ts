/**
 * The signed state is the only thing standing between "connect my Meta account
 * to my client" and "connect my Meta account to someone else's client" — the
 * callback trusts whatever client id comes back in it. So these tests care much
 * more about rejection than about the happy path.
 */

import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildState,
  verifyState,
  buildAuthUrl,
  exchangeMetaTokenFields,
  listGrantedScopes,
  META_PAGE_SCOPES,
  META_PUBLISH_SCOPE,
} from '../client'

beforeEach(() => {
  vi.stubEnv('FACEBOOK_APP_ID', 'app-id-123')
  vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret-456')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const CLIENT = '5a3fb2b7-72c3-471e-a5e7-1a528c0f776c'
const INPUT = { clientId: CLIENT, userId: 'operator-one', targetPageId: '778899' }

/** Sign an arbitrary base64url payload with the stubbed app secret, so a test
 *  can build a validly-signed state carrying fields buildState would not emit. */
function signPayload(payload: string): string {
  const sig = createHmac('sha256', 'app-secret-456').update(payload).digest('base64url')
  return `${payload}.${sig}`
}

describe('meta-oauth state', () => {
  it('round-trips the client id it was built with', () => {
    expect(verifyState(buildState(INPUT))).toEqual({ ...INPUT, nonce: expect.stringMatching(/^[0-9a-f]{32}$/) })
  })

  it('rejects a state whose payload was swapped for another client', () => {
    const state = buildState(INPUT)
    const sig = state.slice(state.lastIndexOf('.'))
    const forged = Buffer.from(
      JSON.stringify({ clientId: 'c0000000-0000-0000-0000-000000000000', exp: Date.now() + 60_000 }),
    ).toString('base64url')

    expect(verifyState(`${forged}${sig}`)).toBeNull()
  })

  it('rejects a state signed with a different app secret', () => {
    const state = buildState(INPUT)
    vi.stubEnv('FACEBOOK_APP_SECRET', 'someone-elses-secret')
    expect(verifyState(state)).toBeNull()
  })

  it('rejects a state past its ten-minute life', () => {
    vi.useFakeTimers()
    const state = buildState(INPUT)
    vi.advanceTimersByTime(11 * 60 * 1000)
    expect(verifyState(state)).toBeNull()
  })

  it('rejects malformed input instead of throwing', () => {
    expect(verifyState('')).toBeNull()
    expect(verifyState('no-dot-here')).toBeNull()
    expect(verifyState('not-base64.signature')).toBeNull()
  })

  it('round-trips the publishing intent when one is set', () => {
    expect(verifyState(buildState({ ...INPUT, intent: 'publishing' }))).toEqual({
      ...INPUT, nonce: expect.any(String),
      intent: 'publishing',
    })
  })

  it('an inbox state omits intent while retaining actor, browser nonce and target', () => {
    expect(verifyState(buildState(INPUT))).toEqual({ ...INPUT, nonce: expect.any(String) })
  })

  it('rejects an unrecognised intent rather than downgrading it to inbox access', () => {
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...INPUT, nonce: 'a'.repeat(32), exp: Date.now() + 60_000, intent: 'delete_everything' }),
    ).toString('base64url')
    // Validly signed — we are testing intent validation, not the HMAC.
    expect(verifyState(signPayload(forgedPayload))).toBeNull()
  })

  it('generates independent states even for two starts in the same millisecond', () => {
    vi.useFakeTimers()
    expect(buildState(INPUT)).not.toBe(buildState(INPUT))
  })

  it.each(['userId', 'nonce', 'targetPageId'])('rejects legacy or incomplete state missing %s', key => {
    const value: Record<string, unknown> = { ...INPUT, nonce: 'a'.repeat(32), exp: Date.now() + 60_000 }
    delete value[key]
    expect(verifyState(signPayload(Buffer.from(JSON.stringify(value)).toString('base64url')))).toBeNull()
  })

  it.each([
    { clientId: '../other' }, { userId: '' }, { nonce: 'short' },
    { targetPageId: 'not-a-page' }, { targetPageId: null, intent: 'publishing' },
    { exp: Date.now() + 3_600_000 }, { exp: null },
  ])('rejects invalid signed binding fields %j', fields => {
    const value = { ...INPUT, nonce: 'a'.repeat(32), exp: Date.now() + 60_000, ...fields }
    expect(verifyState(signPayload(Buffer.from(JSON.stringify(value)).toString('base64url')))).toBeNull()
  })
})

describe('meta-oauth consent url', () => {
  it('asks for pages_show_list — without it the Page never appears and sync reports no_page_token', () => {
    expect(META_PAGE_SCOPES).toContain('pages_show_list')
  })

  it('asks for pages_read_user_content — without it every comment read is refused with Graph #10', () => {
    expect(META_PAGE_SCOPES).toContain('pages_read_user_content')
  })

  it('asks for pages_manage_ads — Graph refuses to list leadgen_forms without it, even with leads_retrieval + pages_show_list (2026-08-30 production)', () => {
    expect(META_PAGE_SCOPES).toContain('pages_manage_ads')
    const url = new URL(buildAuthUrl('state-value', 'https://me.test/cb'))
    expect(url.searchParams.get('scope')).toContain('pages_manage_ads')
  })

  it('asks for leads_retrieval — without it meta-leads-sync lists zero forms and silently ingests nothing', () => {
    expect(META_PAGE_SCOPES).toContain('leads_retrieval')
    const url = new URL(buildAuthUrl('state-value', 'https://me.test/cb'))
    expect(url.searchParams.get('scope')).toContain('leads_retrieval')
  })

  it('asks for pages_manage_posts — the reauthorisation URL must request the publishing scope (#1152)', () => {
    expect(META_PAGE_SCOPES).toContain(META_PUBLISH_SCOPE)
    const url = new URL(buildAuthUrl('state-value', 'https://me.test/cb'))
    expect(url.searchParams.get('scope')).toContain(META_PUBLISH_SCOPE)
  })

  it('carries the state and the redirect back to Meta', () => {
    const url = new URL(buildAuthUrl('state-value', 'https://me.test/api/auth/facebook/callback'))
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('redirect_uri')).toBe('https://me.test/api/auth/facebook/callback')
    expect(url.searchParams.get('client_id')).toBe('app-id-123')
    expect(url.searchParams.get('scope')).toContain('pages_messaging')
  })

  it('never puts the app secret in the URL the browser will visit', () => {
    expect(buildAuthUrl('s', 'https://me.test/cb')).not.toContain('app-secret-456')
  })

  it('adds auth_type=rerequest only when asked — Meta hides an already-declined permission otherwise (#1152 P1)', () => {
    const ordinary = new URL(buildAuthUrl('s', 'https://me.test/cb'))
    expect(ordinary.searchParams.get('auth_type')).toBeNull()

    const rerequest = new URL(buildAuthUrl('s', 'https://me.test/cb', true))
    expect(rerequest.searchParams.get('auth_type')).toBe('rerequest')
  })
})

describe('listGrantedScopes — the provider-authoritative record of what was actually granted', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns only the scopes Meta marked granted, dropping declined ones', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'pages_messaging', status: 'granted' },
            { permission: 'pages_manage_posts', status: 'declined' },
          ],
        }),
      ),
    )

    const granted = await listGrantedScopes('user-token')
    expect(granted).toEqual(['pages_show_list', 'pages_messaging'])
    // The declined publishing permission must NOT appear — that is what lets the
    // callback fail closed instead of recording a publish-ready lie.
    expect(granted).not.toContain('pages_manage_posts')
  })

  it('returns null (not []) when the permissions call fails — "could not ask" ≠ "zero granted"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    expect(await listGrantedScopes('user-token')).toBeNull()
  })

  it('returns null when the network throws rather than surfacing the error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))
    expect(await listGrantedScopes('user-token')).toBeNull()
  })

  it('never puts the token in a place other than the query it must go in', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] })),
    )
    await listGrantedScopes('secret-user-token')
    const calledUrl = String(spy.mock.calls[0]?.[0])
    expect(calledUrl).toContain('/me/permissions')
    expect(calledUrl).toContain(encodeURIComponent('secret-user-token'))
  })
})

describe('exchangeMetaTokenFields — expires_in parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes an explicit expires_in:0 through as 0, not null — Meta uses 0 to mean "does not expire" (2026-09-21 production: real long-lived exchange came back 0, which the old ">0" check collapsed into "unknown" and failed the whole connect)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 0 })),
    )
    expect(await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })).toEqual({
      token: 'tok',
      seconds: 0,
    })
  })

  it('still returns null when expires_in is genuinely missing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok' })))
    expect(await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })).toEqual({
      token: 'tok',
      seconds: null,
    })
  })

  it('returns a positive expires_in unchanged', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 5184000 })),
    )
    expect(await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })).toEqual({
      token: 'tok',
      seconds: 5184000,
    })
  })

  it('logs the response shape (never the token/secret) when expires_in is unusable — the only way to see what Meta actually sent back on the next production failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'super-secret-token-xyz' })),
    )
    await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })
    expect(warn).toHaveBeenCalledWith(
      '[meta-oauth] token exchange expires_in unusable',
      expect.objectContaining({ hasExpiresInKey: false, responseKeys: ['access_token'] }),
    )
    const loggedArgs = warn.mock.calls[0]?.[1]
    expect(JSON.stringify(loggedArgs)).not.toContain('super-secret-token-xyz')
  })

  it('returns null and logs (without the query/secret) on a non-OK response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }))
    expect(await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })).toBeNull()
    expect(warn).toHaveBeenCalledWith('[meta-oauth] token exchange non-OK response', expect.objectContaining({ status: 400 }))
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('app-secret-456')
  })

  it('returns null and logs when access_token is missing from an OK response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'nope' })))
    expect(await exchangeMetaTokenFields({ code: 'c', redirect_uri: 'https://me.test/cb' })).toBeNull()
    expect(warn).toHaveBeenCalledWith('[meta-oauth] token exchange missing access_token', expect.objectContaining({ responseKeys: ['error'] }))
  })
})
