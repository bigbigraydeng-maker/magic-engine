import { describe, expect, it } from 'vitest'
import { chatIdsForPortalUsers, readFdeTelegramStore } from '../fde-telegram-store'

describe('readFdeTelegramStore', () => {
  it('parses bindings by portal user id', () => {
    const blob = readFdeTelegramStore({
      me_fde_telegram_v1: {
        byPortalUserId: {
          '11111111-1111-1111-1111-111111111111': { chatId: '42', boundAt: '2026-01-01T00:00:00.000Z' },
        },
        pending: {},
      },
    })
    expect(chatIdsForPortalUsers(blob, ['11111111-1111-1111-1111-111111111111', 'missing'])).toEqual(['42'])
  })
})