import { requireSession } from '@/lib/auth/require-session'
import { getUserPermissions } from '@/lib/auth/whitelist'

export type StaffScope =
  | { ok: true; kind: 'all' }
  | { ok: true; kind: 'one'; clientId: string }
  | { ok: false; message: string }

/** Internal staff only. A scoped admin sees one client. Customers do not get this desk. */
export async function requireStaffScope(): Promise<StaffScope> {
  const session = await requireSession()
  if (!session.ok) return { ok: false, message: '请先登录。' }
  const email = (session.user.email ?? '').toLowerCase().trim()
  const perms = getUserPermissions(email)
  if (perms?.role !== 'admin') return { ok: false, message: '这是内部同事用的项目台。' }
  if (perms.allowedClientId) return { ok: true, kind: 'one', clientId: perms.allowedClientId }
  return { ok: true, kind: 'all' }
}
