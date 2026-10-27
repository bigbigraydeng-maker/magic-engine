/**
 * GET /api/clients/[id]/prescription/[pId]/plan-seed
 * 现算这份处方的计划草稿建议（plan seed）。
 *
 * 这是只读接口，现算不落库：只读处方内容、只算建议，不写任何表。
 * 批准处方不等于批准花钱：这里只给出建议，真正花钱仍要走后续的保存与审批流程。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string; pId: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }
  const result = await readPlanSeedForClient(params.id, params.pId)
  return NextResponse.json(result.body, { status: result.status })
}
