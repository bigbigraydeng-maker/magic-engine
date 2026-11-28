/**
 * GET /api/clients/[id]/crm/ai-pickup/waiting — how many guests are waiting on the
 * "交给 AI 跟进" page, and how long ago somebody last released. Read-only.
 *
 * Counts only: no guest names, no emails, no phone numbers. Same access as the
 * catalogue button. Uses the same rule set as the pickup page (defaultAiPickupWaitingDeps),
 * so the number here and the list there cannot drift apart.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { defaultAiPickupWaitingDeps } from '@/lib/pm-todo/ai-pickup-waiting-items'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const w = await defaultAiPickupWaitingDeps.load(supabaseAdmin, params.id, new Date())
    if (w === null) return NextResponse.json({ waiting: 0, daysSinceRelease: null })
    return NextResponse.json({ waiting: w.waiting, daysSinceRelease: w.daysSinceRelease })
  } catch (err) {
    console.error('[crm/ai-pickup/waiting] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到。' }, { status: 503 })
  }
}
