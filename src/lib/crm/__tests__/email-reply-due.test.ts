/**
 * 「客人来信超过一天没人回」的判据。
 *
 * 每一条排除都单独钉一次 —— 这一栏一旦冒出一批明显不该提醒的条目
 * （自动回执、同事之间的信、已经说过别再联系的人），销售会把整栏忽略掉，
 * 那比没有这一栏更糟。
 *
 * 取数那一半用假 Supabase 端到端跑一遍，**列名照真 schema**
 * （`supabase/migrations/20260726000001_messenger_conversations.sql`
 * + `20260726000004_unified_contacts.sql` + `20260726000005_contact_touchpoints.sql`）。
 * 自编形状会得到「测试全绿、生产全空」。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pickReplyDue,
  findEmailRepliesDue,
  isFormEnquirySubject,
  isEnquiryTouch,
  platformOwnDomains,
  ENQUIRY_IDENTITY_SOURCES,
  REPLY_SLA_HOURS,
  MAX_PER_CLIENT,
  type EmailThread,
  type ReplyDueInput,
} from '../email-reply-due'

const NOW = new Date('2026-09-03T00:00:00Z')
const CLIENT = 'c1'

function thread(over: Partial<EmailThread> = {}): EmailThread {
  return {
    conversationId: 'v1',
    clientId: CLIENT,
    contactId: 'p1',
    subject: 'Re: China tour enquiry',
    // 48 小时前
    lastMessageAt: '2026-09-01T00:00:00Z',
    lastMessageFrom: 'customer',
    ...over,
  }
}

function input(over: Partial<ReplyDueInput> = {}): ReplyDueInput {
  return {
    threads: [thread()],
    dnc: new Map(),
    lastHumanTouchAt: new Map(),
    emails: new Map(),
    names: new Map(),
    rules: new Map(),
    now: NOW,
    ...over,
  }
}

describe('pickReplyDue —— 超时口径', () => {
  it('阈值就是 24 小时，周末不豁免（PM 2026-09-03）', () => {
    expect(REPLY_SLA_HOURS).toBe(24)
  })

  it('差 1 分钟不到 24 小时 → 不报', () => {
    const res = pickReplyDue(
      input({ threads: [thread({ lastMessageAt: '2026-09-02T00:01:00Z' })] }),
    )
    expect(res.items).toEqual([])
  })

  it('刚好满 24 小时 → 报', () => {
    const res = pickReplyDue(
      input({ threads: [thread({ lastMessageAt: '2026-09-02T00:00:00Z' })] }),
    )
    expect(res.items).toHaveLength(1)
    expect(res.items[0].waitingHours).toBe(24)
  })

  it('周末照算自然小时 —— 周六来的信周一还是 48 小时', () => {
    // 2026-09-05 是周六，2026-09-07 周一
    const res = pickReplyDue(
      input({
        threads: [thread({ lastMessageAt: '2026-09-05T09:00:00Z' })],
        now: new Date('2026-09-07T09:00:00Z'),
      }),
    )
    expect(res.items[0].waitingHours).toBe(48)
  })

  it('30 天窗口之外的老线程不再提', () => {
    const res = pickReplyDue(input({ threads: [thread({ lastMessageAt: '2026-07-01T00:00:00Z' })] }))
    expect(res.items).toEqual([])
  })
})

describe('pickReplyDue —— 哪些不算欠回信', () => {
  it('最后说话的是我们（page）→ 球不在我们这，不报', () => {
    const res = pickReplyDue(input({ threads: [thread({ lastMessageFrom: 'page' })] }))
    expect(res.items).toEqual([])
  })

  it('last_message_from 是 null → 不报（不知道谁最后说话就不催）', () => {
    const res = pickReplyDue(input({ threads: [thread({ lastMessageFrom: null })] }))
    expect(res.items).toEqual([])
  })

  it("主题是 'Automatic reply:' → 不报", () => {
    const res = pickReplyDue(
      input({ threads: [thread({ subject: 'Automatic reply: China tour enquiry' })] }),
    )
    expect(res.items).toEqual([])
  })

  it("主题是 'Undeliverable:' → 不报", () => {
    const res = pickReplyDue(
      input({ threads: [thread({ subject: 'Undeliverable: China tour enquiry' })] }),
    )
    expect(res.items).toEqual([])
  })

  it("'Re: Automatic reply: …' 也是自动回执 → 不报", () => {
    const res = pickReplyDue(
      input({ threads: [thread({ subject: 'Re: Automatic reply: out today' })] }),
    )
    expect(res.items).toEqual([])
  })

  it('正常主题里出现 out of office 字样 → 照报（只看开头，不看包含）', () => {
    const res = pickReplyDue(
      input({ threads: [thread({ subject: 'Re: 关于 out of office 期间的行程' })] }),
    )
    expect(res.items).toHaveLength(1)
  })

  it('同事域名（自己人）→ 不报', () => {
    const res = pickReplyDue(
      input({
        emails: new Map([['p1', ['pa@ctstours.co.nz']]]),
        rules: new Map([[CLIENT, { own: ['ctstours.co.nz'], trade: [] }]]),
      }),
    )
    expect(res.items).toEqual([])
  })

  it('同行域名 → 不报', () => {
    const res = pickReplyDue(
      input({
        emails: new Map([['p1', ['agent@hot.co.nz']]]),
        rules: new Map([[CLIENT, { own: [], trade: ['hot.co.nz'] }]]),
      }),
    )
    expect(res.items).toEqual([])
  })

  it('散客邮箱 → 照报', () => {
    const res = pickReplyDue(
      input({
        emails: new Map([['p1', ['someone@gmail.com']]]),
        rules: new Map([[CLIENT, { own: ['ctstours.co.nz'], trade: ['hot.co.nz'] }]]),
      }),
    )
    expect(res.items).toHaveLength(1)
  })

  it('已经算「别再联系」→ 不报', () => {
    const res = pickReplyDue(input({ dnc: new Map([['p1', { flag: true, touches: [] }]]) }))
    expect(res.items).toEqual([])
  })

  it('拒联只写在触点上（列没写成功）→ 一样不报', () => {
    const res = pickReplyDue(
      input({
        dnc: new Map([
          [
            'p1',
            {
              flag: false,
              touches: [{ outcome: 'do_not_contact', occurredAt: '2026-08-01T00:00:00Z' }],
            },
          ],
        ]),
      }),
    )
    expect(res.items).toEqual([])
  })

  it('来信之后有人手工记过一笔 → 有人处理过了，不报', () => {
    const res = pickReplyDue(
      input({ lastHumanTouchAt: new Map([['p1', '2026-09-02T06:00:00Z']]) }),
    )
    expect(res.items).toEqual([])
  })

  it('手工触点在来信之前 → 那是上一轮的事，照报', () => {
    const res = pickReplyDue(
      input({ lastHumanTouchAt: new Map([['p1', '2026-08-20T00:00:00Z']]) }),
    )
    expect(res.items).toHaveLength(1)
  })
})

describe('pickReplyDue —— 收口', () => {
  it('同一个人多条线程，只报等最久的那条', () => {
    const res = pickReplyDue(
      input({
        threads: [
          thread({ conversationId: 'v1', lastMessageAt: '2026-09-01T00:00:00Z' }),
          thread({ conversationId: 'v2', lastMessageAt: '2026-08-25T00:00:00Z' }),
          thread({ conversationId: 'v3', lastMessageAt: '2026-08-30T00:00:00Z' }),
        ],
      }),
    )
    expect(res.items).toHaveLength(1)
    expect(res.items[0].conversationId).toBe('v2')
    expect(res.items[0].waitingHours).toBe(9 * 24)
  })

  it('🔴 不传上限就不封顶 —— 上限是消费方的渲染预算，不是判据的一部分', () => {
    // 早先默认压到 10 条，于是汇总邮件也被压，还把 10 当成事实报给销售。
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread({ conversationId: `v${i}`, contactId: `p${i}` }),
    )
    const res = pickReplyDue(input({ threads }))
    expect(res.items).toHaveLength(12)
    expect(res.dropped).toBe(0)
    expect(res.droppedByClient).toEqual({})
  })

  it('调用方传了上限才封顶，被压掉的条数如实回传', () => {
    // 12 个人，等待时长各不相同（1 号等最久）
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread({
        conversationId: `v${i}`,
        contactId: `p${i}`,
        lastMessageAt: new Date(NOW.getTime() - (12 - i) * 24 * 60 * 60 * 1000).toISOString(),
      }),
    )
    const res = pickReplyDue(input({ threads, maxPerClient: MAX_PER_CLIENT }))
    expect(MAX_PER_CLIENT).toBe(10)
    expect(res.items).toHaveLength(10)
    expect(res.dropped).toBe(2)
    // 压掉的是谁的必须说得出来，否则下发不出去，只能写日志
    expect(res.droppedByClient).toEqual({ [CLIENT]: 2 })
    // 等最久的排第一，被压掉的是等得最短的两个（p10 / p11）
    expect(res.items[0].contactId).toBe('p0')
    expect(res.items.map((x) => x.contactId)).not.toContain('p10')
    expect(res.items.map((x) => x.contactId)).not.toContain('p11')
  })

  it('上限是按客户各算各的，不是全局一个池', () => {
    const threads = Array.from({ length: 24 }, (_, i) =>
      thread({
        conversationId: `v${i}`,
        contactId: `p${i}`,
        clientId: i % 2 === 0 ? 'cA' : 'cB',
        lastMessageAt: '2026-09-01T00:00:00Z',
      }),
    )
    const res = pickReplyDue(input({ threads, maxPerClient: MAX_PER_CLIENT }))
    expect(res.items).toHaveLength(20)
    expect(res.dropped).toBe(4)
    expect(res.droppedByClient).toEqual({ cA: 2, cB: 2 })
  })

  it('带上客人名字和主题 —— 销售不用点开就知道是谁的哪封信', () => {
    const res = pickReplyDue(input({ names: new Map([['p1', 'Chris Brown']]) }))
    expect(res.items[0]).toMatchObject({
      clientId: CLIENT,
      contactId: 'p1',
      conversationId: 'v1',
      displayName: 'Chris Brown',
      subject: 'Re: China tour enquiry',
      lastMessageAt: '2026-09-01T00:00:00Z',
      waitingHours: 48,
    })
  })
})

// ─── 取数那一半 ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

/** 每次 `.in()` 收到了多少个 id —— 分批没做对，这里会出现大于 100 的数。 */
const inSizes: number[] = []

