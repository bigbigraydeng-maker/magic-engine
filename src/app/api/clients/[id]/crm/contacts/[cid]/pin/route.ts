import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/pin
 *
 * 把一个人钉到今天名单最前面，或取消。
 *
 * 排序是系统算的，但销售偶尔需要把某个人提上来（大单、答应了今天一定回、
 * 老板点名）。用图钉而不是拖拽：拖拽要存一份完整的人工顺序，手机上也很难
 * 点准；实际需求几乎总是「把这几个提上来」。
 *
 * IDOR：contact 必须属于 path 上的 client，否则 404。
 * 幂等：重复 pin 只刷新时间，重复 unpin 直接返回。
 *
 * Body: { pinned: boolean }
 * Responses: 200 { pinned, pinnedAt } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let pinned: boolean
  try {
    const body = (await req.json()) as { pinned?: unknown }
    if (typeof body.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned 必须是 true 或 false' }, { status: 400 })
    }
    pinned = body.pinned
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  // 必须带 client_id 一起查，否则换个 cid 就能改到别家客户的联系人
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/pin] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const pinnedAt = pinned ? new Date().toISOString() : null

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update({ pinned_at: pinnedAt })
    .eq('id', cid)
    .eq('client_id', clientId)

  if (updateErr) {
    console.error('[crm/pin] 更新失败:', updateErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ pinned, pinnedAt })
}
