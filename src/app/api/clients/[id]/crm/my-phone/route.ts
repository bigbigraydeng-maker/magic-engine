import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { registerStaffPhone } from '@/lib/telephony/staff-phone'

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
    .select('id, extension_map')
    .eq('client_id', clientId)
    .eq('provider', 'twilio')
    .eq('active', true)
    .limit(2)
  if (error) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ error: '这个客户还没接入电话' }, { status: 422 })
  if (rows.length > 1) return NextResponse.json({ error: '电话连接不唯一，请联系管理员' }, { status: 422 })

  const conn = rows[0] as { id: string; extension_map: Record<string, string> | null }
  const result = registerStaffPhone(conn.extension_map ?? {}, access.user.email, body.phone)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  const { error: uErr } = await supabaseAdmin
    .from('telephony_connections')
    .update({ extension_map: result.map })
    .eq('id', conn.id)
    .eq('client_id', clientId)
  if (uErr) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  return NextResponse.json({ ok: true, phone: result.phone })
}
