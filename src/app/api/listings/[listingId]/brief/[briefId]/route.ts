/**
 * PATCH /api/listings/[listingId]/brief/[briefId] —— 人校正档案。
 *
 * 只写请求里出现过的字段(没出现 = 不动),所以界面可以一栏一栏改。
 *
 * 两道闸门,都不能省:
 *   ① requireListingAccess —— 确认这套房归调用者管
 *   ② fetchBriefOfListing(在 brief-queries 里)—— 确认这份档案确实属于这套房。
 *      少了第 ② 道,拿别人的档案 id 换进来就能改。
 *
 * 校验走 brief-schema,跟 AI draft 同一批 guard:人手改也不许塞非法枚举、
 * 也不许塞没出处的数字。「后端严、前端松」的差别就是下一个 bug 的藏身处。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireListingAccess } from '@/lib/listings/queries'
import { updateBrief } from '@/lib/listings/brief-queries'
import { validateBriefPatch } from '@/lib/listings/brief-schema'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string; briefId: string }> },
) {
  const { listingId, briefId } = await params

  const access = await requireListingAccess(listingId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容不是合法的 JSON' }, { status: 400 })
  }

  const parsed = validateBriefPatch(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const result = await updateBrief(listingId, briefId, parsed.value)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ brief: result.value })
}
