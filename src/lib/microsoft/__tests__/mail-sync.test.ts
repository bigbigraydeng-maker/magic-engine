/**
 * 同步一个邮箱时的两条「不许静默丢人」的规矩。
 *
 * 水位线是「已存对话里最新那封信的时间」。它带来一个不明显但很贵的后果：
 * **只要一条更新的线程落了库，比它旧的线程就再也不会被重新读到。**
 *
 * 所以这里钉两条：
 *   ① 从旧到新处理 —— 顺序错了，第一条落库的就可能是最新那条
 *   ② 一条失败就停 —— 跳过去继续处理更新的，下一轮水位线会永久越过失败那条，
 *      那几个人再也不会进 CRM，而 cron 还把这次记成成功
 *
 * 另外钉一条按邮箱隔离：一个客户可以连两个邮箱，忙的那个不能把安静那个的
 * 水位线一路推到今天。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/platform-oauth/token-manager', () => ({
  getValidTokenForConnection: vi.fn(async () => 'access-token'),
}))
vi.mock('@/lib/microsoft/mail-graph', () => ({ fetchMailSince: vi.fn() }))
vi.mock('@/lib/crm/identity', () => ({ resolveContact: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchMailSince } from '@/lib/microsoft/mail-graph'
import { resolveContact } from '@/lib/crm/identity'
import { syncMailbox } from '../mail-ingest'
import type { MailMessage } from '../mail-graph'

const TARGET = {
  clientId: 'client-1',
  clientName: 'CTS',
  domain: 'ctstours.co.nz',
  connectionId: 'conn-1',
  mailbox: 'info@ctstours.co.nz',
}

/** 每条落库的邮件对话，按落库先后记下来。 */
let storedThreads: string[]
/** 查水位线时用过的过滤条件。 */
let watermarkFilters: Record<string, unknown>

function inboundFrom(address: string, at: string, convId: string): MailMessage {
  return {
    id: `msg-${convId}`,
    conversationId: convId,
    subject: '想问一下行程',
    preview: '你好',
    receivedAt: at,
    counterparty: { address, name: null },
    direction: 'inbound',
  }
}

