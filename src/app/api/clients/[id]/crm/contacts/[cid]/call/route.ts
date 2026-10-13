import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { normalisePhone } from '@/lib/crm/identity'
import { startOutboundCall, staffPhoneForEmail } from '@/lib/telephony/twilio/outbound'
import { SECRET_REF_PATTERN } from '@/lib/telephony/twilio/ingest'
import { resolvePublicBase } from '@/lib/telephony/twilio/url'

/**
 * POST /api/clients/[id]/crm/contacts/[cid]/call
 *
 * 点击外呼：先打给当前登录员工登记过的手机，员工接起后再接通这位客人，全程录音。
 * 默认关（环境变量 TELEPHONY_OUTBOUND_ENABLED=1 才开）；说过「别再联系」的人一律不拨；
 * 员工没登记手机、客人号码认不出、连接没配好都直接拒绝，不猜。
 *
 * IDOR：联系人必须属于 path 上的 client。
 * Responses: 200 { ok, message } / 401 / 403 / 404 / 409 / 422 / 429 / 500 / 502
 */

export const dynamic = 'force-dynamic'

/** 同一个人 60 秒内不重复拨（双击 / 重复点）。进程内，够防手滑；不是安全边界。 */
const recent = new Map<string, number>()
const RECENT_MS = 60_000

export async function POST(_req: NextRequest, { params }: { params: { id: string; cid: string } }): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  if (process.env.TELEPHONY_OUTBOUND_ENABLED !== '1') {
    return NextResponse.json({ error: '外呼功能还没开启' }, { status: 403 })
  }

  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, primary_phone, do_not_contact')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  // 「别再联系」的判据只有一份（lib/crm/dnc），读不到触点就不拨（宁可拒绝也不误拨）。
  const { data: touches, error: tErr } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('metadata, occurred_at')
    .eq('client_id', clientId)
    .eq('contact_id', cid)
  if (tErr) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  const dnc: DncTouch[] = ((touches ?? []) as { metadata: Record<string, unknown> | null; occurred_at: string }[]).map((t) => ({
    outcome: (t.metadata?.outcome as string) ?? null,
    flagged: t.metadata?.do_not_contact === true,
    occurredAt: t.occurred_at,
  }))
  if (isDoNotContact(contact.do_not_contact === true, dnc)) {
    return NextResponse.json({ error: '这位客人说过别再联系，不能拨打' }, { status: 409 })
  }

  const { data: conn, error: nErr } = await supabaseAdmin
    .from('telephony_connections')
    .select('id, provider_account_id, secret_ref, extension_map, default_country')
    .eq('client_id', clientId)
    .eq('provider', 'twilio')
    .eq('active', true)
    .maybeSingle()
  if (nErr) return NextResponse.json({ error: '操作失败' }, { status: 500 })
  if (!conn) return NextResponse.json({ error: '这个客户还没接入电话' }, { status: 422 })

  const staffPhone = staffPhoneForEmail((conn.extension_map ?? {}) as Record<string, string>, access.user.email)
  if (!staffPhone) return NextResponse.json({ error: '你的手机号还没登记，先请管理员登记后再拨' }, { status: 422 })

  const customer = normalisePhone(contact.primary_phone, conn.default_country === 'AU' ? 'AU' : 'NZ')
  if (!customer) return NextResponse.json({ error: '这位客人的号码认不出，不能拨' }, { status: 422 })

  const ref = conn.secret_ref as string | null
  const token = ref && SECRET_REF_PATTERN.test(ref) ? process.env[ref] : undefined
  if (!token) return NextResponse.json({ error: '电话服务没配好' }, { status: 500 })

  const key = `${clientId}:${cid}`
  const last = recent.get(key)
  if (last && Date.now() - last < RECENT_MS) return NextResponse.json({ error: '刚拨过，请稍等一分钟' }, { status: 429 })
  recent.set(key, Date.now())

  try {
    const baseUrl = resolvePublicBase(_req.headers, process.env.TELEPHONY_PUBLIC_BASE_URL, _req.nextUrl.host)
    await startOutboundCall({ accountSid: conn.provider_account_id as string, authToken: token, connectionId: conn.id as string, staffPhone, customer, baseUrl })
  } catch (e) {
    recent.delete(key)
    console.error('[crm/call] 外呼失败:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '拨打没成功，请稍后再试' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, message: '正在先打给你的手机，接听后会自动接通客人' })
}
