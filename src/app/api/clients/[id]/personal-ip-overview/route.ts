/**
 * GET /api/clients/[id]/personal-ip-overview
 *
 * 个人 IP 概览五格数字。只读已有表，不拉新外部渠道。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { loadClientKind } from '@/lib/huatuo/client-kind'
import { loadPersonalIpOverviewTiles } from '@/lib/clients/personal-ip-overview-load'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const clientKind = await loadClientKind(supabaseAdmin, clientId)
  if (clientKind !== 'personal_ip') {
    return NextResponse.json({ error: 'Not a personal IP client' }, { status: 404 })
  }

  try {
    const tiles = await loadPersonalIpOverviewTiles(supabaseAdmin, clientId)
    return NextResponse.json({ success: true, tiles })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load overview'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
