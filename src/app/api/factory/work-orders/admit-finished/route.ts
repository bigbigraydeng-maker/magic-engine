import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { admitFinishedVideo, type AdmitInput } from '@/lib/factory/admit-finished'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const endcard = typeof body.endcard === 'object' && body.endcard !== null
    ? body.endcard as Record<string, unknown>
    : {}

  const input: AdmitInput = {
    clientId: String(body.client_id ?? ''),
    storagePath: String(body.storage_path ?? ''),
    angle: String(body.angle ?? ''),
    rationale: String(body.rationale ?? body.angle ?? ''),
    caption: String(body.caption ?? ''),
    endcard: {
      cta: String(endcard.cta ?? ''),
      url: String(endcard.url ?? ''),
    },
    masterBriefId: typeof body.master_brief_id === 'string' ? body.master_brief_id : undefined,
    goalId: typeof body.goal_id === 'string' ? body.goal_id : undefined,
  }

  const result = await admitFinishedVideo(supabaseAdmin, input)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    ok: true,
    work_order_id: result.workOrderId,
    auto_checklist_summary: result.autoChecklist.map(c => ({
      key: c.key,
      outcome: c.outcome,
      detail: c.detail,
    })),
  })
}
