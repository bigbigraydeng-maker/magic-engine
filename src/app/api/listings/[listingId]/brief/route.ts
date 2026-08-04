/**
 * GET /api/listings/[listingId]/brief —— 这套房的全部档案版本(新的在前)。
 *
 * 一次给全部而不是只给生效那版:界面要同时显示「现在生效的」和「还没定稿的草稿」,
 * 而且旧版本本身就是这张表的价值(当初以为什么)。
 *
 * 鉴权走 requireListingAccess —— URL 上没有 client_id,必须先把房子读出来
 * 拿到归属再判,否则换个房子 id 就能读别的中介的判断。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireListingAccess } from '@/lib/listings/queries'
import { fetchListingBriefs } from '@/lib/listings/brief-queries'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params

  const access = await requireListingAccess(listingId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const result = await fetchListingBriefs(listingId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ listing: access.row, briefs: result.value })
}
