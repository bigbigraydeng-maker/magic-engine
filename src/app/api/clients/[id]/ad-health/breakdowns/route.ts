/**
 * GET /api/clients/[id]/ad-health/breakdowns
 *
 * "多维数据": breakdown report (placement/device, hour-of-day, etc.) built from the stored
 * ad_breakdown_stats table plus CRM form leads (contact_touchpoints). Read-only.
 *
 * 🔴 Internal staff only (unscoped admin), same gate as war-map / live.
 * 🔴 Reads only from the database — never calls Meta.
 * 🔴 A failed load is reported as a plain 500; the raw error is never returned to the client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveAccountTimezone } from '@/lib/ads-strategy/account-timezone'
import { clampDays, loadBreakdownReport } from '@/lib/ads-strategy/breakdown-stats/report-load'

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
    return NextResponse.json({ error: '多维数据暂只对内部员工开放' }, { status: 403 })
  }

  const days = clampDays(new URL(req.url).searchParams.get('days'))

  try {
    const report = await loadBreakdownReport(clientId, days, {
      supabase: supabaseAdmin,
      resolveTimezone: resolveAccountTimezone,
      now: () => new Date(),
    })
    return NextResponse.json({ success: true, report })
  } catch (e) {
    console.warn('[api/ad-health/breakdowns] 读取失败', {
      clientId,
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      { error: '读不到多维数据，稍后再试；持续读不出来找开发' },
      { status: 500 },
    )
  }
}
