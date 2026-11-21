/**
 * Flag-off returns before the push module is loaded, so issuing a card
 * does not send and does not need Telegram configured.
 */

import type { CardNotice } from './push'

export async function notifyIssuedConfirmationCardSafe(args: CardNotice): Promise<void> {
  if (process.env.TELEGRAM_TODO_PUSH_ENABLED !== 'true') return
  try {
    const { notifyIssuedConfirmationCard } = await import('./push')
    await notifyIssuedConfirmationCard(args)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error'
    console.error('[telegram] 确认卡提醒没发出去', message)
  }
}
