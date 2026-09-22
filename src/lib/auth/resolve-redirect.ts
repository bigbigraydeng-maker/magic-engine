import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { grantSignupBonus } from '@/lib/mtc/grant-signup-bonus'
import { resolveSelfServeLanding } from '@/lib/auth/self-serve-routing'

/**
 * Sentinel returned when an invite specifies expectedClientId but the
 * authenticated email has no matching membership row for it. Callers MUST
 * detect this and refuse to complete the redirect — otherwise middleware
 * downstream would land the invitee inside whichever other client this
 * email happens to belong to.
 */
export const INVITE_INVALID_REDIRECT = '__INVITE_INVALID__' as const

/**
 * Minimal shape of a Supabase auth client we depend on. Both the SSR server
 * client (cookie-backed) and any future client satisfy this — we only call
 * getUser().
 */
interface AuthCapableClient {
  auth: {
    getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>
  }
}

/**
 * Resolves the correct post-authentication redirect for an already-authenticated
 * Supabase session, and (for self_serve clients) grants the 500 MTC welcome bonus.
 *
 * This is the single source of truth shared by:
 *   - GET /api/auth/session-route   (browser cookie session after magic-link / Google)
 *   - POST /api/auth/verify-otp     (6-digit signup code flow — P0-B)
 *
 * grantSignupBonus is idempotent (email-canonical dedup + email_verified_at
 * stamp), so calling it from whichever path completes first is safe.
 *
 * Returns the redirect path only — callers decide the response envelope.
 */
export async function resolveRedirectForSession(
  supabase: AuthCapableClient,
  safePath: string,
  expectedClientId?: string,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    // Directed invite whose second-read (this getUser) sees no identity
    // MUST fail closed. Falling through to safePath (`/dashboard` for the
    // invite-landing flow) would let /dashboard middleware pick whichever
    // OTHER client this email happens to hold membership in — a wrong-
    // customer break. Ordinary non-invite flows (no expectedClientId) keep
    // the pre-existing behaviour of returning safePath and letting
    // middleware handle the unauthenticated redirect.
    if (expectedClientId) return INVITE_INVALID_REDIRECT
    return safePath
  }

  const email = user.email.toLowerCase()

  const adminPerms = getUserPermissions(email)
  if (adminPerms?.role === 'admin') {
    return safePath.startsWith('/dashboard') ? safePath : '/dashboard'
  }

  // Non-admin portal users take priority
  const { data: accessRows } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type')
    .eq('email', email)

  // A specific-client invite (e.g. /auth/invite-landing) must only land the
  // invitee in the client it actually invited them to — the same email can
  // hold rows for several clients ((email, client_id) is not unique per
  // email), so without this an invite to client B could land in client A.
  const candidateRows = expectedClientId
    ? accessRows?.filter(row => row.client_id === expectedClientId)
    : accessRows

  // Fail closed for invites whose target membership is missing. The token
  // may have verified fine, but between "invite sent" and "invite clicked"
  // the client_portal_users row can be revoked (or the invite was for a
  // different client_id than any row this email holds). Falling through to
  // `/dashboard` here would let /dashboard middleware pick some OTHER
  // client this email happens to belong to — a wrong-customer break.
  if (expectedClientId && (!candidateRows || candidateRows.length === 0)) {
    return INVITE_INVALID_REDIRECT
  }

  const selfServeUser = candidateRows?.find(row => row.access_type === 'self_serve')
  const portalUser = candidateRows?.find(row =>
    row.access_type === 'portal' || row.access_type === 'both'
  )
  const dashboardUser = candidateRows?.find(row =>
    row.access_type === 'dashboard' || row.access_type === 'fde' || row.access_type === 'client'
  )

  if (selfServeUser?.client_id) {
    // Grant 500 MTC welcome bonus on first verification for self_serve clients.
    // Idempotent — safe across the magic-link, Google, and OTP paths.
    const bonusGranted = await grantSignupBonus(selfServeUser.client_id).catch(() => false)
    return resolveSelfServeLanding(selfServeUser.client_id, safePath, bonusGranted)
  }

  if (portalUser?.client_id) {
    return `/portal/${portalUser.client_id}`
  }

  // A dashboard/fde/client invite must land in the invited client's own
  // dashboard — otherwise middleware falls back to the unsorted first row
  // in client_portal_users, which can be a *different* client when the same
  // email holds access to more than one. Only force this override for the
  // expectedClientId invite flow: a plain magic-link/OTP login's safePath
  // (e.g. /dashboard/clients/<id>/execution) has already passed the
  // /dashboard/:path* middleware's per-client access check, so overriding
  // it here would silently drop the deep link and bounce the user to their
  // client's home page instead.
  if (dashboardUser?.client_id && expectedClientId) {
    return `/dashboard/clients/${dashboardUser.client_id}`
  }

  // Honour explicit /prospect next param (magic link from /discover)
  if (safePath === '/prospect') {
    return '/prospect'
  }

  // Meta Ads AI is an authenticated deep link. A user may also have an old
  // public scan, but that historical record must not override the page they
  // explicitly asked to return to after login. Portal/dashboard membership
  // routing above keeps its existing priority.
  if (safePath.startsWith('/meta-ads-ai/')) {
    return safePath
  }

  // Prospects: have a public_scan_jobs record but no portal/dashboard access
  const { data: scanJob } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  if (scanJob?.id) {
    return '/prospect'
  }

  return safePath
}
