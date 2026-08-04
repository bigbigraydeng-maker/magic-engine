/**
 * PATCH /api/listings/[listingId] — 改一套房。
 *
 * URL 上没有 client_id,所以鉴权走 requireListingAccess:先把这套房读出来拿到
 * 它归属哪个中介,再做标准客户鉴权(跟 /api/initiatives/[id] 同一套)。
 *
 * 没有 DELETE:删房子会连带把已经挂在它下面的人和战役置空,不可逆,要 PM 单独
 * 决定。不想要的房子改成「已撤下」——而且撤下来的房子是学习用的负样本,该留着。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireListingAccess, type ListingRow } from '@/lib/listings/queries'
import { validateListingPatch } from '@/lib/listings/validation'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params

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

  // 校验在最里层(lib/listings/validation),跟建档走同一份枚举。
  const parsed = validateListingPatch(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // client_id 不在可改字段里(validation 根本不认这个 key),所以没法把一套房
  // 挪到别的中介名下。updated_at 手动写:数据库没挂自动更新的触发器。
  const { data, error } = await supabaseAdmin
    .from('listings')
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq('id', listingId)
    .select('*')
    .single<ListingRow>()

  if (error || !data) {
    console.error('[api/listings] update error', error)
    return NextResponse.json(
      { error: `保存失败: ${error?.message ?? '未知错误'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ listing: data })
}
