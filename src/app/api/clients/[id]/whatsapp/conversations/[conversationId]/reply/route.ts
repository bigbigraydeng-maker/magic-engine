/**
 * POST /api/clients/[id]/whatsapp/conversations/[conversationId]/reply
 *
 * 顾问在 ME 里回客人的 WhatsApp。
 *
 * ── 为什么这个文件必须存在 ────────────────────────────────────────────────
 * 整条 WhatsApp 链路的前提是「客人在 WhatsApp 说话，顾问在 ME 里回」，而在这之前
 * **ME 里没有任何地方能回 WhatsApp**：`sendWhatsApp` 的生产调用方只有自动问候那条
 * （`messenger-agent/channel-dispatch.ts`），回复接口只存在 `messenger/` 和
 * `email/` 两个。魏征和板桥两个复审各自独立撞到同一条，说法一致：号码一接进来、
 * 客人一发消息，顾问看得到却回不了，只能用自己手机回 —— 那条线 ME 完全看不见，
 * 然后系统天天误报「这个客人没人跟进」。
 *
 * ── 刻意只做自由文本一半 ──────────────────────────────────────────────────
 * Messenger 那条同名路由还有第二半：AI 草稿的「批准 / 改后发送 / 拒绝」三按钮。
 * 这里**不做**，因为 WhatsApp 那侧的草稿目前批不了（那个批准接口写死
 * `channel='messenger'`），而在批准接口通之前落 pending 草稿只会生成一条办不了的
 * 待办。分工写在台账 `2026-09-28-cts-whatsapp-onboarding-design-review`。
 *
 * ── 不新增任何发送能力 ────────────────────────────────────────────────────
 * 发送、24 小时窗口判断、发送前审计、号码归属复核全在 `lib/whatsapp/send.ts`
 * 里（那里先写 `conversation_outbound_log` 再发，写不成就不发）。这个文件只做
 * 三件事：确认是谁在按发送、把请求转过去、把失败原因原样带回前端。
 *
 * Responses:
 *   200  { ok: true, window }
 *   400  内容为空 / 请求格式错误
 *   401  没登录
 *   403  不是这个客户的成员，或者拿不到发送者身份
 *   404  会话不存在
 *   409  24 小时免费窗口已关（`reason: 'window_closed'`）
 *   424  WhatsApp 还没配好（`reason: 'no_token'`）
 *   502  WhatsApp 没收下这条（`reason: 'graph_failed'`）
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendWhatsApp } from '@/lib/whatsapp/send'

interface RouteParams {
  params: { id: string; conversationId: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const email = access.user.email?.toLowerCase().trim()
  if (!email) {
    // 每一条发给客人的消息都必须能归到一个人名下 —— 归不了的发送比不发更糟。
    // 跟 messenger 那条路由同一个判断，不另立规矩。
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof payload.body !== 'string') {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  }

  const result = await sendWhatsApp({
    clientId: params.id,
    conversationId: params.conversationId,
    body: payload.body,
    sentByEmail: email,
    usedAiDraft: payload.usedAiDraft === true,
  })

  if (!result.ok) {
    // `reason` 原样带回：前端按它翻译成顾问能动手的人话（见 ReplyBox 的
    // `humanError`）。把四种原因压成一句「发送失败」会让顾问去做错的事 ——
    // 「号码没绑好」和「窗口关了」的下一步完全不同。
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  return NextResponse.json({ ok: true, window: result.window })
}
