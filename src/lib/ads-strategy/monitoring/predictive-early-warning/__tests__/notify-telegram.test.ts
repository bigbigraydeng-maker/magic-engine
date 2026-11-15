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

  it('sends to each chat id once', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }))
    const sender: TelegramSender = { sendMessage }
    const status = await deliverEarlyWarningTelegram(['100', '100', '200'], 'alert', sender)
    expect(status).toBe('sent')
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]?.[0]).toEqual({ chatId: '100', text: 'alert' })
  })

  it('returns send_failed when every chat fails', async () => {
    const sender: TelegramSender = {
      sendMessage: vi.fn(async () => ({ ok: false, error: 'blocked' })),
    }
    expect(await deliverEarlyWarningTelegram(['9'], 'x', sender)).toBe('send_failed')
  })
})