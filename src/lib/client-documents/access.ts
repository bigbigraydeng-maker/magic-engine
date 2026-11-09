import type { AccessTier } from '@/lib/auth/access-types'

/**
 * What a caller may see in the document library.
 *
 *  - 'all'            Magic Lab internal accounts (tier 'admin'): every file, archived ones included.
 *  - 'client_visible' the client's own paid accounts: only current files marked visible to the client.
 *  - null             everyone else (self-serve, portal-only, ...): nothing.
 *
 * Internal identity is decided by the tier that requireDashboardClientAccess computed, never by the
 * 'fde' member rows: a paying customer can hand those out to any email address.
 */
export type DocumentScope = 'all' | 'client_visible'

export function scopeForTier(tier: AccessTier): DocumentScope | null {
  if (tier === 'admin') return 'all'
  if (tier === 'paid_client') return 'client_visible'
  return null
}

/** Who to write into uploaded_by / archived_by: the login email, falling back to the user id. */
export function actorOf(user: { id: string; email?: string | null }): string {
  const email = (user.email ?? '').trim().toLowerCase()
  return email || user.id
}
