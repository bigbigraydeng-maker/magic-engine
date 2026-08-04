/**
 * POST /api/listings/[listingId]/brief/[briefId]/activate —— 让这一版生效。
 *
 * 生效 = 这套房的投放和内容从此以这一版为准。所以切换必须是原子的两步:
 * 旧的先置「旧版本」,新的才置「已生效」——具体在 brief-queries.activateBrief,
 * 那里也解释了为什么第一步不是顺手清理。
 *
 * 没有「取消生效」:一套房应该始终有一版生效的判断,不该出现「什么都不生效」
 * 的中间态。要换就生效另一版。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireListingAccess } from '@/lib/listings/queries'
import { activateBrief } from '@/lib/listings/brief-queries'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string; briefId: string }> },
) {
  const { listingId, briefId } = await params

  const access = await requireListingAccess(listingId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const result = await activateBrief(listingId, briefId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ brief: result.value })
}
