import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserPermissions: vi.fn(),
  grantSignupBonus: vi.fn(),
  resolveSelfServeLanding: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/auth/whitelist', () => ({
  getUserPermissions: mocks.getUserPermissions,
}))

vi.mock('@/lib/mtc/grant-signup-bonus', () => ({
  grantSignupBonus: mocks.grantSignupBonus,
}))

vi.mock('@/lib/auth/self-serve-routing', () => ({
  resolveSelfServeLanding: mocks.resolveSelfServeLanding,
}))

import { resolveRedirectForSession, INVITE_INVALID_REDIRECT } from '../resolve-redirect'

function authClient(email: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: email ? { email } : null } }),
    },
  }
}

function accessRows(rows: Array<{ client_id: string; access_type: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows }),
  }
}

function scanJobRow(id: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: id ? { id } : null }),
  }
}

describe('resolveRedirectForSession', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.getUserPermissions.mockReset()
    mocks.getUserPermissions.mockReturnValue(null)
    mocks.grantSignupBonus.mockReset()
    mocks.grantSignupBonus.mockResolvedValue(false)
    mocks.resolveSelfServeLanding.mockReset()
  })

  it('returns the safe path unchanged when no user is on the session', async () => {
    const redirect = await resolveRedirectForSession(authClient(null), '/dashboard')
    expect(redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('routes admins to dashboard without touching portal lookups or the bonus', async () => {
    mocks.getUserPermissions.mockReturnValue({ role: 'admin' })
    const redirect = await resolveRedirectForSession(authClient('admin@magiclab.com'), '/prospect')
    expect(redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('GRANTS the 500 MTC bonus for a self_serve user and returns the landing path', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-1', access_type: 'self_serve' }]))
    mocks.grantSignupBonus.mockResolvedValue(true)
    mocks.resolveSelfServeLanding.mockResolvedValue('/dashboard/clients/client-1/brief?welcome=1')

    const redirect = await resolveRedirectForSession(authClient('owner@biz.com'), '/portal')

    expect(mocks.grantSignupBonus).toHaveBeenCalledWith('client-1')
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('client-1', '/portal', true)
    expect(redirect).toBe('/dashboard/clients/client-1/brief?welcome=1')
  })

  it('still resolves the self_serve landing even when the bonus was already granted', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-1', access_type: 'self_serve' }]))
    mocks.grantSignupBonus.mockResolvedValue(false)
    mocks.resolveSelfServeLanding.mockResolvedValue('/dashboard/clients/client-1')

    const redirect = await resolveRedirectForSession(authClient('owner@biz.com'), '/dashboard')

    expect(mocks.grantSignupBonus).toHaveBeenCalledWith('client-1')
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('client-1', '/dashboard', false)
    expect(redirect).toBe('/dashboard/clients/client-1')
  })

  it('routes a plain portal user to their portal without granting a bonus', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-9', access_type: 'portal' }]))
    const redirect = await resolveRedirectForSession(authClient('viewer@biz.com'), '/dashboard')
    expect(redirect).toBe('/portal/client-9')
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('routes a dashboard-tier invite to the invited client, not the first row', async () => {
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-a', access_type: 'dashboard' },
      { client_id: 'client-b', access_type: 'fde' },
    ]))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe('/dashboard/clients/client-b')
  })

  it('preserves a deep dashboard link for a plain login (no expectedClientId)', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([
        { client_id: 'client-a', access_type: 'dashboard' },
      ]))
      .mockReturnValueOnce(scanJobRow(null))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard/clients/client-a/execution',
    )
    expect(redirect).toBe('/dashboard/clients/client-a/execution')
  })

  it('preserves a Meta Ads AI deep link even when the email has an old scan job', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([]))
      .mockReturnValueOnce(scanJobRow('scan-1'))

    const safePath = '/meta-ads-ai/a1000000-0000-4000-8000-000000000001'
    const redirect = await resolveRedirectForSession(authClient('lead@biz.com'), safePath)

    expect(redirect).toBe(safePath)
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('keeps an explicit /prospect next target for a prospect user', async () => {
    mocks.from.mockReturnValueOnce(accessRows([]))

    const redirect = await resolveRedirectForSession(authClient('lead@biz.com'), '/prospect')

    expect(redirect).toBe('/prospect')
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('routes a prospect (scan job, no access) to /prospect', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([]))
      .mockReturnValueOnce(scanJobRow('scan-1'))
    const redirect = await resolveRedirectForSession(authClient('lead@biz.com'), '/dashboard')
    expect(redirect).toBe('/prospect')
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('falls back to the safe path for a known email with no access and no scan', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([]))
      .mockReturnValueOnce(scanJobRow(null))
    const redirect = await resolveRedirectForSession(authClient('nobody@biz.com'), '/dashboard')
    expect(redirect).toBe('/dashboard')
  })

  // ── Fail-closed regressions (Build Control PR #1185 wrong-customer patch) ──

  it('FAILS CLOSED when the invite targets a client this email no longer holds, EVEN when it holds another client', async () => {
    // Wrong-customer break: invitee has membership only for client-a, but
    // the invite was for client-b (revoked mid-flight, or an older invite).
    // Must NOT return /dashboard (which middleware could redirect to
    // client-a) — must return the invite_invalid sentinel so the caller
    // refuses to persist the session.
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-a', access_type: 'dashboard' },
    ]))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe(INVITE_INVALID_REDIRECT)
    // Fail-closed must not silently mint a self_serve bonus either.
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED when the invite targets a client and this email holds NO memberships at all', async () => {
    // Row deleted between "invite sent" and "invite clicked". No fallback
    // to the safePath, no scan-job lookup, no /dashboard drift.
    mocks.from.mockReturnValueOnce(accessRows([]))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe(INVITE_INVALID_REDIRECT)
  })

  it('still returns the exact target client when the email DOES hold that membership', async () => {
    // Valid invite path stays green — this is the guardrail against
    // regressing the happy path with the fail-closed check.
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-a', access_type: 'dashboard' },
      { client_id: 'client-b', access_type: 'dashboard' },
    ]))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe('/dashboard/clients/client-b')
  })

  // ── Contract V3 §B: resolver's internal getUser fail-closed on invites ─

  it('FAILS CLOSED when the resolver internal getUser returns NO user, IF expectedClientId is present', async () => {
    // Defence-in-depth: even if some future caller skips the outer
    // invite-landing getUser gate, the resolver itself must never leak an
    // authenticated-but-identity-less invite into safePath = /dashboard.
    const redirect = await resolveRedirectForSession(
      authClient(null),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe(INVITE_INVALID_REDIRECT)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('preserves the safe-path behaviour for an ordinary session with no user (non-invite)', async () => {
    // The old contract for non-invite callers (session-route/verify-otp
    // that pass no expectedClientId) is to return safePath and let
    // middleware handle the redirect. That must not regress.
    const redirect = await resolveRedirectForSession(authClient(null), '/dashboard')
    expect(redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  // ── Contract V3 §A: portal-tier invite routes to the invited client ─

  it('routes a portal-tier invite to the invited client (not the first row) — mirror of dashboard-tier invariant', async () => {
    // Same-email/two-clients invariant on the portal path: an invite for
    // client-b must land in /portal/client-b, never /portal/client-a.
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-a', access_type: 'portal' },
      { client_id: 'client-b', access_type: 'portal' },
    ]))
    const redirect = await resolveRedirectForSession(
      authClient('viewer@biz.com'),
      '/dashboard',
      'client-b',
    )
    expect(redirect).toBe('/portal/client-b')
  })

  it('does NOT fail closed for an ordinary login (no expectedClientId) with the same shape', async () => {
    // Same accessRows as the first fail-closed test, but no expectedClientId
    // — this is a plain magic-link/OTP flow, must keep its existing
    // behaviour (dashboard-tier row for the single client this email holds).
    mocks.from
      .mockReturnValueOnce(accessRows([
        { client_id: 'client-a', access_type: 'dashboard' },
      ]))
      .mockReturnValueOnce(scanJobRow(null))
    const redirect = await resolveRedirectForSession(
      authClient('staff@biz.com'),
      '/dashboard',
    )
    expect(redirect).not.toBe(INVITE_INVALID_REDIRECT)
    // No expectedClientId → the pre-existing generic dashboard fallback stays.
    expect(redirect).toBe('/dashboard')
  })
})
