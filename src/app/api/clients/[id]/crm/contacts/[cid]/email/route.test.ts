/**
 * 「这个人能不能在 CRM 里当场回邮件」这个读接口的测试。
 *
 * 照 `.../messenger/route.test.ts` 的样板写，钉的是同一类事：
 *   1. 隔离：查会话必须同时带上 client_id。
 *   2. 一个人可能连了不止一条邮件线程——要回最新那条，那才是他还在说话的地方。
 *   3. 只认 channel='email'，不能把一条私信线程当成邮件线程塞回去。
 *   4. 不返回 replyWindow——邮件没有 Messenger 那种时限窗口，前端据此不显示
 *      窗口提示、也不会因为「窗口」把发送按钮锁死。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({
    ok: true,
    allowedClientId: 'client-a',
    user: { email: 'sales@nal.co.nz' },
  })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/microsoft/mail-send-new', () => ({
  previewCompose: vi.fn(async () => ({ canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@x.co.nz', sentToContactLast7Days: 0 })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

/** 查会话时用到的过滤条件和排序 —— 隔离、渠道、「取最新那条」都靠它验证。 */
let convoFilters: Record<string, unknown>
let convoOrder: { column: string; ascending: boolean } | null

function mockDb(opts: {
  convo?: { id: string; participant_name: string | null } | null
  convos?: Array<{ id: string; participant_name: string | null }>
  /** 有入站消息的会话 id；默认 = 所有候选会话都有（老用例的语义）。 */
  inboundIds?: string[]
}) {
  convoFilters = {}
  convoOrder = null
  const list = opts.convos ?? (opts.convo ? [opts.convo] : [])
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      const chain = {
        eq: (col: string, val: unknown) => {
          convoFilters[col] = val
          return chain
        },
        order: (column: string, o: { ascending: boolean }) => {
          convoOrder = { column, ascending: o.ascending }
          return chain
        },
        limit: async () => ({ data: list, error: null }),
      }
      return { select: () => chain }
    }
    if (table === 'conversation_messages') {
      const ids = opts.inboundIds ?? list.map((c) => c.id)
      const chain = {
        in: () => chain,
        eq: async () => ({ data: ids.map((conversation_id) => ({ conversation_id })), error: null }),
      }
      return { select: () => chain }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const call = () =>
  GET(new NextRequest('http://x/api'), { params: { id: 'client-a', cid: 'contact-1' } })

beforeEach(() => vi.clearAllMocks())

describe('有没有邮件线', () => {
  it('没有会话 → 明确回 null，抽屉里不出现发送框', async () => {
    mockDb({ convo: null })
    const json = await (await call()).json()
    expect(json.conversationId).toBeNull()
    expect(json.compose).toMatchObject({ canCompose: true, recipient: 'amy@gmail.com' })
  })

  it('预览本身出错 → 不报 500，明确说「不能写」让界面不猜', async () => {
    mockDb({ convo: null })
    const { previewCompose } = await import('@/lib/microsoft/mail-send-new')
    ;(previewCompose as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    const json = await (await call()).json()
    expect(json.conversationId).toBeNull()
    expect(json.compose).toMatchObject({ canCompose: false })
  })

  it('有会话 → 回会话 id 和邮件里的显示名', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: 'Susan Lee' } })
    const json = await (await call()).json()
    expect(json).toMatchObject({ conversationId: 'cv-1', participantName: 'Susan Lee' })
  })

  it('一个人连了不止一条邮件线程 → 取最新的那条（他还在说话的地方）', async () => {
    mockDb({ convo: { id: 'cv-new', participant_name: null } })
    await call()
    expect(convoOrder).toMatchObject({ column: 'last_message_at', ascending: false })
  })

  it('只查邮件渠道，不能把私信线程当成邮件塞回去', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null } })
    await call()
    expect(convoFilters.channel).toBe('email')
  })

  it('不返回 replyWindow —— 邮件没有 Messenger 那种时限窗口', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null } })
    const json = await (await call()).json()
    expect(json.replyWindow).toBeUndefined()
  })
})

describe('只有客人来过信的线程才算可回复（发送失败 / 只有我们发出的线程不能让抽屉误显示回复框）', () => {
  it('唯一的线程没有入站消息 → 回 null（抽屉显示写邮件框而不是一个发不出去的回复框）', async () => {
    mockDb({ convos: [{ id: 'cv-out', participant_name: null }], inboundIds: [] })
    const json = await (await call()).json()
    expect(json.conversationId).toBeNull()
  })

  it('最新的线程只有出站、更早的线程有客人来信 → 回更早那条', async () => {
    mockDb({ convos: [{ id: 'cv-new-out', participant_name: null }, { id: 'cv-old-in', participant_name: 'Amy' }], inboundIds: ['cv-old-in'] })
    const json = await (await call()).json()
    expect(json).toMatchObject({ conversationId: 'cv-old-in', participantName: 'Amy' })
  })
})

describe('隔离', () => {
  it('查会话时必须同时带上 client_id 和这个人 —— 不能只按 contact_id 捞', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null } })
    await call()
    expect(convoFilters.client_id).toBe('client-a')
    expect(convoFilters.contact_id).toBe('contact-1')
  })

  it('没有这个客户的权限 → 原样返回鉴权失败，不泄露有没有这条会话', async () => {
    const { requirePaidClientAccess } = await import('@/lib/auth/client-access')
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'not a member',
    })
    const res = await call()
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
