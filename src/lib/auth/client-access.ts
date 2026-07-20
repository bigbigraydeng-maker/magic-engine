import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getUserPermissions, type UserRole } from '@/lib/auth/whitelist'
import {
  ACCESS_TYPES_DASHBOARD,
  tierForAccessType,
  type AccessTier,
  type AccessType,
} from '@/lib/auth/access-types'

/**
 * Phase X.S2 — Result now carries a semantic `tier` field used by
 * requirePaidClientAccess to gate functional features. Existing callers
 * that read `role` continue to work (admin → admin, everyone else →
 * 'client-viewer'); new code should read `tier` instead.
 */
export type ClientAccessResult =
  | {
      ok: true
      user: User
      role: UserRole
      tier: AccessTier
      allowedClientId: string | null
    }
  | {
      ok: false
      status: 401 | 402 | 403 | 500
      error: string
      /** Machine-readable failure reason for frontend dispatch. */
      reason?: 'unauthorized' | 'forbidden' | 'paid_only' | 'lookup_failed'
    }

export async function requireDashboardClientAccess(
  clientId: string,
): Promise<ClientAccessResult> {
  const session = await requireSession()
  if (!session.ok) return session

  const email = (session.user.email ?? '').toLowerCase().trim()
  const envPerms = getUserPermissions(email)

  if (envPerms?.role === 'admin') {
    return {
      ok: true,
      user: session.user,
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    }
  }

  const dbAccess = await getDashboardAccessForEmail(email)
  if (!dbAccess.ok) return dbAccess

  // Find the row matching this clientId so we can determine its tier.
  const row = dbAccess.rows.find((r) => r.clientId === clientId)
  if (!row) {
    // Fallback: env CLIENT_VIEWERS treated as legacy paid_client.
    if (envPerms?.role === 'client-viewer' && envPerms.allowedClientId === clientId) {
      return {
        ok: true,
        user: session.user,
        role: 'client-viewer',
        tier: 'paid_client',
        allowedClientId: clientId,
      }
    }
    return { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' }
  }

  const tier = tierForAccessType(row.accessType)

  return {
    ok: true,
    user: session.user,
    role: 'client-viewer',
    tier,
    allowedClientId: clientId,
  }
}

/**
 * Onboarding-scoped access (Phase B · $990 self-serve).
 *
 * Isolation is IDENTICAL to requireDashboardClientAccess — allows admin,
 * paid_client, AND self_serve, and the caller can only ever touch the
 * client(s) their verified email is a member of (email → client_portal_users).
 * This function adds NO extra narrowing of its own.
 *
 * The "onboarding-only" scope is a CONVENTION enforced by WHICH routes adopt
 * this guard, not by the function: it exists purely so every route
 * deliberately opened to self_serve for onboarding (connect their own
 * accounts, upload their own assets, write their own profile fields) is
 * greppable for a security audit, instead of being lost among the many
 * routes that use requireDashboardClientAccess for other reasons.
 *
 * Adopt it ONLY on genuine self-serve onboarding routes. Anything that is a
 * paid deliverable must stay on requirePaidClientAccess — that is what keeps
 * self_serve out of paid-only aggregate surfaces (/dashboard/content,
 * /dashboard/visuals, etc.); this guard does not touch those either way.
 */
export async function requireOnboardingClientAccess(
  clientId: string,
): Promise<ClientAccessResult> {
  return requireDashboardClientAccess(clientId)
}

/**
 * Phase X.S2 — Paid-only gate. Wraps requireDashboardClientAccess and
 * additionally rejects self_serve users with a structured 403 so the
 * frontend can render the "Talk to Us / Class" upsell modal instead of
 * a generic error.
 *
 * Allowed tiers: admin, paid_client.
 * Rejected:     self_serve → 403 reason='paid_only'.
 */
export async function requirePaidClientAccess(
  clientId: string,
): Promise<ClientAccessResult> {
  const result = await requireDashboardClientAccess(clientId)
  if (!result.ok) return result

  if (result.tier !== 'admin' && result.tier !== 'paid_client') {
    return {
      ok: false,
      status: 403,
      error: 'This feature requires a paid plan. Contact Magic Lab to unlock.',
      reason: 'paid_only',
    }
  }

  return result
}

// ── DB lookup ─────────────────────────────────────────────────────────────────

interface DashboardAccessRow {
  clientId: string
  accessType: AccessType
}

async function getDashboardAccessForEmail(email: string): Promise<
  | { ok: true; rows: DashboardAccessRow[] }
  | { ok: false; status: 500; error: string; reason: 'lookup_failed' }
> {
  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type')
    .eq('email', email)
    .in('access_type', ACCESS_TYPES_DASHBOARD as readonly string[] as string[])

  if (error) {
    console.error('[auth client-access] client lookup failed:', error)
    return { ok: false, status: 500, error: 'Authorization check failed', reason: 'lookup_failed' }
  }

  return {
    ok: true,
    rows: (data ?? []).map((row) => ({
      clientId:   row.client_id as string,
      accessType: row.access_type as AccessType,
    })),
  }
}

