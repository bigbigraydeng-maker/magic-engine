import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { grantSignupBonus } from '@/lib/mtc/grant-signup-bonus'
import { resolveSelfServeLanding } from '@/lib/auth/self-serve-routing'

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
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    // Session not readable — let middleware handle the unauthenticated redirect.
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

  const selfServeUser = accessRows?.find(row => row.access_type === 'self_serve')
  const portalUser = accessRows?.find(row =>
    row.access_type === 'portal' || row.access_type === 'both'
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

  // Honour explicit /prospect next param (magic link from /discover)
  if (safePath === '/prospect') {
    return '/prospect'
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
