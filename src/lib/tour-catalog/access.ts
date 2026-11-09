import { NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import type {
  CatalogCapability,
  CatalogPermissions,
  CatalogRole,
  CatalogViewer,
} from './catalog-contract'

export type CatalogAccess =
  | { ok: true; actor: string; viewer: CatalogViewer; permissions: CatalogPermissions }
  | { ok: false; response: NextResponse }

/**
 * The one place that says who may do what in the tour catalog (design §6.10.1 item 2).
 * Exhaustive on purpose: adding a capability or a role without filling this in fails the type check.
 */
export const CAPABILITIES: Record<CatalogCapability, Record<CatalogRole, boolean>> = {
  view: { me_admin: true, client_editor: true },
  edit: { me_admin: true, client_editor: true },
  edit_site: { me_admin: true, client_editor: false },
  assistant: { me_admin: true, client_editor: true },
  request_publish: { me_admin: true, client_editor: true },
  import: { me_admin: true, client_editor: false },
  aliases: { me_admin: true, client_editor: false },
  seed: { me_admin: true, client_editor: false },
  publish: { me_admin: true, client_editor: false },
  manage_members: { me_admin: true, client_editor: false },
  manage_settings: { me_admin: true, client_editor: false },
}

export function permissionsFor(role: CatalogRole): CatalogPermissions {
  return {
    view: CAPABILITIES.view[role],
    edit: CAPABILITIES.edit[role],
    edit_site: CAPABILITIES.edit_site[role],
    assistant: CAPABILITIES.assistant[role],
    request_publish: CAPABILITIES.request_publish[role],
    import: CAPABILITIES.import[role],
    aliases: CAPABILITIES.aliases[role],
    seed: CAPABILITIES.seed[role],
    publish: CAPABILITIES.publish[role],
    manage_members: CAPABILITIES.manage_members[role],
    manage_settings: CAPABILITIES.manage_settings[role],
  }
}

function deny(status: number, error: string): CatalogAccess {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

function grant(email: string, role: CatalogRole, capability: CatalogCapability): CatalogAccess {
  if (CAPABILITIES[capability]?.[role] !== true) {
    return deny(403, 'Forbidden')
  }
  return { ok: true, actor: email, viewer: { email, role }, permissions: permissionsFor(role) }
}

type MemberLookup = 'member' | 'not_member' | 'lookup_failed'

/** Exact match on (client, lower-cased email). Any failure is reported as a failure, never as "member". */
async function lookupCatalogMember(clientId: string, email: string): Promise<MemberLookup> {
  try {
    const res = await supabaseAdmin
      .from('tour_catalog_members')
      .select('email')
      .eq('client_id', clientId)
      .eq('email', email)
      .limit(1)
    if (res.error) {
      console.error('[tour-catalog access] member lookup failed:', res.error.message)
      return 'lookup_failed'
    }
    const rows: unknown = res.data
    return Array.isArray(rows) && rows.length > 0 ? 'member' : 'not_member'
  } catch (err) {
    console.error('[tour-catalog access] member lookup threw:', err)
    return 'lookup_failed'
  }
}

/**
 * Gate for every tour-catalog route and page.
 *
 * Identity and client isolation are delegated to requireDashboardClientAccess. On top of that:
 *   - `me_admin`      = Magic Engine global admin (admin role with no client restriction);
 *   - `client_editor` = anyone else who passes the dashboard gate as a paid member (or a
 *                       client-restricted admin) AND whose email is on tour_catalog_members
 *                       for this client. The list is empty by default, so by default nobody is.
 * self_serve / portal_only never get in, on the list or not. The acting identity is always the
 * session email; nothing from the request body is read.
 */
export async function requireCatalogAccess(
  clientId: string,
  capability: CatalogCapability,
): Promise<CatalogAccess> {
  const result = await requireDashboardClientAccess(clientId)
  if (!result.ok) {
    return deny(result.status, result.error)
  }

  const email = (result.user.email ?? '').trim().toLowerCase()
  if (email === '') {
    return deny(403, 'Forbidden')
  }

  const unrestricted = result.allowedClientId === null || result.allowedClientId === undefined
  if (result.role === 'admin' && unrestricted) {
    return grant(email, 'me_admin', capability)
  }

  if (result.tier === 'self_serve' || result.tier === 'portal_only') {
    return deny(403, 'Forbidden')
  }

  const membership = await lookupCatalogMember(clientId, email)
  if (membership === 'lookup_failed') {
    return deny(500, 'Authorization check failed')
  }
  if (membership !== 'member') {
    return deny(403, 'Forbidden')
  }
  return grant(email, 'client_editor', capability)
}
