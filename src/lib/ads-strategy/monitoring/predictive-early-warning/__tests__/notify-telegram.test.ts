import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverEarlyWarningTelegram, type TelegramSender } from '../notify-telegram'

describe('deliverEarlyWarningTelegram', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns telegram_unconfigured when token unset', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN_ME', '')
    expect(await deliverEarlyWarningTelegram(['1'], 'hi')).toBe('telegram_unconfigured')
  })

  it('returns no_chat_ids for empty list', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN_ME', 'test-token')
    expect(await deliverEarlyWarningTelegram([], 'hi', null)).toBe('no_chat_ids')
  })

  it('dedupes chat ids and fails closed when all sends fail', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'blocked' }))
    expect(await deliverEarlyWarningTelegram(['1', '1'], 'x', { sendMessage })).toBe('send_failed')
    expect(sendMessage).toHaveBeenCalledOnce()
  })
})