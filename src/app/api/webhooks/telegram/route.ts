/**
 * POST /api/webhooks/telegram
 *
 * Verifies X-Telegram-Bot-Api-Secret-Token, then drops any update whose
 * from.id or chat.id is not the allow-listed owner. Does not execute a
 * confirmation, does not send a reply, and does not call setWebhook.
 *
 * If another service already owns this bot's webhook, it can forward the
 * raw update here with the same header. Registering this URL on the bot
 * would replace that service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { inspectTelegramUpdate } from '@/lib/telegram/ingress'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const result = inspectTelegramUpdate({
    secretHeader: req.headers.get('x-telegram-bot-api-secret-token'),
    rawBody,
  })
  return NextResponse.json(result.body, { status: result.status })
}
