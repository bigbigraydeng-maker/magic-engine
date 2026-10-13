/**
 * GET /api/clients/[id]/crm/contacts/[cid]/timeline
 *
 * 一个人的全渠道往来时间线 —— 「全部客人」页点开某行时拉。触点（FB表单 / 电话 /
 * 私信 / 邮件…）+ 阶段流转事件（谁把他从 X 改到 Y）按时间**从旧到新**合并成一条线。
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
import { reclassifyStoredOutcome } from '@/lib/crm/note-parser'

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

interface CallAnalysisView {
  id: string
  summary: string
  reviewStatus: 'pending_review' | 'confirmed' | 'rejected'
  facts: { key: string; value: string; quote: string }[]
}

function asReviewStatus(v: unknown): CallAnalysisView['reviewStatus'] {
  return v === 'confirmed' || v === 'rejected' ? v : 'pending_review'
}

function asFacts(v: unknown): CallAnalysisView['facts'] {
  if (!Array.isArray(v)) return []
  return v.flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    return typeof o.key === 'string' && typeof o.value === 'string' && typeof o.quote === 'string'
      ? [{ key: o.key, value: o.value, quote: o.quote }]
      : []
  })
}

type TimelineEntry =
  | {
      kind: 'touch'
      at: string
      channel: string
      direction: 'inbound' | 'outbound'
      summary: string | null
      /**
       * 销售**真正敲进去的那句话**（客人的原文 / FDE 的手记）。
       *
       * 🔴 跟 `summary` 不是一回事（Codex 复审 PR #1038，2026-08-17）：
       * `recordManualTouchpoint` 存的 `summary` 是 **AI 生成的摘要**。而复核
       * 「这个人是不是被误判成永久拒联」靠的恰恰是字面差别 ——
       * 「暂时不去」和「别再联系我」摘要之后可能长得一样，判决却天差地别。
       *
       * 只在前端的**判决行**旁边展示（`do_not_contact` / `dnc_cleared`），
       * 不是每条都铺出来：普通记录看摘要更短更好读。
       */
      raw: string | null
      /**
       * `metadata.do_not_contact === true` —— **跟 `outcome` 不是一回事**。
       *
       * 🔴 外呼那条路（`lib/voice/crm-bridge.ts`）写的是
       * `outcome: 'not_interested'` **加上** `do_not_contact: true`，而
       * `isDoNotContact` 认后者 → 这个人**全渠道被停**。只看 `outcome` 的话，
       * 界面上只会显示一句「他说不买了」，销售完全看不到他已经被停了
       * （Codex 复审 PR #1048，2026-08-17）。
       *
       * 判据只有一份（`lib/crm/dnc`），它两个都认，所以送给前端的也得两个都有。
       */
      dncFlag: boolean
      /**
       * `raw` 里装的到底是什么。
       *
       * 🔴 **不是所有 `raw` 都是逐字原话**（Codex 复审 PR #1048，2026-08-17）：
       *   · 手工记录 / 邮件 → 人真敲的字、客人真发的信 = 逐字
       *   · 外呼（`lib/voice/crm-bridge.ts`）→ `raw: call.summary`，而那是
       *     **模型生成**的通话摘要（`voice/finalize.ts` 拼的 `Caller discussed: …`）
       *
       * 前端拿它判断该写「原话」还是「通话摘要」。把 AI 摘要标成原话，
       * 销售会据此决定要不要解除全渠道停联 —— 而他以为自己在看客人说的话。
       */
      rawKind: 'verbatim' | 'ai_summary'

      tour: string | null
      outcome: string | null
      travelWindow: string | null
      callbackAt: string | null
      competitor: string | null
      /** 这通电话的 AI 分析（电话接入的转写 + 提炼）。只读展示 + 人工复核；没有就不带。 */
      callAnalysis?: CallAnalysisView
    }
  | {
      kind: 'message'
      at: string
      direction: 'inbound' | 'outbound'
      senderName: string | null
      body: string
      /**
       * 这条消息走的哪个渠道（`conversations.channel`）。
       *
       * 🔴 前端原先把所有 `message` 硬编码成「私信」（Codex 复审 PR #1038）——
       * 而对话表里还有 `email` / `whatsapp` / `voice`。「他是从哪来的」那一行
       * 据此判断，认错渠道就是给销售一个错的开场依据。
       */
      channel: string | null
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
      .select('channel, direction, occurred_at, summary, raw, metadata')
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
      // channel：前端「他是从哪来的」那一行要用，不能把所有对话都当成私信。
      .select('id, channel')
      .eq('client_id', clientId)
      .eq('contact_id', contactId),
  ])

  if (tErr || eErr) {
    return NextResponse.json({ error: tErr?.message ?? eErr?.message }, { status: 500 })
  }

  // 对话原文（私信 / 邮件正文）。conv id 已按 client_id + contact_id 收口，消息
  // 按这些 id 取跨不了客户。空 body（图片 / 表情 / 附件 / 系统事件）下面丢掉。
  const convRows = (convs ?? []) as { id: string; channel: string | null }[]
  const convIds = convRows.map((c) => c.id)
  // WhatsApp 跟 messenger 一样：触点只是「对话开始 / 最近一次来信 / 最近一次回复」几个
  // 占位标记（给分段引擎用），原文在 conversation_messages。有 WhatsApp 对话的人，
  // 占位标记不进时间线 —— 不然「客人最近一次来信」会夹在真实消息中间，像一条没内容的消息
  // （PM 2026-10-10 看本地页：消息需要更清晰的分段展示）。没有对话记录的人仍显示标记，不让人消失。
  const hasWhatsAppConversation = convRows.some((c) => c.channel === 'whatsapp')
  const convChannel = new Map(convRows.map((c) => [c.id, c.channel]))
  let messages: {
    conversation_id: string
    direction: 'inbound' | 'outbound'
    sender_name: string | null
    body: string | null
    sent_at: string
  }[] = []
  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('conversation_id, direction, sender_name, body, sent_at')
      .in('conversation_id', convIds)
      .order('sent_at', { ascending: false })
      .limit(3000)
    messages = (msgs ?? []) as typeof messages
  }

  // AI 摘要（意向 / 下一步）不再从这里出：2026-10-10 起由列表接口统一算进「该做什么」
  // （lib/crm/brief-lookup → next-action），抽屉顶部那张卡吃的是列表行。这里再查一次是死查询。

  const stageLabel = new Map<string, string>()
  for (const s of (stageRows ?? []) as { stage_key: string; label: string }[]) {
    stageLabel.set(s.stage_key, s.label)
  }

  const entries: TimelineEntry[] = []

  // 电话触点上挂着的 AI 分析：按 client_id 收口，别人的分析编号塞进触点也读不到。
  const analysisIds = [
    ...new Set(
      ((touches ?? []) as { metadata: Record<string, unknown> | null }[])
        .map((t) => t.metadata?.call_analysis_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  ]
  const analyses = new Map<string, CallAnalysisView>()
  if (analysisIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from('telephony_call_analyses')
      .select('id, summary, facts, review_status')
      .eq('client_id', clientId)
      .in('id', analysisIds)
    for (const r of (rows ?? []) as { id: string; summary: string; facts: unknown; review_status: unknown }[]) {
      analyses.set(r.id, { id: r.id, summary: r.summary, reviewStatus: asReviewStatus(r.review_status), facts: asFacts(r.facts) })
    }
  }

  for (const t of (touches ?? []) as {
    channel: string
    direction: 'inbound' | 'outbound'
    occurred_at: string
    summary: string | null
    /** 原话。存量结果值读的时候要靠它重判一次（见 reclassifyStoredOutcome）。 */
    raw: string | null
    metadata: Record<string, unknown> | null
  }[]) {
    if (hasWhatsAppConversation && t.channel === 'whatsapp') continue
    const m = t.metadata ?? {}
    entries.push({
      kind: 'touch',
      at: t.occurred_at,
      channel: t.channel,
      direction: t.direction,
      summary: t.summary,
      raw: cleanStr(t.raw),
      dncFlag: m.do_not_contact === true,
      // 外呼那条路写的是模型摘要，不是逐字原话 —— 靠 voice_call_id 认出来。
      rawKind: m.voice_call_id ? 'ai_summary' : 'verbatim',
      // 这一条触点自己带的团意向：FB 表单下拉优先，其次手工笔记解析值。
      tour: cleanStr(m.tour_interest_raw) ?? cleanStr(m.tour_interest),
      /**
       * 存量结果值读的时候重判一次 —— 跟 today / 全部客人两条读模型用**同一个**
       * 函数（Codex 复审 2026-08-16）。
       *
       * 不做的话，同一个人在列表里写「暂时不考虑」、点开时间线却写「没兴趣」——
       * 而时间线是**翻查这个人到底发生过什么**的主要视图。两处结论打架，
       * 销售会两边都不信。
       */
      outcome: cleanStr(reclassifyStoredOutcome(m.outcome as string | null, t.raw)),
      travelWindow: cleanStr(m.travel_window),
      callbackAt: cleanStr(m.callback_at),
      competitor: cleanStr(m.competitor),
      callAnalysis: typeof m.call_analysis_id === 'string' ? analyses.get(m.call_analysis_id) : undefined,
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
      channel: convChannel.get(msg.conversation_id) ?? null,
    })
  }

  // 触点 / 对话 / 阶段事件合成一条线，**从旧到新**（最新在下）。
  //
  // 为什么不是「最新在上」（2026-07-31 PM 反馈改的）：这条线里混着私信原文，
  // 倒序会把一段对话的回答排在提问前面 —— 一问一答读起来是反的，根本读不通。
  // 聊天记录的天然顺序就是从上往下，抽屉里人的基本信息在顶部、对话往下延伸，
  // 跟微信 / Messenger 的读法一致。
  //
  // ⚠️ 上面取 conversation_messages 时的 `ascending: false` + `limit(3000)`
  // **不能跟着改**：那里倒序是为了「超量时留下最近的 3000 条」。改成正序会变成
  // 留下最老的 3000 条，话痨客户的近期对话反而全丢。排序只在这一行做。
  entries.sort((a, b) => ts(a.at) - ts(b.at))

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
