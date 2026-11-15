/**
 * Outbound send only, as the existing @magicengine_ray_bot.
 * There is no setWebhook, getWebhookInfo, or deleteWebhook here.
 */

const SEND_URL_PREFIX = 'https://api.telegram.org/bot'

export interface TelegramSendDeps {
  token: string
  chatId: string
  fetchImpl?: typeof fetch
}

export async function sendTelegramText(deps: TelegramSendDeps, text: string): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const response = await fetchImpl(`${SEND_URL_PREFIX}${deps.token}/sendMessage`, {
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
