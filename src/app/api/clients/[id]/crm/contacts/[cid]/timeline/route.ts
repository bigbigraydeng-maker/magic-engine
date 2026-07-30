/**
 * GET /api/clients/[id]/crm/contacts/[cid]/timeline
 *
 * 一个人的全渠道往来时间线 —— 「全部客人」页点开某行时拉。触点（FB表单 / 电话 /
 * 私信 / 邮件…）+ 阶段流转事件（谁把他从 X 改到 Y）按时间倒序合并成一条线。
 *
 * 隔离（照 touchpoints / stage 路由的既有 pattern）：
 *   IDOR   先 SELECT contact WHERE id=cid AND client_id=clientId → 查不到 404，
 *          再查明细。touchpoints 和 stage_events **两张表都 .eq(client_id)** ——
 *          不能图省事只按 contact_id 查（拿别客户的 cid 走本路径就能读到时间线）。
 *   admin  allowedClientId=null 也从 URL 的 client_id 收口，跨不了客户。
 *
 * Responses: 200 { contact, timeline } / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string; cid: string }
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

type TimelineEntry =
  | {
      kind: 'touch'
      at: string
      channel: string
      direction: 'inbound' | 'outbound'
      summary: string | null
      tour: string | null
      outcome: string | null
      travelWindow: string | null
      callbackAt: string | null
      competitor: string | null
    }
  | {
      kind: 'message'
      at: string
      direction: 'inbound' | 'outbound'
      senderName: string | null
      body: string
    }
  | {
      kind: 'stage'
      at: string
      fromStage: string | null
      toStage: string | null
      fromLabel: string | null
      toLabel: string | null
      changedBy: string | null
      note: string | null
    }

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const contactId = params.cid

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── IDOR 闸：contact 必须属于 path client。查不到即 404，别泄漏别客户的时间线。 ──
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, display_name, primary_phone, primary_email, stage')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!contact) {
    return NextResponse.json({ error: '联系人不存在' }, { status: 404 })
  }

  const [
    { data: touches, error: tErr },
    { data: events, error: eErr },
    { data: stageRows },
    { data: convs },
  ] = await Promise.all([
    // messenger 触点是「N 条往来」摘要占位（raw 恒空），真正的对话原文在
    // conversation_messages —— 下面单独拉、渲染成对话记录。这里排除 messenger，
    // 免得「Messenger 私信（5 条往来）」和真实 5 条消息在时间线里重复。
    supabaseAdmin
      .from('contact_touchpoints')
      .select('channel, direction, occurred_at, summary, metadata')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .neq('channel', 'messenger')
      .order('occurred_at', { ascending: false })
      .limit(2000),
    supabaseAdmin
      .from('contact_stage_events')
      .select('from_stage, to_stage, changed_by, note, created_at')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(2000),
    supabaseAdmin
      .from('client_pipeline_stages')
      .select('stage_key, label')
      .eq('client_id', clientId),
    // 这个人的对话（Messenger / 邮件线程），按 client_id + contact_id 收口。
    supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .eq('contact_id', contactId),
  ])

  if (tErr || eErr) {
    return NextResponse.json({ error: tErr?.message ?? eErr?.message }, { status: 500 })
  }

  // 对话原文（私信 / 邮件正文）。conv id 已按 client_id + contact_id 收口，消息
  // 按这些 id 取跨不了客户。空 body（图片 / 表情 / 附件 / 系统事件）下面丢掉。
  const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id)
  let messages: {
    direction: 'inbound' | 'outbound'
    sender_name: string | null
    body: string | null
    sent_at: string
  }[] = []
  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('direction, sender_name, body, sent_at')
      .in('conversation_id', convIds)
      .order('sent_at', { ascending: false })
      .limit(3000)
    messages = (msgs ?? []) as typeof messages
  }

  const stageLabel = new Map<string, string>()
  for (const s of (stageRows ?? []) as { stage_key: string; label: string }[]) {
    stageLabel.set(s.stage_key, s.label)
  }

  const entries: TimelineEntry[] = []

  for (const t of (touches ?? []) as {
    channel: string
    direction: 'inbound' | 'outbound'
    occurred_at: string
    summary: string | null
    metadata: Record<string, unknown> | null
  }[]) {
    const m = t.metadata ?? {}
    entries.push({
      kind: 'touch',
      at: t.occurred_at,
      channel: t.channel,
      direction: t.direction,
      summary: t.summary,
      // 这一条触点自己带的团意向：FB 表单下拉优先，其次手工笔记解析值。
      tour: cleanStr(m.tour_interest_raw) ?? cleanStr(m.tour_interest),
      outcome: cleanStr(m.outcome),
      travelWindow: cleanStr(m.travel_window),
      callbackAt: cleanStr(m.callback_at),
      competitor: cleanStr(m.competitor),
    })
  }

  for (const e of (events ?? []) as {
    from_stage: string | null
    to_stage: string | null
    changed_by: string | null
    note: string | null
    created_at: string
  }[]) {
    entries.push({
      kind: 'stage',
      at: e.created_at,
      fromStage: e.from_stage,
      toStage: e.to_stage,
      fromLabel: e.from_stage ? (stageLabel.get(e.from_stage) ?? e.from_stage) : null,
      toLabel: e.to_stage ? (stageLabel.get(e.to_stage) ?? e.to_stage) : null,
      changedBy: e.changed_by,
      note: e.note,
    })
  }

  // 对话原文：只渲染有文本的消息。空 body 是图片 / 表情 / 附件 / 系统事件，
  // 铺成空气泡只会干扰，数出来在页尾提一句。方向 + sender 已能区分是客人还是
  // 我们（出站 sender 恒为客户主页名），系统自动回复也一眼看得出，不误当客人的话。
  let omittedMessages = 0
  for (const msg of messages) {
    const body = (msg.body ?? '').trim()
    if (!body) {
      omittedMessages++
      continue
    }
    entries.push({
      kind: 'message',
      at: msg.sent_at,
      direction: msg.direction,
      senderName: msg.sender_name,
      body,
    })
  }

  // 触点 / 对话 / 阶段事件合成一条线，最新在上。
  entries.sort((a, b) => ts(b.at) - ts(a.at))

  return NextResponse.json({
    contact: {
      contactId: contact.id,
      name: contact.display_name || '未留姓名',
      phone: contact.primary_phone,
      email: contact.primary_email,
      stage: contact.stage,
      stageLabel: contact.stage ? (stageLabel.get(contact.stage) ?? contact.stage) : null,
    },
    timeline: entries,
    omittedMessages,
  })
}
