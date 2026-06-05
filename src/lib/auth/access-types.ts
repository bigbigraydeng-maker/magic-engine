/**
 * Phase X.S2 — Centralised access_type constants + tier mapping.
 *
 * client_portal_users.access_type is a string column with 6 valid values
 * (see 20260626000002 migration). Every authz path used to inline its own
 * `.in(['dashboard','fde','both','self_serve'])` whitelist — adding a new
 * value meant grepping for every call site and praying. This module is the
 * single source of truth.
 *
 * Rules for editing:
 *   1. Change AccessType + ACCESS_TYPE_VALUES first.
 *   2. Decide which tier the new value belongs to (paid_client / self_serve / portal).
 *   3. Add to the right tier bucket — the .in() arrays auto-update everywhere.
 *   4. Update the CHECK constraint in a new migration to match.
 *
 * Never inline a literal `.in([...])` over `access_type` elsewhere. Import
 * from here. Tests verify the constants stay in sync.
 */

// ── Raw column values (matches the DB CHECK constraint exactly) ──────────────

export const ACCESS_TYPE_VALUES = [
  'portal',
  'dashboard',
  'fde',
  'both',
  'self_serve',
  'client',
] as const

export type AccessType = typeof ACCESS_TYPE_VALUES[number]

// ── Tier mapping (the semantic abstraction the rest of the app uses) ─────────

/**
 * AccessTier collapses the 6 raw access_type values into 3 semantic buckets:
 *
 *   - admin       — env-var whitelist (NOT stored in client_portal_users).
 *                   Full access to every client + internal tools.
 *   - paid_client — paid customers + FDE staff acting on a client's behalf.
 *                   Full access to functional features for their own client.
 *   - self_serve  — free signup tier. Read-only on the discovery report,
 *                   MTC-billable on consumption features (image/video/blog/social),
 *                   locked on functional features (goals/strategy/diagnostic/...).
 *
 * Plus a special non-dashboard tier:
 *   - portal_only — legacy /portal route. Not allowed into /dashboard.
 */
export type AccessTier = 'admin' | 'paid_client' | 'self_serve' | 'portal_only'

/**
 * Map a raw access_type value to its semantic tier.
 * Admin is NOT representable here (admin comes from env vars, not the DB).
 */
export function tierForAccessType(value: AccessType | string): Exclude<AccessTier, 'admin'> {
  switch (value) {
    case 'client':
    case 'dashboard':
    case 'fde':
    case 'both':
      return 'paid_client'
    case 'self_serve':
      return 'self_serve'
    case 'portal':
      return 'portal_only'
    default:
      // Unknown values get the strictest treatment — treat as portal-only
      // so they cannot reach /dashboard until explicitly classified.
      return 'portal_only'
  }
}

// ── Whitelist arrays for Supabase `.in()` queries ────────────────────────────

/**
 * access_types that may access /dashboard at all (any tier above self_serve
 * is also included — self_serve is a /dashboard user too).
 *
 * Use in middleware + requireDashboardClientAccess for the "is this email
 * allowed to load any /dashboard page for this client?" question.
 */
export const ACCESS_TYPES_DASHBOARD = [
  'dashboard',
  'fde',
  'both',
  'self_serve',
  'client',
] as const satisfies readonly AccessType[]

/**
 * access_types that count as a paid customer (paid_client tier).
 * Use in requirePaidClientAccess to gate functional features.
 */
export const ACCESS_TYPES_PAID = [
  'dashboard',
  'fde',
  'both',
  'client',
] as const satisfies readonly AccessType[]

/**
 * access_types allowed on the legacy /portal route.
 * Use in the /portal middleware branch.
 */
export const ACCESS_TYPES_PORTAL = [
  'portal',
  'both',
] as const satisfies readonly AccessType[]
