import { NextRequest, NextResponse } from 'next/server'
import {
  beginEmailTelegramBind,
  confirmTelegramBind,
  parseConfirmCode,
  parseStartEmail,
} from '@/lib/ads-strategy/monitoring/predictive-early-warning/fde-telegram-bind'
import { defaultTelegramSender } from '@/lib/ads-strategy/monitoring/predictive-early-warning/notify-telegram'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface TelegramUpdate {
  message?: {
    chat?: { id?: number }
    text?: string
  }
}

function replyText(chatId: string, text: string): Promise<void> {
  const sender = defaultTelegramSender()
  if (!sender) return Promise.resolve()
  return sender.sendMessage({ chatId, text }).then(() => undefined)
}

/**
 * Telegram Bot API webhook — FDE self-serve bind only (no outbound to unknown chats except short replies here).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_ME?.trim()
  if (secret) {
    const header = req.headers.get('x-telegram-bot-api-secret-token')
    if (header !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const chatIdRaw = update.message?.chat?.id
  const text = update.message?.text
  if (chatIdRaw === undefined || !text) {
    return NextResponse.json({ ok: true, ignored: true })
  }
  const chatId = String(chatIdRaw)

  const code = parseConfirmCode(text)
  if (code) {
    const result = await confirmTelegramBind(supabaseAdmin, chatId, code)
    if (result.kind === 'bound') {
      const note = result.rebound ? '（已更新绑定）' : ''
      await replyText(chatId, `已绑定 ME 广告预警 Telegram${note}。之后预警会和邮件一起推送到这个对话。`)
      return NextResponse.json({ ok: true, bound: true, rebound: result.rebound })
    }
    if (result.kind === 'expired') {
      await replyText(chatId, '确认码已过期。请重新发送：/start 你的工作邮箱')
    } else if (result.kind === 'wrong_code') {
      await replyText(chatId, '确认码不正确。请检查邮件里的 6 位数字后重试。')
    }
    return NextResponse.json({ ok: true, bound: false, reason: result.kind })
  }

  const start = parseStartEmail(text)
  if (start === 'bare_start') {
    await replyText(
      chatId,
      '请用工作邮箱绑定：/start 你的邮箱@公司域名\n例如：/start name@magiclab.nz\n须是 ME 里已登记的 FDE 内部邮箱。',
    )
    return NextResponse.json({ ok: true, help: true })
  }
  if (typeof start === 'string') {
    const result = await beginEmailTelegramBind(supabaseAdmin, chatId, start)
    if (result.kind === 'code_sent') {
      await replyText(chatId, `已向 ${result.email} 发送 6 位确认码。请在此对话直接回复该数字（15 分钟内有效）。`)
      return NextResponse.json({ ok: true, pending: true })
    }
    if (result.kind === 'mail_failed') {
      await replyText(chatId, '暂时无法发确认邮件，请联系管理员检查 Resend 配置。')
      return NextResponse.json({ ok: true, mail_failed: true })
    }
    await replyText(chatId, '未找到该邮箱对应的 ME FDE 账号。请用你在 ME 登记的工作邮箱重试。')
    return NextResponse.json({ ok: true, unmatched: true })
  }

  return NextResponse.json({ ok: true, ignored: true })
}