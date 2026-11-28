/**
 * Outbound send only, as the existing @magicengine_ray_bot.
 * There is no setWebhook, getWebhookInfo, or deleteWebhook here.
 */

const SEND_URL_PREFIX = 'https://api.telegram.org/bot'

/** Bound for both the morning push and a card notice. A stuck Bot API must not hold the card. */
export const TELEGRAM_SEND_TIMEOUT_MS = 5000

export interface TelegramSendDeps {
  token: string
  chatId: string
  fetchImpl?: typeof fetch
}

export async function sendTelegramText(deps: TelegramSendDeps, text: string): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const response = await boundedFetch(fetchImpl, `${SEND_URL_PREFIX}${deps.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: deps.chatId,
      text,
      disable_web_page_preview: true,
    }),
  })
  if (!response.ok) throw new Error(`telegram send failed: ${response.status}`)
}

async function boundedFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const request = fetchImpl(url, { ...init, signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS) })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('telegram send timed out')), TELEGRAM_SEND_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request, timeout])
  } catch (err) {
    if (err instanceof Error && err.message === 'telegram send timed out') throw err
    throw new Error('telegram send failed')
  } finally {
    if (timer) clearTimeout(timer)
    void request.catch(() => undefined)
  }
}