function mockDb() {
  storedThreads = []
  watermarkFilters = {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        upsert: (row: { conversation_id: string }) => {
          storedThreads.push(row.conversation_id)
          return {
            select: () => ({
              single: async () => ({ data: { id: `cv-${row.conversation_id}`, contact_id: null } }),
            }),
          }
        },
        update: () => {
          const chain = { eq: () => chain, is: async () => ({}) }
          // 直接 await update().eq() 的地方也要能收场。
          return { eq: () => Object.assign(Promise.resolve({}), chain) }
        },
        select: () => {
          const chain = {
            eq: (col: string, val: unknown) => {
              watermarkFilters[col] = val
              return chain
            },
            not: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => ({ data: null }),
          }
          return chain
        },
      }
    }
    if (table === 'conversation_messages') {
      return {
        upsert: () => ({ select: async () => ({ data: [{ id: 'm1' }] }) }),
        select: () => ({ eq: async () => ({ count: 7 }) }),
      }
    }
    if (table === 'contact_identities') {
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: null }) }
      return { select: () => chain }
    }
    if (table === 'contact_touchpoints') {
      return { upsert: () => ({ select: async () => ({ data: [{ id: 't1' }] }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb()
  ;(resolveContact as ReturnType<typeof vi.fn>).mockResolvedValue({
    contactId: 'contact-1',
    created: true,
    matchedIdentities: 0,
  })
})

/** 收件箱给这些信，已发送给空。 */
function inbox(messages: MailMessage[]) {
  ;(fetchMailSince as ReturnType<typeof vi.fn>).mockImplementation(
    async (_t: string, folder: string) => ({
      ok: true,
      messages: folder === 'inbox' ? messages : [],
      truncated: false,
    }),
  )
}

describe('① 从旧到新处理', () => {
  it('先落旧的那条，再落新的', async () => {
    inbox([
      inboundFrom('new@gmail.com', '2026-08-02T10:00:00.000Z', 'cv-new'),
      inboundFrom('old@gmail.com', '2026-08-01T10:00:00.000Z', 'cv-old'),
    ])
    await syncMailbox(TARGET)
    expect(storedThreads).toEqual(['mail:cv-old', 'mail:cv-new'])
  })
})

describe('② 一条失败就停', () => {
  /**
   * 这条是整块设计的理由：如果跳过失败的旧线程继续处理新的，新线程落了库，
   * 下一轮水位线就跨过了旧那条 —— 那个人永远进不了 CRM，而且没人会知道。
   */
  it('旧线程失败 → 更新的那条一条都不落，留给下一轮重来', async () => {
    ;(resolveContact as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ identities }: { identities: { value: string }[] }) => {
        if (identities[0].value === 'old@gmail.com') throw new Error('数据库抽风')
        return { contactId: 'contact-1', created: true, matchedIdentities: 0 }
      },
    )
    inbox([
      inboundFrom('old@gmail.com', '2026-08-01T10:00:00.000Z', 'cv-old'),
      inboundFrom('new@gmail.com', '2026-08-02T10:00:00.000Z', 'cv-new'),
    ])

    const res = await syncMailbox(TARGET)
    expect(storedThreads).toEqual(['mail:cv-old'])
    expect(storedThreads).not.toContain('mail:cv-new')
    expect(res.stoppedEarly).toContain('mail:cv-old')
  })

  /** 失败必须说出来 —— 只写 console.error 的话，cron 会把这次记成干净成功。 */
  it('中途停下要报出来，不许静悄悄记成成功', async () => {
    ;(resolveContact as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('数据库抽风'))
    inbox([inboundFrom('a@gmail.com', '2026-08-01T10:00:00.000Z', 'cv-a')])

    const res = await syncMailbox(TARGET)
    expect(res.stoppedEarly).toBeTruthy()
    expect(res.stoppedEarly).toContain('数据库抽风')
    expect(res.threads).toBe(0)
  })

  it('全都顺利 → 不报「中途停了」', async () => {
    inbox([inboundFrom('a@gmail.com', '2026-08-01T10:00:00.000Z', 'cv-a')])
    const res = await syncMailbox(TARGET)
    expect(res.stoppedEarly).toBeUndefined()
    expect(res.threads).toBe(1)
    expect(res.newContacts).toBe(1)
  })
})

describe('按邮箱隔离', () => {
  /** 一个客户连两个邮箱时，忙的那个不能把安静那个的水位线推走。 */
  it('查水位线时带上这个邮箱，不只按客户查', async () => {
    inbox([])
    await syncMailbox(TARGET)
    expect(watermarkFilters).toMatchObject({
      client_id: 'client-1',
      channel: 'email',
      page_id: 'info@ctstours.co.nz',
    })
  })

  it('落库时把邮箱记在线程上 —— 否则下次分不清是谁的', async () => {
    inbox([inboundFrom('a@gmail.com', '2026-08-01T10:00:00.000Z', 'cv-a')])
    const upserted: Record<string, unknown>[] = []
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row)
            return { select: () => ({ single: async () => ({ data: { id: 'cv1', contact_id: null } }) }) }
          },
          update: () => ({ eq: () => Object.assign(Promise.resolve({}), { is: async () => ({}) }) }),
          select: () => {
            const c = {
              eq: () => c,
              not: () => c,
              order: () => c,
              limit: () => c,
              maybeSingle: async () => ({ data: null }),
            }
            return c
          },
        }
      }
      if (table === 'conversation_messages') {
        return {
          upsert: () => ({ select: async () => ({ data: [] }) }),
          select: () => ({ eq: async () => ({ count: 3 }) }),
        }
      }
      if (table === 'contact_touchpoints') {
        return { upsert: () => ({ select: async () => ({ data: [] }) }) }
      }
      const c = { eq: () => c, maybeSingle: async () => ({ data: null }) }
      return { select: () => c }
    })

    await syncMailbox(TARGET)
    expect(upserted[0]).toMatchObject({ channel: 'email', page_id: 'info@ctstours.co.nz' })
  })
})

describe('读失败', () => {
  /**
   * 只拿到已发送、拿不到收件箱的话，线程看起来全是我们在说话 ——
   * 热线索会被当成「已经跟过」。宁可整次失败。
   */
  it('一个文件夹读不到 → 整次失败，不拿半截数据下判断', async () => {
    ;(fetchMailSince as ReturnType<typeof vi.fn>).mockImplementation(
      async (_t: string, folder: string) =>
        folder === 'inbox'
          ? { ok: false, error: 'HTTP 403' }
          : { ok: true, messages: [], truncated: false },
    )
    const res = await syncMailbox(TARGET)
    expect(res.error).toContain('收件箱')
    expect(storedThreads).toEqual([])
  })

  it('令牌拿不到 → 如实回报，不抛异常（别的邮箱还要跑）', async () => {
    const { getValidTokenForConnection } = await import('@/lib/platform-oauth/token-manager')
    ;(getValidTokenForConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('连接已断开'),
    )
    const res = await syncMailbox(TARGET)
    expect(res.error).toContain('连接已断开')
  })
})
