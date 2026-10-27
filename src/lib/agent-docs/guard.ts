/**
 * Page-level second gate (same rule as /dashboard/learning): only global admins
 * (company-domain / ADMIN_EMAILS). Scoped admins and client members are bounced
 * by middleware; this catches anything that slips through.
 */
export function isGlobalAdmin(h: { get(name: string): string | null }): boolean {
  return (
    h.get('x-user-role') === 'admin' &&
    h.get('x-user-tier') === 'admin' &&
    h.get('x-allowed-client-id') === null
  )
}
