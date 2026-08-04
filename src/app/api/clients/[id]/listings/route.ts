/**
 * GET  /api/clients/[id]/listings — 这个中介手上的全部房子(带每套房挂了多少人)
 * POST /api/clients/[id]/listings — 建一套房
 *
 * 没有 DELETE:删房子会连带影响已经挂在它下面的人和战役(contacts.listing_id /
 * campaign_briefs.listing_id 会被置空),属于不可逆操作,要 PM 单独决定怎么做,
 * 不在这一版里开口子。想让一套房「不再出现」用状态 withdrawn —— 而且撤下来的
 * 房子是学习用的负样本,本来就该留着。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { fetchListingsWithContactCounts, type ListingRow } from '@/lib/listings/queries'
import { validateListingCreate } from '@/lib/listings/validation'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const result = await fetchListingsWithContactCounts(clientId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ listings: result.listings })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容不是合法的 JSON' }, { status: 400 })
  }

  // 校验在最里层(lib/listings/validation),不是靠前端下拉。
  const parsed = validateListingCreate(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // client_id 一律取 URL 上那个(已鉴权),绝不读 body —— 否则有人在 body 里
  // 塞别人的 client_id 就能往别的中介名下建房子。
  const { data, error } = await supabaseAdmin
    .from('listings')
    .insert({ ...parsed.value, client_id: clientId })
    .select('*')
    .single<ListingRow>()

  if (error || !data) {
    console.error('[api/clients/listings] insert error', error)
    return NextResponse.json(
      { error: `建档失败: ${error?.message ?? '未知错误'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ listing: { ...data, contact_count: 0 } }, { status: 201 })
}
