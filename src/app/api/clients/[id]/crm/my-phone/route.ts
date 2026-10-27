import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { cleanExtensionMap, registerStaffPhone } from '@/lib/telephony/staff-phone'

/**
 * POST /api/clients/[id]/crm/my-phone  body: { phone }
 *
 * 员工给自己登记接电话的手机（只能登记自己的登录邮箱，不能替同事登记）。
 * 点击外呼读的就是这张表；以前没有界面能填，7 个员工账号里只有 1 个能打电话。
 * Responses: 200 { ok, phone } / 400 / 401 / 403 / 422 / 500
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await req.json().catch(() => null)) as { phone?: unknown } | null
  if (!body || typeof body.phone !== 'string') return NextResponse.json({ error: '请填手机号' }, { status: 400 })

  const { data: rows, error } = await supabaseAdmin
    .from('telephony_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'twilio')
    .eq('active', true)
    .limit(2)
  if (error) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ error: '这个客户还没接入电话' }, { status: 422 })
  if (rows.length > 1) return NextResponse.json({ error: '电话连接不唯一，请联系管理员' }, { status: 422 })

  const conn = rows[0] as { id: string }
  // 整张表读出再写回：写入时带上「刚读到的旧值」做条件（compare-and-swap），库里已被别人改过则 0 行更新，
  // 重新读取并重新校验（同事刚登记/刚占用的号码都会在校验里被看到），最多 5 次。
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: cur, error: rErr } = await supabaseAdmin
      .from('telephony_connections')
      .select('extension_map')
      .eq('id', conn.id)
      .eq('client_id', clientId)
      .maybeSingle()
    if (rErr || !cur) return NextResponse.json({ error: '操作失败' }, { status: 500 })
    const raw = (cur as { extension_map: unknown }).extension_map
    const result = registerStaffPhone(cleanExtensionMap(raw), access.user.email, body.phone)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

    const base = supabaseAdmin
      .from('telephony_connections')
      .update({ extension_map: result.map })
      .eq('id', conn.id)
      .eq('client_id', clientId)
    const guarded = raw === null || raw === undefined ? base.is('extension_map', null) : base.eq('extension_map', JSON.stringify(raw))
    const { data: hit, error: uErr } = await guarded.select('id')
    if (uErr) return NextResponse.json({ error: '操作失败' }, { status: 500 })
    if (hit && hit.length > 0) return NextResponse.json({ ok: true, phone: result.phone })
  }
  return NextResponse.json({ error: '同时有人在登记，请再点一次' }, { status: 409 })
}
