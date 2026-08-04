/**
 * POST /api/listings/[listingId]/brief/generate —— AI 先做功课,出一份草稿。
 *
 * Body: { listing_url?: string }   房源页链接,可选但强烈建议给 —— 给了才有
 *                                  真正的页面正文可抽,不给就只能靠系统里那几个字段。
 *
 * 产出一律是 draft:AI 出的东西没经人看过,不许直接生效(生效走 /activate)。
 *
 * 🔒 鉴权必须在最前面:这个接口会调 AI + 联网搜索,是**花钱**的接口,
 *    裸奔等于任何人知道房子 id 就能反复烧钱。
 *
 * 同步跑(30–120 秒)。跟 master brief 生成同一个姿势 —— Render 付费档撑得住,
 * 换成异步 job 会多一张状态表和一堆轮询,现在这个量级不值得。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireListingAccess } from '@/lib/listings/queries'
import { generateListingBrief, normalizeListingUrl } from '@/lib/listings/brief-generate'

export const maxDuration = 300

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params

  const access = await requireListingAccess(listingId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // body 允许为空 —— 不给链接也能跑(只是产出会更多「缺」)。
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>).listing_url : null)

  const url = normalizeListingUrl(raw)
  if (!url.ok) {
    return NextResponse.json({ error: url.error }, { status: 400 })
  }

  const result = await generateListingBrief({ listing: access.row, pageUrl: url.url })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, warnings: result.warnings },
      { status: result.status },
    )
  }

  return NextResponse.json({ brief: result.brief, warnings: result.warnings }, { status: 201 })
}
