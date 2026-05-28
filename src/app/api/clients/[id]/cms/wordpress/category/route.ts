/**
 * PATCH /api/clients/[id]/cms/wordpress/category
 *
 * P14.B.6 — Set (or clear) the default WP category ID for this client's
 * WordPress connection.  A dedicated route avoids re-encrypting the
 * Application Password just to update a single integer.
 *
 * Body: { category_id: number | null }
 *   • number  — WP category ID to use on every new post
 *   • null    — revert to WP default (uncategorized, ID 1)
 *
 * Returns: { success: true, wp_default_category_id: number | null }
 *
 * Security:
 *  - requireDashboardClientAccess (tenant isolation)
 *  - No credential re-use; only writes one integer column
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { setWpDefaultCategoryId } from '@/lib/cms/connection-store'

interface RouteContext {
  params: { id: string }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  const raw = body.category_id
  if (raw !== null && raw !== undefined) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { success: false, error: 'category_id must be a positive integer or null', code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
  }

  const categoryId = (raw === null || raw === undefined) ? null : Number(raw)

  try {
    await setWpDefaultCategoryId(clientId, categoryId)
    return NextResponse.json({ success: true, wp_default_category_id: categoryId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/wordpress/category PATCH]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to update category', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
