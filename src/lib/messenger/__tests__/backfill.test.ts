/**
 * 补挂历史私信对话的测试。
 *
 * 最要命的一条在最下面：`conversation_messages` 表**没存 Meta 的 tags**，所以补挂
 * 时分不出「真人客服回的」和「Business AI 自动回的」。要是照写出站触点，等于告诉
 * 系统「我们已经联系过这个人了」—— 该打的热线索会直接掉出「今天该联系谁」。
 * CTS 收件箱里满屏都是「FB AI responding」，这不是理论风险。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { backfillUnlinkedConversations } from '../backfill'
import type { IdentityIndex } from '../link-contacts'

const CLIENT = 'client-cts'

/** attachByUniqueFullName 查同名时库里返回什么（默认没有同名的人）。 */
let nameLookupRows: { id: string; display_name: string | null }[] = []

const emptyIndex = (): IdentityIndex => ({ byEmail: new Map(), byPsid: new Map() })

interface Captured {
  touchpointRows: Record<string, unknown>[]
  contactInserts: Record<string, unknown>[]
  conversationUpdates: number
}

/**
 * unlinked：模拟库里还没挂上人的老对话
 * messages：每条对话对应的历史消息
 */
function mockDb(
  unlinked: Record<string, unknown>[],
  messages: Record<string, unknown>[],
  remaining = 0,
): Captured {
  const captured: Captured = { touchpointRows: [], contactInserts: [], conversationUpdates: 0 }
  nameLookupRows = []

  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          if (!opts?.head) return chain
          // 结尾那次「还剩几条」的计数查询。链式写成可以连着 .eq() 任意多次，
          // 免得以后往查询里多加一个过滤条件（比如「只算私信」）就把测试打挂。
          const count: Record<string, unknown> = {
            eq: () => count,
            is: () => Promise.resolve({ count: remaining }),
          }
          return count
        },
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: unlinked, error: null }),
        update: () => {
          captured.conversationUpdates++
          return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) }
        },
      }
      return chain
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: messages }) }) }),
      }
    }
    if (table === 'contact_identities') {
      return {
        select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [] }) }) }),
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'contacts') {
      return {
        insert: (payload: Record<string, unknown>) => {
          captured.contactInserts.push(payload)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'person-new' } }) }) }
        },
        select: () => ({
          in: () => ({ order: () => Promise.resolve({ data: [] }) }),
          // attachByUniqueFullName 的同名查询：默认查不到同名的人，走新建那条路。
          eq: () => ({
            ilike: () => ({ limit: async () => ({ data: nameLookupRows, error: null }) }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({ lt: () => Promise.resolve({ error: null }) }),
            is: () => Promise.resolve({ error: null }),
          }),
        }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: (rows: Record<string, unknown>[]) => {
          captured.touchpointRows.push(...rows)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return captured
}

const convo = (over: Record<string, unknown> = {}) => ({
  id: 'convo-1',
  participant_psid: 'psid_A',
  participant_name: 'Susan Storer',
  message_count: 17,
  last_message_at: '2026-07-30T04:23:45Z',
  last_message_from: 'page',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('backfillUnlinkedConversations', () => {
  it('把昨天聊完、之后没再说话的老对话补挂成一个人', async () => {
    const captured = mockDb(
      [convo()],
      [
        { direction: 'inbound', body: '你们有长城的团吗', sent_at: '2026-07-30T04:20:00Z' },
        { direction: 'outbound', body: 'Kia ora!', sent_at: '2026-07-30T04:23:45Z' },
      ],
    )

    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())

    expect(res).toMatchObject({ processed: 1, linked: 1, created: 1 })
    expect(captured.contactInserts[0]).toMatchObject({ display_name: 'Susan Storer' })
    expect(captured.conversationUpdates).toBe(1)
  })

  it('🔴 绝不写出站触点 —— 库里没存 tags，分不出真人回复和 Business AI', async () => {
    const captured = mockDb(
      [convo()],
      [
        { direction: 'inbound', body: '有兴趣', sent_at: '2026-07-30T04:20:00Z' },
        // 这条极可能是 Business AI 自动回的（CTS 收件箱满屏「FB AI responding」）。
        // 当成真人写进触点 = 这个人被标成「已联系」，从「今天该联系谁」里消失。
        { direction: 'outbound', body: 'Kia ora! Thanks for...', sent_at: '2026-07-30T04:23:45Z' },
      ],
    )

    await backfillUnlinkedConversations(CLIENT, emptyIndex())

    const directions = captured.touchpointRows.map((t) => t.direction)
    expect(directions).toEqual(['inbound'])
    expect(directions).not.toContain('outbound')
  })

  it('客户一句话没说的线程不建人（护栏跟着实时同步走，不另开后门）', async () => {
    const captured = mockDb(
      [convo()],
      [{ direction: 'outbound', body: '群发', sent_at: '2026-07-30T04:23:45Z' }],
    )

    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())
    expect(res).toMatchObject({ processed: 1, linked: 0, created: 0 })
    expect(captured.contactInserts).toEqual([])
  })

  it('一条消息都没存的线程直接跳过，不计入 processed', async () => {
    mockDb([convo()], [])
    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())
    expect(res.processed).toBe(0)
  })

  it('回报还剩多少条 —— 能看出还要几轮清完积压', async () => {
    mockDb(
      [convo()],
      [{ direction: 'inbound', body: 'hi', sent_at: '2026-07-30T04:20:00Z' }],
      99,
    )
    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())
    expect(res.remaining).toBe(99)
  })

  it('读表失败时如实返回空，不抛异常（不能拖垮本轮实时同步）', async () => {
    // 写成全链式的，往查询里多加一个过滤条件不会把这条用例打挂 ——
    // 它要验的是「读表失败怎么办」，不是「查询长什么样」。
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }
      return { select: () => chain }
    })

    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())
    expect(res).toEqual({ processed: 0, linked: 0, created: 0, remaining: 0 })
  })
})

describe('补挂时也走「唯一全名认亲」', () => {
  it('老对话的名字唯一命中已有的人 → 挂上去，不再多建一条', async () => {
    const captured = mockDb(
      [convo()],
      [{ direction: 'inbound', body: '你们有长城的团吗', sent_at: '2026-07-30T04:20:00Z' }],
    )
    nameLookupRows = [{ id: 'contact-FORM', display_name: 'Susan Storer' }]

    const res = await backfillUnlinkedConversations(CLIENT, emptyIndex())

    expect(res).toMatchObject({ processed: 1, linked: 1, created: 0 })
    expect(captured.contactInserts).toEqual([]) // 没有多出一条重复记录
  })
})
