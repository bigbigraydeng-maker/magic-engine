import { describe, expect, it, vi } from 'vitest'
import {
  beginEmailTelegramBind,
  confirmTelegramBind,
  listFdePortalRowsByEmail,
  parseConfirmCode,
  parseStartEmail,
  type BindMailer,
} from '../fde-telegram-bind'

const PORTAL = '11111111-1111-1111-1111-111111111111'
const CLIENT = '22222222-2222-2222-2222-222222222222'
const EMAIL = 'fde@magiclab.com.au'
const mailer: BindMailer = { send: vi.fn(async () => ({ ok: true })) }

function clientsSb(clients: Record<string, { leads_config?: unknown }>) {
  return {
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
          filter: () => ({
            limit: async () => ({
              data: [{ id: CLIENT, leads_config: clients[CLIENT]?.leads_config }],
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
    },
  }
}

describe('fde telegram bind', () => {
  it('parses /start forms', () => {
    expect(parseStartEmail('/start')).toBe('bare_start')
    expect(parseStartEmail(`/start ${EMAIL}`)).toBe(EMAIL)
    expect(parseConfirmCode('482910')).toBe('482910')
  })

  it('unmatched email', async () => {
    const sb = {
      from: () => ({ select: () => ({ ilike: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
    }
    expect((await beginEmailTelegramBind(sb as never, '1', EMAIL, mailer)).kind).toBe('unmatched')
  })

  it('matched bind starts pending', async () => {
    const clients = { [CLIENT]: { leads_config: {} as unknown } }
    expect((await beginEmailTelegramBind(clientsSb(clients) as never, '555', EMAIL, mailer)).kind).toBe('code_sent')
    expect((clients[CLIENT].leads_config as Record<string, unknown>).me_fde_telegram_pending_active).toBeTruthy()
  })

  it('wrong code', async () => {
    const pending = {
      chatId: '555',
      code: '111111',
      email: EMAIL,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      portalUserIds: [PORTAL],
    }
    const sb = {
      from: (table: string) =>
        table === 'clients'
          ? {
              select: () => ({
                filter: () => ({
                  limit: async () => ({ data: [{ id: CLIENT, leads_config: { me_fde_telegram_pending_active: pending } }], error: null }),
                }),
              }),
            }
          : { select: () => ({ ilike: () => ({ in: async () => ({ data: [], error: null }) }) }) },
    }
    expect((await confirmTelegramBind(sb as never, '555', '999999')).kind).toBe('wrong_code')
  })

  it('rebind overwrites chat id', async () => {
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
    const r = await confirmTelegramBind(clientsSb(clients) as never, '777', '424242')
    expect(r).toMatchObject({ kind: 'bound', rebound: true })
    const chats = (clients[CLIENT].leads_config as Record<string, Record<string, { chatId: string }>>)
      .me_fde_telegram_chats
    expect(chats[PORTAL].chatId).toBe('777')
  })

  it('internal FDE rows only', async () => {
    const rows = await listFdePortalRowsByEmail(
      {
        from: () => ({
          select: () => ({
            ilike: () => ({
              in: async () => ({
                data: [
                  { id: PORTAL, client_id: CLIENT, email: EMAIL, access_type: 'fde' },
                  { id: 'x', client_id: CLIENT, email: 'x@guest.test', access_type: 'fde' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      } as never,
      EMAIL,
    )
    expect(rows).toHaveLength(1)
  })
})