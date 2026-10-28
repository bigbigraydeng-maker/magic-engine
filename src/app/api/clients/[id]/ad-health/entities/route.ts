/**
 * GET /api/clients/[id]/ad-health/entities
 *
 * "每条广告" tab detail: campaign → ad set → ad with recent-window numbers and running state,
 * built from stored daily insights + the latest entity snapshots. Read-only.
 *
 * 🔴 Internal staff only (unscoped admin), same gate as breakdowns / war-map / live.
 * 🔴 Reads only from the database — never calls Meta. State comes from the latest daily snapshot,
 *    so something switched on today shows as "unknown" until the next snapshot.
 * 🔴 A failed load is a plain 500; the raw error is never returned to the client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { clampTreeDays, loadEntityTree } from '@/lib/ads-strategy/entity-tree/load'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const fullView = access.tier === 'admin' && access.allowedClientId === null
  if (!fullView) {
    return NextResponse.json({ error: '广告组和广告明细暂只对内部员工开放' }, { status: 403 })
  }

  const days = clampTreeDays(new URL(req.url).searchParams.get('days'))
  try {
    const tree = await loadEntityTree(clientId, days, supabaseAdmin)
    return NextResponse.json({ success: true, tree })
  } catch (e) {
    console.warn('[api/ad-health/entities] 读取失败', {
      clientId,
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: '读不到广告组和广告明细，稍后再试；持续读不出来找开发' }, { status: 500 })
  }
}
