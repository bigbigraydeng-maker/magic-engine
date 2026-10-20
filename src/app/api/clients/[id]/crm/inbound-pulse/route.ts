/**
 * GET /api/clients/[id]/crm/inbound-pulse?since=<ISO>
 *
 * 「有没有客人发来新消息」的轻量脉搏，给 CRM 页面的「新消息提醒」条轮询用。
 *
 * 为什么需要（PM 2026-10-20）：WhatsApp / 私信 / 邮件的消息 2–8 秒就入库了，
 * 但 CRM 页面不会自动刷新、也没有任何提醒 —— 不开页面就看不到，广告带来的咨询会堆着没人回。
 *
 * 只数「`since` 之后、最后一句话是客人说的」的会话数，按渠道分组。一个会话算一位客人，
 * 不返回任何姓名、内容、邮箱电话（轮询频繁，响应越小越好，也不让它成为个人信息的出口）。
 * 隔离：requirePaidClientAccess + 查询带 client_id。
 *
 * Query: since（必填，ISO 时间；早于 24 小时前按 24 小时前算）
 * Responses: 200 { count, byChannel, latestAt } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MAX_LOOKBACK_MS = 24 * 3_600_000

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const raw = req.nextUrl.searchParams.get('since')
  const sinceMs = raw ? new Date(raw).getTime() : Number.NaN
  if (Number.isNaN(sinceMs)) {
    return NextResponse.json({ error: 'since 必须是有效的 ISO 时间' }, { status: 400 })
  }
  const since = new Date(Math.max(sinceMs, Date.now() - MAX_LOOKBACK_MS)).toISOString()

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('channel, last_message_at')
    .eq('client_id', clientId)
    .eq('last_message_from', 'customer')
    .gt('last_message_at', since)
    .order('last_message_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as Array<{ channel: string | null; last_message_at: string | null }>
  const byChannel: Record<string, number> = {}
  for (const r of rows) {
    const ch = r.channel ?? 'other'
    byChannel[ch] = (byChannel[ch] ?? 0) + 1
  }

  return NextResponse.json({
    count: rows.length,
    byChannel,
    latestAt: rows[0]?.last_message_at ?? null,
  })
}
