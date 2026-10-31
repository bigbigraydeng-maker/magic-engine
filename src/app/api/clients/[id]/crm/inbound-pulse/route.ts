/**
 * GET /api/clients/[id]/crm/inbound-pulse?since=<ISO>
 *
 * 「有没有客人发来新消息」的轻量脉搏，给 CRM 页面的「新消息提醒」条轮询用。
 *
 * 为什么需要（PM 2026-10-20）：CRM 页面不会自动刷新、也没有任何提醒 —— 不开页面就看不到，
 * 广告带来的 WhatsApp 咨询会堆着没人回。
 *
 * 🔴 只数 WhatsApp 和私信（独立审查 2026-10-21）：邮件不进来 —— 邮件同步挂在每小时任务里（入库延迟
 * 中位约 25 分钟、最长约 1 小时），而且「最后一句是客人说的」里夹着大量简报 / 推销 / 自动回复 / 系统通知
 * （近 14 天邮件会话约 35%），直接数会把提醒数字刷高、让销售整体忽略这条提示。邮件要等按
 * `lib/crm/email-reply-due.ts` 的口径过滤后再加。
 * 入库速度：WhatsApp 约几秒（webhook）；私信中位约 3 分钟、最长约 1 小时（有同步）。
 *
 * 只数「`since` 之后、最后一句话是客人说的」的会话数，按渠道分组。**一个会话算一条**（同一位客人在两个渠道各说话会算两条，N 是会话数不是人数），
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

/** 提醒只覆盖这两个渠道（邮件见上面的说明）。 */
const PULSE_CHANNELS = ['whatsapp', 'messenger']

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
    .in('channel', PULSE_CHANNELS)
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
