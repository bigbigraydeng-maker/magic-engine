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
vi.mock('@/lib/microsoft/mail-graph', () => ({ fetchMailSince: vi.fn(), fetchFormNoticeSource: vi.fn() }))
vi.mock('@/lib/crm/web-form-lead', () => ({ mirrorWebFormLead: vi.fn() }))
vi.mock('@/lib/crm/identity', () => ({ resolveContact: vi.fn() }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn(async () => ({ event_ids: ['evt-1'] })) }))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchMailSince, fetchFormNoticeSource } from '@/lib/microsoft/mail-graph'
import { mirrorWebFormLead } from '@/lib/crm/web-form-lead'
import { resolveContact } from '@/lib/crm/identity'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
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
    hasAttachment: false,
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
        // 回声式假实现：真实 upsert(ignoreDuplicates) 只回传真正插进去的行，
        // 这里没有已存数据可去重，所以每一行都当"新插入"回声回去——带上
        // `message_id`，`storeThread`/`emitNewInboundMessageEvents` 都要用它
        // 判断该给哪条消息 emit 事件。
        upsert: (rows: { message_id: string }[]) => ({
          select: async () => ({ data: rows.map((r) => ({ id: `row-${r.message_id}`, message_id: r.message_id })) }),
        }),
        // 同一个 `.select().eq()` 形状服务两处调用：算总条数的 `{count:'exact',
        // head:true}` 查询（取 `count`），和去重预检的「这条线程已经存了哪些信」
        // 查询（取 `data`，见 mail-ingest.ts 的 `messageSignature` 那段）——两边
        // 都不关心对方要的字段，所以两个字段都给，都不解构到 undefined。
        select: () => ({ eq: async () => ({ data: [], count: 7 }) }),
      }
    }
    if (table === 'contact_identities') {
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: null }) }
      return { select: () => chain }
    }
    if (table === 'contact_touchpoints') {
      // `select()` 服务去重预检（「这个人身上已经有哪些同渠道触点」，见
      // mail-ingest.ts 的 `writeTouchpoints`，三个 `.eq()` 分别过滤 client_id /
      // contact_id / channel）——这批测试不关心去重本身，让它查回「什么都
      // 没有」，行为等同于改动前（每条都当新的写）。
      return {
        upsert: () => ({ select: async () => ({ data: [{ id: 't1' }] }) }),
        select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }),
      }
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

describe('换 id 格式的兜底去重——只在切换那一刻之前收到的信上生效', () => {
  /**
   * 子牙架构复审 PR #1714 抓到的问题：这份按「方向 + 发送时间（秒）」认重复
   * 的兜底，如果永久生效，同一条线程里同一秒来两封方向相同的不同邮件（客户
   * 连发两条、或历史批量回填的巧合）会被误判成重复，第二封永久静默丢失。
   * 这两个测试钉住修完之后的边界：切换时刻之前的信仍然兜底去重（这是这段
   * 代码存在的理由——库里已经躺着一批旧 id 格式的信）；切换时刻之后收到的信
   * 永远不套用这份兜底，同一秒两封不同的信都会被存下来。
   */
  let upsertedRows: unknown[]

  function mockExistingMessage(direction: 'inbound' | 'outbound', sentAt: string) {
    upsertedRows = []
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          upsert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'cv-x', contact_id: null } }),
            }),
          }),
          update: () => ({ eq: () => ({ is: async () => ({}) }) }),
          select: () => {
            const chain = {
              eq: () => chain,
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
          upsert: (rows: unknown[]) => {
            upsertedRows = rows
            return { select: async () => ({ data: rows.map(() => ({ id: 'm-new' })) }) }
          },
          select: () => ({
            eq: async () => ({
              data: [{ message_id: 'old-rest-id', direction, sent_at: sentAt }],
              count: 1,
            }),
          }),
        }
      }
      if (table === 'contact_identities') {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: null }) }
        return { select: () => chain }
      }
      if (table === 'contact_touchpoints') {
        return {
          upsert: () => ({ select: async () => ({ data: [] }) }),
          select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  }

  it('切换之前收到的信 —— 换了 id 格式的同一封信不会被当成新信重复插入', async () => {
    mockExistingMessage('inbound', '2026-08-01T01:00:00.000Z')
    inbox([inboundFrom('a@gmail.com', '2026-08-01T01:00:00.000Z', 'cv-x')])
    await syncMailbox(TARGET)
    expect(upsertedRows).toHaveLength(0)
  })

  it('切换之后收到的信 —— 同一秒、同方向的不同邮件也要存下来，不套用指纹兜底', async () => {
    // 库里那封「已存」的信时间点在切换之后（正常情况下它本来就是用新 id 格式
    // 存的，id 对得上号根本不会走到指纹这条兜底）——这里故意让新来的这封 id
    // 不同但同一秒、同方向，专门验证「切换之后」不会被指纹误判成重复而丢掉。
    mockExistingMessage('inbound', '2026-09-16T01:00:00.000Z')
    inbox([inboundFrom('a@gmail.com', '2026-09-16T01:00:00.000Z', 'cv-x')])
    await syncMailbox(TARGET)
    expect(upsertedRows).toHaveLength(1)
  })
})

