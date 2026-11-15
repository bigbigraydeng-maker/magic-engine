import { describe, expect, it } from 'vitest'
import { chatIdsFromChatsMap, readChatsByPortalUser } from '../fde-telegram-persist'

describe('fde telegram persist', () => {
  it('reads chat map by portal user id on client leads_config', () => {
    const chats = readChatsByPortalUser({
      me_fde_telegram_chats: {
        '11111111-1111-1111-1111-111111111111': { chatId: '99', boundAt: '2026-01-01T00:00:00.000Z' },
      },
    })
    expect(chatIdsFromChatsMap(chats, ['11111111-1111-1111-1111-111111111111', 'missing'])).toEqual(['99'])
  })
})