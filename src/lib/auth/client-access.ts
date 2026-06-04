import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getUserPermissions, type UserRole } from '@/lib/auth/whitelist'

export type ClientAccessResult =
  | {
      ok: true
      user: User
      role: UserRole
      allowedClientId: string | null
    }
  | {
      ok: false
      status: 401 | 403 | 500
      error: string
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
      allowedClientId: null,
    }
  }

  const dbAccess = await getDashboardClientIds(email)
  if (!dbAccess.ok) return dbAccess

  const allowedClientIds = new Set(dbAccess.clientIds)
  if (envPerms?.role === 'client-viewer' && envPerms.allowedClientId) {
    allowedClientIds.add(envPerms.allowedClientId)
  }

  if (!allowedClientIds.has(clientId)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return {
    ok: true,
    user: session.user,
    role: 'client-viewer',
    allowedClientId: clientId,
  }
}

async function getDashboardClientIds(email: string): Promise<
  | { ok: true; clientIds: string[] }
  | { ok: false; status: 500; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', email)
    .in('access_type', ['dashboard', 'both', 'self_serve', 'fde'])

  if (error) {
    console.error('[auth client-access] client lookup failed:', error)
    return { ok: false, status: 500, error: 'Authorization check failed' }
  }

  return {
    ok: true,
    clientIds: (data ?? []).map((row) => row.client_id as string),
  }
}
