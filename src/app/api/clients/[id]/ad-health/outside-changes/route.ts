/**
 * GET /api/clients/[id]/ad-health/outside-changes
 *
 * Budget, new ad set, and new ad changes between stored snapshots that have
 * no matching ME action record. Read-only. Internal operators only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOutsideChanges } from '@/lib/ads-strategy/outside-change/load'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  try {
    const changes = await loadOutsideChanges(params.id, supabaseAdmin)
    return NextResponse.json({ success: true, changes })
  } catch (e) {
    console.warn('[api/ad-health/outside-changes] 读取失败', {
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: '读不到系统外的改动，稍后再试' }, { status: 500 })
  }
}