function makeFake(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const filters: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    const chain = () => api
    api.select = () => chain()
    api.order = () => chain()
    api.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain())
    api.gte = (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), chain())
    api.not = (c: string, _op: string, _v: unknown) => (filters.push((r) => r[c] != null), chain())
    api.in = (c: string, v: unknown[]) => {
      inSizes.push(v.length)
      filters.push((r) => v.includes(r[c]))
      return chain()
    }
    // fetchAll 走 range；这里一次给全，行数远小于一页。
    api.range = (fromIdx: number) =>
      Promise.resolve({
        data: fromIdx > 0 ? [] : tables[table].filter((r) => filters.every((f) => f(r))),
        error: null,
      })
    return api
  }
  return { from } as unknown as SupabaseClient
}

/** 一条「客人 2026-09-01 来信、没人回」的最小可用生产形状。 */
function fixture(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    conversations: [
      {
        id: 'v1',
        client_id: CLIENT,
        contact_id: 'p1',
        channel: 'email',
        subject: 'China tour enquiry',
        last_message_at: '2026-09-01T00:00:00Z',
        last_message_from: 'customer',
      },
    ],
    contact_touchpoints: [],
    contacts: [{ id: 'p1', do_not_contact: false, display_name: 'Chris Brown' }],
    contact_identities: [{ contact_id: 'p1', kind: 'email', value: 'chris@gmail.com' }],
    clients: [{ id: CLIENT, leads_config: { own_email_domains: ['ctstours.co.nz'] } }],
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('findEmailRepliesDue', () => {
  it('端到端：客人来信 48 小时没人回 → 挑出来一条', async () => {
    inSizes.length = 0
    const res = await findEmailRepliesDue(makeFake(fixture()), [CLIENT], NOW)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]).toMatchObject({
      contactId: 'p1',
      conversationId: 'v1',
      displayName: 'Chris Brown',
      subject: 'China tour enquiry',
      waitingHours: 48,
    })
  })

  it('Messenger 线程不归它管（只看 channel=email）', async () => {
    inSizes.length = 0
    const rows = fixture().conversations.map((c) => ({ ...c, channel: 'messenger' }))
    const res = await findEmailRepliesDue(makeFake(fixture({ conversations: rows })), [CLIENT], NOW)
    expect(res.items).toEqual([])
  })

  it('同事域名从 clients.leads_config 读出来 → 不报', async () => {
    inSizes.length = 0
    const res = await findEmailRepliesDue(
      makeFake(
        fixture({
          contact_identities: [{ contact_id: 'p1', kind: 'email', value: 'pa@ctstours.co.nz' }],
        }),
      ),
      [CLIENT],
      NOW,
    )
    expect(res.items).toEqual([])
  })

  it('触点上的 me_manual 晚于来信 → 不报', async () => {
    inSizes.length = 0
    const res = await findEmailRepliesDue(
      makeFake(
        fixture({
          contact_touchpoints: [
            {
              contact_id: 'p1',
              occurred_at: '2026-09-02T00:00:00Z',
              source: 'me_manual',
              metadata: {},
            },
          ],
        }),
      ),
      [CLIENT],
      NOW,
    )
    expect(res.items).toEqual([])
  })

  it('客户清单为空时不查库', async () => {
    const res = await findEmailRepliesDue(makeFake({}), [], NOW)
    expect(res).toEqual({ items: [], dropped: 0, droppedByClient: {} })
  })

  it('调用方传了上限时，被压掉的条数按客户回传（不只是 console.warn）', async () => {
    inSizes.length = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const convos = Array.from({ length: 13 }, (_, i) => ({
      id: `v${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'email',
      subject: 'enquiry',
      last_message_at: '2026-09-01T00:00:00Z',
      last_message_from: 'customer',
    }))
    const res = await findEmailRepliesDue(
      makeFake(
        fixture({
          conversations: convos,
          contacts: convos.map((c) => ({
            id: c.contact_id,
            do_not_contact: false,
            display_name: null,
          })),
          contact_identities: [],
        }),
      ),
      [CLIENT],
      NOW,
      { maxPerClient: MAX_PER_CLIENT },
    )
    expect(res.items).toHaveLength(10)
    expect(res.dropped).toBe(3)
    // 🔴 关键的是这一行：谁被压了几条要能说出名字，消费方才下发得出去。
    expect(res.droppedByClient).toEqual({ [CLIENT]: 3 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('3')
  })

  it('不传上限时 13 条一条都不压，也不 warn', async () => {
    inSizes.length = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const convos = Array.from({ length: 13 }, (_, i) => ({
      id: `v${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'email',
      subject: 'enquiry',
      last_message_at: '2026-09-01T00:00:00Z',
      last_message_from: 'customer',
    }))
    const res = await findEmailRepliesDue(
      makeFake(
        fixture({
          conversations: convos,
          contacts: convos.map((c) => ({
            id: c.contact_id,
            do_not_contact: false,
            display_name: null,
          })),
          contact_identities: [],
        }),
      ),
      [CLIENT],
      NOW,
    )
    expect(res.items).toHaveLength(13)
    expect(res.dropped).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('🔴 250 个客户时 conversations 那一查的 .in() 也分批', async () => {
    // 最上游这一处漏了分批 = 后面四个 loader 一个都不会跑，整条通道静默死掉。
    inSizes.length = 0
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`)
    await findEmailRepliesDue(makeFake(fixture()), ids, NOW)
    expect(inSizes.length).toBeGreaterThan(0)
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(100)
  })

  it('🔴 658 条线程时 .in() 每次都不超过 100 个 id', async () => {
    inSizes.length = 0
    const convos = Array.from({ length: 658 }, (_, i) => ({
      id: `v${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'email',
      subject: 'enquiry',
      last_message_at: '2026-09-01T00:00:00Z',
      last_message_from: 'customer',
    }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await findEmailRepliesDue(
      makeFake(
        fixture({
          conversations: convos,
          contacts: convos.map((c) => ({
            id: c.contact_id,
            do_not_contact: false,
            display_name: null,
          })),
          contact_identities: [],
        }),
      ),
      [CLIENT],
      NOW,
    )
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(100)
    // 真的分批了（658 个人 → 至少 7 批），不是因为压根没查
    expect(inSizes.filter((n) => n === 100).length).toBeGreaterThanOrEqual(7)
  })
})

/**
 * 陌生地址第一次来信 + ME 自己的信箱（2026-09-26，今日待办只留五类）。
 * 判据全是库里的事实，见 email-reply-due.ts 文件头「陌生地址第一次来信」。
 */
describe('pickReplyDue —— 陌生来信与 ME 自己的信箱', () => {
  it('不传 enquiryOrigin = 旧行为，全进 items，没有 firstContacts', () => {
    const res = pickReplyDue(input())
    expect(res.items).toHaveLength(1)
    expect(res.firstContacts).toBeUndefined()
  })

  it('传了 enquiryOrigin：不在里面的人挪进 firstContacts，不丢', () => {
    const res = pickReplyDue(input({ enquiryOrigin: new Set<string>() }))
    expect(res.items).toEqual([])
    expect(res.firstContacts).toHaveLength(1)
  })

  it('在 enquiryOrigin 里的人照常进 items', () => {
    const t = thread()
    const res = pickReplyDue(input({ threads: [t], enquiryOrigin: new Set([t.contactId]) }))
    expect(res.items).toHaveLength(1)
    expect(res.firstContacts).toEqual([])
  })

  it('主题带网站表单字样（Contact form）的陌生人算真询价', () => {
    expect(isFormEnquirySubject('Re: Contact form: General Inquiry — L')).toBe(true)
    expect(isFormEnquirySubject('AI intake for tailor-made travel enquiries')).toBe(false)
    const t = thread({ subject: 'Contact form: Quote' })
    const res = pickReplyDue(input({ threads: [t], enquiryOrigin: new Set<string>() }))
    expect(res.items).toHaveLength(1)
  })

  it('ME 自己的信箱域名对每个客户都算自己人（[PREVIEW] 自测不是客人）', () => {
    const t = thread()
    const res = pickReplyDue(
      input({
        threads: [t],
        emails: new Map([[t.contactId, ['hello@magicengine.cloud']]]),
        platformOwnDomains: ['magicengine.cloud'],
      }),
    )
    expect(res.items).toEqual([])
    expect(platformOwnDomains()).toContain('magicengine.cloud')
  })

  it('🔴 发信地址被配成公共邮箱时不算自己人 —— 否则全世界的 gmail 客人都会静默消失', () => {
    expect(platformOwnDomains('someone@gmail.com')).toEqual([])
    expect(platformOwnDomains('ops@outlook.com')).toEqual([])
    expect(platformOwnDomains('hello@magicengine.cloud')).toEqual(['magicengine.cloud'])
  })

  it('isEnquiryTouch：手记和机器回执不算，写过信 / 邮件名单 / 别的渠道算', () => {
    const t = (over: Record<string, unknown>) => ({ channel: 'email', direction: 'inbound', source: 'microsoft_mail', metadata: {}, ...over })
    expect(isEnquiryTouch(t({}))).toBe(false)
    expect(isEnquiryTouch(t({ channel: 'phone', direction: 'outbound', source: 'me_manual' }))).toBe(false)
    expect(isEnquiryTouch(t({ direction: 'outbound', metadata: { automated: true } }))).toBe(false)
    expect(isEnquiryTouch(t({ direction: 'outbound' }))).toBe(true)
    expect(isEnquiryTouch(t({ source: 'mailchimp' }))).toBe(true)
    expect(isEnquiryTouch(t({ channel: 'messenger', source: 'messenger' }))).toBe(true)
    // 身份来源：列算数的，'outlook'（邮箱批量导入）不算
    expect(ENQUIRY_IDENTITY_SOURCES.has('meta_lead_form')).toBe(true)
    expect(ENQUIRY_IDENTITY_SOURCES.has('outlook')).toBe(false)
    expect(ENQUIRY_IDENTITY_SOURCES.has('email')).toBe(false)
  })
})
