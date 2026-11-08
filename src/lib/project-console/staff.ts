import { requireSession } from '@/lib/auth/require-session'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { ACCESS_TYPES_DASHBOARD } from '@/lib/auth/access-types'
import { supabaseAdmin } from '@/lib/supabase'

export type StaffScope =
  | { ok: true; kind: 'all' }
  | { ok: true; kind: 'clients'; clientIds: string[] }
  | { ok: false; message: string }

/** Internal staff only. Scoped admins see only their assigned clients. */
export async function requireStaffScope(): Promise<StaffScope> {
  const session = await requireSession()
  if (!session.ok) return { ok: false, message: '请先登录。' }
  const email = (session.user.email ?? '').toLowerCase().trim()
  const perms = getUserPermissions(email)
  if (perms?.role === 'admin') {
    if (perms.allowedClientId) return { ok: true, kind: 'clients', clientIds: [perms.allowedClientId] }
    return { ok: true, kind: 'all' }
  }
  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, scoped_admin')
    .eq('email', email)
    .in('access_type', ACCESS_TYPES_DASHBOARD as readonly string[] as string[])
  if (error || !Array.isArray(data)) return { ok: false, message: '访问范围这次没读到。刷新再看。' }
  const clientIds = data
    .filter((row) => row.scoped_admin === true && typeof row.client_id === 'string' && row.client_id.length > 0)
    .map((row) => row.client_id as string)
  if (clientIds.length === 0) return { ok: false, message: '这是内部同事用的项目台。' }
  return { ok: true, kind: 'clients', clientIds: [...new Set(clientIds)] }
}

export function staffCanOpenClient(scope: StaffScope, clientId: string): boolean {
  return scope.ok && (scope.kind === 'all' || scope.clientIds.includes(clientId))
}
