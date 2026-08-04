/**
 * The signed state is the only thing standing between "connect my Meta account
 * to my client" and "connect my Meta account to someone else's client" — the
 * callback trusts whatever client id comes back in it. So these tests care much
 * more about rejection than about the happy path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildState, verifyState, buildAuthUrl, META_PAGE_SCOPES } from '../client'

beforeEach(() => {
  vi.stubEnv('FACEBOOK_APP_ID', 'app-id-123')
  vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret-456')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const CLIENT = '5a3fb2b7-72c3-471e-a5e7-1a528c0f776c'

describe('meta-oauth state', () => {
  it('round-trips the client id it was built with', () => {
    expect(verifyState(buildState(CLIENT))).toEqual({ clientId: CLIENT })
  })

  it('rejects a state whose payload was swapped for another client', () => {
    const state = buildState(CLIENT)
    const sig = state.slice(state.lastIndexOf('.'))
    const forged = Buffer.from(
      JSON.stringify({ clientId: 'c0000000-0000-0000-0000-000000000000', exp: Date.now() + 60_000 }),
    ).toString('base64url')

    expect(verifyState(`${forged}${sig}`)).toBeNull()
  })

  it('rejects a state signed with a different app secret', () => {
    const state = buildState(CLIENT)
    vi.stubEnv('FACEBOOK_APP_SECRET', 'someone-elses-secret')
    expect(verifyState(state)).toBeNull()
  })

  it('rejects a state past its ten-minute life', () => {
    vi.useFakeTimers()
    const state = buildState(CLIENT)
    vi.advanceTimersByTime(11 * 60 * 1000)
    expect(verifyState(state)).toBeNull()
  })

  it('rejects malformed input instead of throwing', () => {
    expect(verifyState('')).toBeNull()
    expect(verifyState('no-dot-here')).toBeNull()
    expect(verifyState('not-base64.signature')).toBeNull()
  })
})

describe('meta-oauth consent url', () => {
  it('asks for pages_show_list — without it the Page never appears and sync reports no_page_token', () => {
    expect(META_PAGE_SCOPES).toContain('pages_show_list')
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
})