describe('emit conversation/message.received（issue #1745——下游 F1-F4 靠这个事件驱动）', () => {
  it('新入站邮件 → emit 一次，channel=email，带上 contact_id', async () => {
    inbox([inboundFrom('a@gmail.com', '2026-08-01T01:00:00.000Z', 'cv-a')])
    await syncMailbox(TARGET)

    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation/message.received',
        data: expect.objectContaining({
          channel: 'email',
          client_id: 'client-1',
          contact_id: 'contact-1',
          direction: 'inbound',
          message_id: 'msg-cv-a',
        }),
      }),
    )
  })

  it('纯出站线程（我们主动发的）→ 不 emit，客人没说过话不该触发下游自动回复', async () => {
    inbox([])
    ;(fetchMailSince as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, folder: string) => ({
      ok: true,
      messages:
        folder === 'sentitems'
          ? [
              {
                id: 'out-1',
                conversationId: 'cv-out',
                subject: '报价',
                preview: '附上报价',
                hasAttachment: false,
                receivedAt: '2026-08-01T01:00:00.000Z',
                counterparty: { address: 'vendor@example.com', name: null },
                direction: 'outbound' as const,
              },
            ]
          : [],
      truncated: false,
    }))
    await syncMailbox(TARGET)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('emit 失败 → 只打日志，不影响这次同步的落库结果（best-effort，跟 Messenger/WhatsApp webhook 同一个态度）', async () => {
    ;(sendInngestEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('INNGEST_EVENT_KEY_MISSING'))
    inbox([inboundFrom('a@gmail.com', '2026-08-01T01:00:00.000Z', 'cv-a')])
    const res = await syncMailbox(TARGET)
    expect(res.stoppedEarly).toBeUndefined()
    expect(res.threads).toBe(1)
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

describe('⑤ 网站表单通知（发件人是本邮箱自己）', () => {
  const FORM_BODY =
    'New message — Contact form (Example site)\nName\tJane Test\nEmail\tjane@example.com\nPhone\t0211234567\nTravel interest\tCustom Itinerary\nForm URL\t/contact\n\nMessage\n\nhello'
  const GOOD_HEADERS = [
    { name: 'Authentication-Results', value: 'mx 1; dkim=pass header.d=ctstours.co.nz; dmarc=pass header.from=ctstours.co.nz' },
    { name: 'DKIM-Signature', value: 'v=1; s=resend; d=ctstours.co.nz; t=1' },
  ]
  function formNotice(): MailMessage {
    return {
      id: 'msg-form-1',
      conversationId: 'cv-self',
      subject: 'Contact form: Custom Itinerary — Jane',
      preview: 'Name Jane Test Email jane@example.com Phone 0211234567',
      hasAttachment: false,
      receivedAt: '2026-10-19T01:29:20.000Z',
      counterparty: { address: 'info@ctstours.co.nz', name: 'CTS Tours' },
      direction: 'inbound',
    }
  }

  it('识别成功 → 走 mirrorWebFormLead 建人，不走默认 resolveContact，不触发事件', async () => {
    ;(fetchFormNoticeSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      source: { body: FORM_BODY, replyTo: ['jane@example.com'], headers: GOOD_HEADERS },
    })
    ;(mirrorWebFormLead as ReturnType<typeof vi.fn>).mockResolvedValue({ contactId: 'contact-form', skipped: null })
    inbox([formNotice()])
    const res = await syncMailbox(TARGET)
    expect(storedThreads).toEqual(['mail-form:msg-form-1'])
    expect(resolveContact).not.toHaveBeenCalled()
    expect(mirrorWebFormLead).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'msg-form-1', email: 'jane@example.com', phone: null, clientId: 'client-1' }),
    )
    expect(sendInngestEvent).not.toHaveBeenCalled()
    expect(res.formEnquiries).toMatchObject({ recognised: 1, parsed: 1, created: 1, failed: 0 })
    expect(res.stoppedEarly).toBeUndefined()
  })

  it('出发时间/预算选项映射不到代码 → 回执计 unknownExtras，并留一条日志（不含客人信息）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(fetchFormNoticeSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      source: { body: FORM_BODY.replace('Form URL\t/contact', 'Form URL\t/contact\nTravel window\tEarly 2028'), replyTo: ['jane@example.com'], headers: GOOD_HEADERS },
    })
    ;(mirrorWebFormLead as ReturnType<typeof vi.fn>).mockResolvedValue({ contactId: 'contact-form', skipped: null })
    inbox([formNotice()])
    const res = await syncMailbox(TARGET)
    expect(res.formEnquiries?.unknownExtras).toBe(1)
    const msg = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('[mail-form]'))
    expect(msg).toBeTruthy()
    expect(msg).not.toContain('jane@example.com')
    warn.mockRestore()
  })

  it('读不到全文 → 不入库、不建人、不拦后面的邮件，只计数', async () => {
    ;(fetchFormNoticeSource as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'HTTP 429' })
    inbox([formNotice(), inboundFrom('real@gmail.com', '2026-10-19T02:00:00.000Z', 'cv-real')])
    const res = await syncMailbox(TARGET)
    expect(storedThreads).toEqual(['mail:cv-real'])
    expect(mirrorWebFormLead).not.toHaveBeenCalled()
    expect(res.formEnquiries?.failed).toBe(1)
    expect(res.stoppedEarly).toBeUndefined()
  })

  it('mirrorWebFormLead 返回 error → 按「一条失败就停」处理，水位线不越过', async () => {
    ;(fetchFormNoticeSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      source: { body: FORM_BODY, replyTo: ['jane@example.com'], headers: GOOD_HEADERS },
    })
    ;(mirrorWebFormLead as ReturnType<typeof vi.fn>).mockResolvedValue({ contactId: null, skipped: 'error' })
    inbox([formNotice()])
    const res = await syncMailbox(TARGET)
    expect(res.stoppedEarly).toContain('mail-form:msg-form-1')
  })
})
