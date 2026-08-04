import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { parseSnoozeDays } from '@/lib/crm/snooze'
import { recordManualTouchpoint } from '@/lib/crm/touchpoints'

/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/snooze
 *
 * 「这人先放一放」。到期自动回名单 —— 没有任何人需要记得去解除。
 *
 * 为什么是这个而不是「手动改分组」（PM 2026-08-03 问的就是后者）：
 * 手动维护的状态列必烂。推迟改变的是**系统看到的事实**（这人现在不该联系），
 * 分批照旧自己算；到期那条判断不成立了，他自然回来。
 *
 * **同时记一条触点**：三个月后有人翻这个人的记录，要看得见「7 月 3 日 Amy
 * 把他推迟到 10 月」。只改一个列不留痕，等于把一次真实的销售判断丢掉了。
 *
 * IDOR：contact 必须属于 path 上的 client，否则 404。
 * 幂等：重复推迟只是把时间改成新的；取消推迟对没推迟的人也返回 200。
 *
 * Body: { days: number | null }   —— null / 0 = 取消推迟。时间由服务端算，
 *        前端不传时间点（这一页同时给 NZ 和 AU 用，时区算错就是差一天）。
 * Responses: 200 { snoozeUntil } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { days?: unknown; clientRef?: unknown }
  try {
    body = (await req.json()) as { days?: unknown; clientRef?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = parseSnoozeDays(body.days, new Date())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 必须带 client_id 一起查，否则换个 cid 就能改到别家客户的联系人。
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id, last_seen_at')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/snooze] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update({ snooze_until: parsed.until, updated_at: new Date().toISOString() })
    .eq('id', cid)
    .eq('client_id', clientId)

  if (updateErr) {
    console.error('[crm/snooze] 更新失败:', updateErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  // 留痕。失败不影响主结果 —— 人已经被推迟了，为一条记录把整个操作判失败，
  // 只会让销售再点一次、然后看到同样的错误。
  try {
    const when = parsed.until
      ? new Date(parsed.until).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
      : null
    await recordManualTouchpoint({
      clientId,
      contactId: cid,
      direction: 'outbound',
      note: when ? `先放一放，${when} 再联系` : '取消推迟，放回今天的名单',
      occurredAt: new Date().toISOString(),
      clientRef: typeof body.clientRef === 'string' && body.clientRef ? body.clientRef : crypto.randomUUID(),
      loggedByEmail: access.user?.email ?? null,
      currentLastSeenAt: (existing.last_seen_at as string | null) ?? null,
      // 这句话是系统生成的固定文案，不含任何客户信息 —— 送去 AI 解析既慢又白花钱。
      parsed: {
        summary: when ? `推迟到 ${when}` : '取消推迟',
        // 推迟不是一次通话结果 —— 不能记成「没打通」或「聊过了」，
        // 那会污染分批（DEAD_OUTCOMES / retry_channel 都看这个字段）。
        outcome: 'unknown',
        do_not_contact: false,
        travel_window: null,
        tour_interest: null,
        competitor: null,
        callback_at: null,
      },
    })
  } catch (err) {
    console.error('[crm/snooze] 记录留痕失败（不影响推迟本身）:', err)
  }

  return NextResponse.json({ snoozeUntil: parsed.until })
}
