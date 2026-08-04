/**
 * P0-J PR-2 tests for normalizeSelfServeTarget (魏征 CRITICAL #4 close).
 *
 * The function is the first line of defence against a self_serve user
 * landing on someone else's client page via `?next=...`. Middleware is the
 * second line, but if normalizeSelfServeTarget echoes a foreign path back,
 * /auth/callback will redirect there before middleware ever sees it.
 */

import { describe, it, expect } from 'vitest'
import { normalizeSelfServeTarget } from '../self-serve-routing'

const MY_CLIENT = '11111111-1111-1111-1111-111111111111'
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222'
const MY_HOME = `/dashboard/clients/${MY_CLIENT}`

describe('normalizeSelfServeTarget — path traversal close', () => {
  it('empty / root falls back to own client home', () => {
    expect(normalizeSelfServeTarget(MY_CLIENT, '')).toBe(MY_HOME)
    expect(normalizeSelfServeTarget(MY_CLIENT, '/dashboard')).toBe(MY_HOME)
    expect(normalizeSelfServeTarget(MY_CLIENT, '/prospect')).toBe(MY_HOME)
    expect(normalizeSelfServeTarget(MY_CLIENT, '/portal')).toBe(MY_HOME)
  })

  it('keeps the deep path under own client untouched', () => {
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/dashboard/clients/${MY_CLIENT}/brief`),
    ).toBe(`${MY_HOME}/brief`)
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/dashboard/clients/${MY_CLIENT}/blog/abc?foo=1`),
    ).toBe(`${MY_HOME}/blog/abc?foo=1`)
  })

  it('rewrites another client id to the caller\'s own id (path traversal close)', () => {
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/dashboard/clients/${OTHER_CLIENT}/execution`),
    ).toBe(`${MY_HOME}/execution`)
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/dashboard/clients/${OTHER_CLIENT}/wallet?tab=topup`),
    ).toBe(`${MY_HOME}/wallet?tab=topup`)
  })

  it('strips /portal/{x} prefix and remaps onto own client', () => {
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/portal/${OTHER_CLIENT}/brief`),
    ).toBe(`${MY_HOME}/brief`)
    expect(
      normalizeSelfServeTarget(MY_CLIENT, `/portal/whatever`),
    ).toBe(MY_HOME) // suffix empty
  })

  it('kicks /dashboard/admin/* back to own client home', () => {
    expect(
      normalizeSelfServeTarget(MY_CLIENT, '/dashboard/admin/users'),
    ).toBe(MY_HOME)
    expect(
      normalizeSelfServeTarget(MY_CLIENT, '/dashboard/admin/billing-monitor'),
    ).toBe(MY_HOME)
    expect(
      normalizeSelfServeTarget(MY_CLIENT, '/dashboard/industry-baselines'),
    ).toBe(MY_HOME)
  })

  it('refuses unknown roots and falls back to own client home', () => {
    expect(normalizeSelfServeTarget(MY_CLIENT, '/some-other-app')).toBe(MY_HOME)
    expect(normalizeSelfServeTarget(MY_CLIENT, '/api/admin/users')).toBe(MY_HOME)
    expect(normalizeSelfServeTarget(MY_CLIENT, 'http://evil.example')).toBe(MY_HOME)
  })
})
