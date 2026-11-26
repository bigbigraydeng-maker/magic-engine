const TELEGRAM_BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN_ME'

export type EarlyWarningTelegramStatus =
  | 'sent'
  | 'no_chat_ids'
  | 'telegram_unconfigured'
  | 'send_failed'
  | 'partial_sent'

export interface TelegramSender {
  sendMessage(input: { chatId: string; text: string }): Promise<{ ok: boolean; error?: string }>
}

function botToken(): string | null {
  const t = process.env[TELEGRAM_BOT_TOKEN_ENV]?.trim()
  return t && t.length > 0 ? t : null
}

export function defaultTelegramSender(token?: string): TelegramSender | null {
  const resolved = token ?? botToken()
  if (!resolved) return null
  return {
    async sendMessage({ chatId, text }) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${resolved}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          return { ok: false, error: body || `HTTP ${res.status}` }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
      }
    },
  }
}

export async function deliverEarlyWarningTelegram(
  chatIds: readonly string[],
  text: string,
  sender?: TelegramSender | null,
): Promise<EarlyWarningTelegramStatus> {
  const unique = Array.from(new Set(chatIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (unique.length === 0) return 'no_chat_ids'
  const api = sender === undefined ? defaultTelegramSender() : sender
  if (!api) return 'telegram_unconfigured'
  let sent = 0
  let failed = false
  for (const chatId of unique) {
    const r = await api.sendMessage({ chatId, text })
    if (r.ok) sent += 1
    else failed = true
  }
  if (sent === 0) return 'send_failed'
  if (failed) return 'partial_sent'
  return 'sent'
}