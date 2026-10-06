// POST /api/factory/work-orders/[id]/accept-flag
// Records a PM acceptance of a brief-deviation quality flag on an in_review work order.
// authz = guardAdmin (403 before the click); the actual acceptance logic lives in
// review-accept-flag.ts (applyAcceptFlag), shared with any other front-ends.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { applyAcceptFlag } from '@/lib/factory/review-accept-flag'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Restricted demo admins must not record acceptances for other clients' orders.
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  const admin = await requireAdmin()
  const reviewer = admin.ok ? (admin.user.email ?? 'admin') : 'admin'

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const result = await applyAcceptFlag(
    supabaseAdmin,
    id,
    body.category,
    reviewer,
    typeof body.note === 'string' ? body.note : undefined,
  )

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...result.data })
}
