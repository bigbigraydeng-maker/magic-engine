/**
 * /api/clients/[id]/meta-ads/boost-post
 *
 * RETIRED. This endpoint used to create an ACTIVE paid campaign in a single
 * call, bypassing the draft -> paused -> approval flow. It now returns 410
 * after auth and does nothing else.
 *
 * The one-call boost helper in the Meta library is kept but must not be
 * imported by any route; an architecture test enforces this.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface RouteContext {
  params: { id: string }
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  return NextResponse.json(
    {
      error: '这个入口已停用：直接建成开启状态的广告绕过了授权。请走草案 → 暂停 → 审批流程',
      code: 'boost_post_retired',
    },
    { status: 410 },
  )
}
