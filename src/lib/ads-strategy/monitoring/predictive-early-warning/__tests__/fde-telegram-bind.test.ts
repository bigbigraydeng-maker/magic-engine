import { describe, expect, it, vi } from 'vitest'
import {
  beginEmailTelegramBind,
  confirmTelegramBind,
  listFdePortalRowsByEmail,
  parseConfirmCode,
  parseStartEmail,
} from '../fde-telegram-bind'
import type { BindMailer } from '../fde-telegram-bind-email'

const PORTAL = '11111111-1111-1111-1111-111111111111'
const CLIENT = '22222222-2222-2222-2222-222222222222'
const EMAIL = 'fde@magiclab.com.au'

const mailer: BindMailer = { send: vi.fn(async () => ({ ok: true })) }

describe('parse telegram bind messages', () => {
  it('parses /start and email forms', () => {
    expect(parseStartEmail('/start')).toBe('bare_start')
    expect(parseStartEmail('/start fde@magiclab.com.au')).toBe('fde@magiclab.com.au')
    expect(parseConfirmCode('482910')).toBe('482910')
    expect(parseConfirmCode('48ab10')).toBeNull()
  })
})

describe('beginEmailTelegramBind', () => {
  it('rejects unmatched email', async () => {
    const sb = {
      from: () => ({
        select: () => ({
          ilike: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }
    const result = await beginEmailTelegramBind(sb as never, '123', EMAIL, mailer)
    expect(result.kind).toBe('unmatched')
  })

  it('starts pending bind for known FDE', async () => {
    const clients: Record<string, { leads_config?: unknown }> = { [CLIENT]: { leads_config: {} } }
    const sb = {
      from: (table: string) => {
        if (table === 'client_portal_users') {
          return {
            select: () => ({
              ilike: () => ({
                in: async () => ({
                  data: [{ id: PORTAL, client_id: CLIENT, email: EMAIL, access_type: 'fde' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({ data: { leads_config: clients[id]?.leads_config ?? {} }, error: null }),
            }),
          }),
          update: (p: { leads_config: unknown }) => ({
            eq: async (_c: string, id: string) => {
              if (clients[id]) clients[id].leads_config = p.leads_config
              return { error: null }
            },
          }),
        }
      },
    }
    const result = await beginEmailTelegramBind(sb as never, '555', EMAIL, mailer)
    expect(result.kind).toBe('code_sent')
    const pending = (clients[CLIENT].leads_config as Record<string, unknown>).me_fde_telegram_pending_active
    expect(pending).toMatchObject({ chatId: '555', email: EMAIL })
  })
})

describe('confirmTelegramBind', () => {
  it('rejects wrong code', async () => {
    const pending = {
      chatId: '555',
      code: '111111',
      email: EMAIL,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      portalUserIds: [PORTAL],
    }
    const sb = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              filter: () => ({
                limit: async () => ({
                  data: [{ id: CLIENT, leads_config: { me_fde_telegram_pending_active: pending } }],
                  error: null,
                }),
              }),
            }),
          }
        }
        return { select: () => ({ ilike: () => ({ in: async () => ({ data: [], error: null }) }) }) }
      },
    }
    expect((await confirmTelegramBind(sb as never, '555', '999999')).kind).toBe('wrong_code')
  })

  it('binds and replaces prior chat id (rebind)', async () => {
    const pending = {
      chatId: '777',
      code: '424242',
      email: EMAIL,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      portalUserIds: [PORTAL],
    }
    const clients: Record<string, { leads_config?: unknown }> = {
      [CLIENT]: {
        leads_config: {
          me_fde_telegram_pending_active: pending,
          me_fde_telegram_chats: { [PORTAL]: { chatId: '111', boundAt: '2020-01-01T00:00:00.000Z' } },
        },
      },
    }
    const sb = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              filter: () => ({
                limit: async () => ({
                  data: [{ id: CLIENT, leads_config: clients[CLIENT].leads_config }],
                  error: null,
                }),
              }),
              eq: (_c: string, id: string) => ({
                maybeSingle: async () => ({ data: { leads_config: clients[id]?.leads_config }, error: null }),
              }),
            }),
            update: (p: { leads_config: unknown }) => ({
              eq: async (_c: string, id: string) => {
                clients[id].leads_config = p.leads_config
                return { error: null }
              },
            }),
          }
        }
        return {
          select: () => ({
            ilike: () => ({
              in: async () => ({
                data: [{ id: PORTAL, client_id: CLIENT, email: EMAIL, access_type: 'fde' }],
                error: null,
              }),
            }),
          }),
        }
      },
    }
    const result = await confirmTelegramBind(sb as never, '777', '424242')
    expect(result.kind).toBe('bound')
    expect(result.rebound).toBe(true)
    const chats = (clients[CLIENT].leads_config as Record<string, unknown>).me_fde_telegram_chats as Record<
      string,
      { chatId: string }
    >
    expect(chats[PORTAL].chatId).toBe('777')
  })
})

describe('listFdePortalRowsByEmail', () => {
  it('returns only internal FDE rows', async () => {
    const sb = {
      from: () => ({
        select: () => ({
          ilike: () => ({
            in: async () => ({
              data: [
                { id: PORTAL, client_id: CLIENT, email: EMAIL, access_type: 'fde' },
                { id: 'x', client_id: CLIENT, email: 'client@guest.test', access_type: 'fde' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const rows = await listFdePortalRowsByEmail(sb as never, EMAIL)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe(EMAIL)
  })
})