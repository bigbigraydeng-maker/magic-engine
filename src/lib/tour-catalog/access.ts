import { NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export type CatalogAccess =
  | { ok: true; actor: string }
  | { ok: false; response: NextResponse }

/**
 * Gate for the internal tour catalog admin tool.
 *
 * Delegates identity/isolation to requireDashboardClientAccess, then narrows
 * further: only the admin role may use the catalog. Client viewers (paid or
 * self-serve) are rejected with a plain 403.
 */
export async function requireCatalogAdmin(
  clientId: string,
): Promise<CatalogAccess> {
  const result = await requireDashboardClientAccess(clientId)

  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: result.error },
        { status: result.status },
      ),
    }
  }

  if (result.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, actor: result.user.email ?? 'unknown' }
}
