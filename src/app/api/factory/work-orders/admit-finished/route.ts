import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { admitFinishedVideo, admitInputFromBody } from '@/lib/factory/admit-finished'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const confirmedBy = admin.user.email ?? ''
  if (!confirmedBy) return NextResponse.json({ error: 'admin email missing' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = admitInputFromBody(body, confirmedBy)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const result = await admitFinishedVideo(supabaseAdmin, parsed.input)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    ok: true,
    work_order_id: result.workOrderId,
    deduped: result.deduped,
    review_queued: result.reviewQueued,
    review_error: result.reviewError,
    consent_updated: result.consentUpdated,
    auto_checklist_summary: result.autoChecklist.map(c => ({
      key: c.key,
      outcome: c.outcome,
      detail: c.detail,
    })),
  })
}
