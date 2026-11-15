import { NextRequest, NextResponse } from 'next/server'
import {
  completeBindFromStartCommand,
  parseTelegramStartPayload,
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
 * Telegram Bot API webhook — only handles FDE `/start <code>` binding.
 * Does not message unknown chats except binding replies to users who sent a valid/invalid code.
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
  const code = parseTelegramStartPayload(update.message?.text)
  if (chatIdRaw === undefined || !code) {
    return NextResponse.json({ ok: true, ignored: true })
  }
  const chatId = String(chatIdRaw)
  const result = await completeBindFromStartCommand(supabaseAdmin, code, chatId)
  if (result.ok) {
    await replyText(chatId, '已绑定 Magic Engine 广告预警 Telegram。之后预警会和邮件一起推送到这个对话。')
    return NextResponse.json({ ok: true, bound: true })
  }
  if (result.reason === 'expired') {
    await replyText(chatId, '绑定码已过期，请在 ME 后台重新申请新的 /start 码。')
  } else if (result.reason === 'store_unconfigured') {
    await replyText(chatId, 'Telegram 预警尚未在服务器上配置，请联系管理员。')
  } else {
    await replyText(chatId, '绑定码无效。请确认复制了完整的 8 位码。')
  }
  return NextResponse.json({ ok: true, bound: false, reason: result.reason })
}