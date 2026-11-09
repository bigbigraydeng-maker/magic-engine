/**
 * 存量补档案（开场白里的电话邮箱）—— 2026-09-07 从「按人逐个查」改成「批量查」之后的行为锁。
 *
 * 🔴 为什么值得测：这一段是 2026-08-17 那次事故的**成因**。它把每小时的私信同步
 *    从约 25 秒推到约 140 秒（314 个候选人 × 2 次串行查询 = 628 次往返），
 *    网关约 125 秒掐断返 524，串在后面的「写客户需求卡」因此 14 天一次都没跑。
 *
 * 改造只动「怎么取数据」，判据一个字没改。所以这份测试盯的是三件事：
 *   1. 往返次数真的降下来了（回归就是重新踩回事故）
 *   2. 喂给判据的消息**跟逐个查时一模一样**，尤其是跨对话、跨分页之后的顺序
 *   3. 读失败绝不能被当成「这个人没有私信」——那会静默地不补档案
 *
 * 假件按**表**建模，不按调用顺序建模：换个查法（多一次查询、少一次查询）时，
 * 测试该继续通过；答案变了才该红。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ContactRow { id: string; client_id: string; primary_phone: string | null; primary_email: string | null }
interface ConversationRow { id: string; client_id: string; channel: string; contact_id: string | null }
interface MessageRow { id: string; conversation_id: string; direction: string; body: string | null; sent_at: string }

const tables: {
  contacts: ContactRow[]
  conversations: ConversationRow[]
  conversation_messages: MessageRow[]
} = { contacts: [], conversations: [], conversation_messages: [] }

/** 哪张表被查了几次 —— 「往返次数」这件事的直接证据。 */
const requests: string[] = []
/** 让某张表的读取报错，用来验证「读失败不许被当成没数据」。 */
let failTable: string | null = null
/** 只让该表的第 N 次请求报错（N 从 1 起）。用来验证「半截数据不许被写进档案」。 */
let failTableOnNth: number | null = null

/** PostgREST 的默认上限。Supabase 超过这个数**不报错**，直接少给行。 */
const MAX_ROWS = 1000

function builder(table: keyof typeof tables) {
  const eqs: [string, unknown][] = []
  const ins: [string, unknown[]][] = []
  const orders: string[] = []
  let range: [number, number] | null = null
  let orClause: string | null = null

  const api = {
    select: () => api,
    eq: (col: string, v: unknown) => { eqs.push([col, v]); return api },
    in: (col: string, v: unknown[]) => { ins.push([col, v]); return api },
    or: (clause: string) => { orClause = clause; return api },
    order: (col: string) => { orders.push(col); return api },
    range: (from: number, to: number) => { range = [from, to]; return api },
    then: (resolve: (r: { data: unknown; error: { message: string } | null }) => unknown) => {
      requests.push(table)
      const nth = requests.filter((t) => t === table).length
      if (failTable === table && (failTableOnNth === null || failTableOnNth === nth)) {
        return resolve({ data: null, error: { message: `${table} 读挂了` } })
      }

      let rows: Record<string, unknown>[] = (tables[table] as unknown as Record<string, unknown>[]).slice()
      for (const [col, v] of eqs) rows = rows.filter((r) => r[col] === v)
      for (const [col, v] of ins) rows = rows.filter((r) => v.includes(r[col]))
      // 只支持这一个 or：「电话或邮箱还空着」。
      if (orClause === 'primary_phone.is.null,primary_email.is.null') {
        rows = rows.filter((r) => r.primary_phone === null || r.primary_email === null)
      }
      for (const col of [...orders].reverse()) {
        rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])))
      }
      const [from, to] = range ?? [0, MAX_ROWS - 1]
      // 🔴 关键：即使调用方要 1 万行，PostgREST 也最多给 MAX_ROWS 行，而且不报错。
      rows = rows.slice(from, Math.min(to + 1, from + MAX_ROWS))
      return resolve({ data: rows, error: null })
    },
  }
  return api
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => builder(t as keyof typeof tables) },
}))

/** 判据本身不在这份测试的范围里 —— 这里只看「喂进去的是什么」。 */
const fed = new Map<string, { direction: string; body: string; sentAt: string }[]>()
vi.mock('@/lib/messenger/link-contacts', () => ({
  backfillFromLeadIntro: vi.fn(
    async (input: { messages: { direction: string; body: string; sentAt: string }[] }, contactId: string) => {
      fed.set(contactId, input.messages)
    },
  ),
}))

import { backfillLeadIntroDetails } from '../lead-intro-backfill'
import { backfillFromLeadIntro } from '@/lib/messenger/link-contacts'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function contact(id: string, over: Partial<ContactRow> = {}): ContactRow {
  return { id, client_id: CLIENT, primary_phone: null, primary_email: null, ...over }
}
function convo(id: string, contactId: string | null, over: Partial<ConversationRow> = {}): ConversationRow {
  return { id, client_id: CLIENT, channel: 'messenger', contact_id: contactId, ...over }
}
function msg(id: string, conversationId: string, sentAt: string, body = 'hi'): MessageRow {
  return { id, conversation_id: conversationId, direction: 'inbound', body, sent_at: sentAt }
}

beforeEach(() => {
  tables.contacts = []
  tables.conversations = []
  tables.conversation_messages = []
  requests.length = 0
  failTable = null
  failTableOnNth = null
  fed.clear()
  vi.clearAllMocks()
})

describe('往返次数（事故的直接成因）', () => {
  it('🔴 300 个候选人不再是几百次查询 —— 逐人查是 600+，批量查是个位数', () => {
    for (let i = 0; i < 300; i++) {
      const cid = `contact-${String(i).padStart(3, '0')}`
      tables.contacts.push(contact(cid))
      tables.conversations.push(convo(`conv-${i}`, cid))
      tables.conversation_messages.push(msg(`m-${i}`, `conv-${i}`, '2026-08-01T00:00:00Z'))
    }
    return backfillLeadIntroDetails(CLIENT).then((r) => {
      expect(r.scanned).toBe(300)
      // 逐人查的老写法在这个数据集上是 300(人的对话) + 300(对话的消息) + 2(翻页) = 602 次。
      expect(requests.length).toBeLessThan(15)
    })
  })

  it('候选人一个都没有时，一次多余的查询都不发', async () => {
    tables.contacts = [contact('c1', { primary_phone: '+64', primary_email: 'a@b.c' })]
    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r).toEqual({ scanned: 0, matched: 0 })
    expect(requests.filter((t) => t !== 'contacts')).toEqual([])
  })
})

describe('喂给判据的消息跟逐个查时一样', () => {
  it('🔴 同一个人有两条对话时，消息按时间合并排好 —— 顺序错了会把旧号码盖回新的', () => {
    // 判据是「按字段各取最新非空值」。跨对话拼接如果不重排，
    // 客人后来更正过的号码会被更早那条覆盖回去。
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-a', 'c1'), convo('conv-b', 'c1')]
    tables.conversation_messages = [
      msg('m1', 'conv-a', '2026-08-01T00:00:00Z', '第一条'),
      msg('m2', 'conv-b', '2026-08-02T00:00:00Z', '第二条'),
      msg('m3', 'conv-a', '2026-08-03T00:00:00Z', '第三条'),
    ]
    return backfillLeadIntroDetails(CLIENT).then(() => {
      expect(fed.get('c1')!.map((m) => m.body)).toEqual(['第一条', '第二条', '第三条'])
    })
  })

  it('🔴 对话多到要分批查时，跨批拼回来必须重新按时间排 —— 不排就会把旧号码盖回新的', async () => {
    // 分批只保证批内有序。这里故意让**后一批**的对话时间更早：
    // 不重排的话拼出来是「晚 … 早」，判据「按字段各取最新非空值」就会取到旧值。
    tables.contacts = [contact('c1')]
    for (let i = 0; i < 250; i++) {
      const cid = `conv-${String(i).padStart(3, '0')}`
      tables.conversations.push(convo(cid, 'c1'))
      // 前 200 条（第一批）排在 2026-08-02，后 50 条（第二批）排在 2026-08-01。
      const day = i < 200 ? '02' : '01'
      tables.conversation_messages.push(
        msg(`m-${String(i).padStart(3, '0')}`, cid, `2026-08-${day}T00:00:${String(i % 60).padStart(2, '0')}Z`),
      )
    }

    await backfillLeadIntroDetails(CLIENT)
    const times = fed.get('c1')!.map((m) => m.sentAt)
    expect(times.length).toBe(250)
    expect(times).toEqual([...times].sort())
  })

  it('🔴 消息超过一页（1000 行）时不许静默截断 —— 截掉的正好可能是开场白那条', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-a', 'c1')]
    for (let i = 0; i < 1205; i++) {
      tables.conversation_messages.push(
        msg(`m-${String(i).padStart(4, '0')}`, 'conv-a', `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}Z`),
      )
    }
    await backfillLeadIntroDetails(CLIENT)
    expect(fed.get('c1')!.length).toBe(1205)
  })

  it('🔴 别人的对话不许喂进这个人的档案', async () => {
    tables.contacts = [contact('c1'), contact('c2')]
    tables.conversations = [convo('conv-a', 'c1'), convo('conv-b', 'c2')]
    tables.conversation_messages = [
      msg('m1', 'conv-a', '2026-08-01T00:00:00Z', 'c1 的'),
      msg('m2', 'conv-b', '2026-08-01T00:00:00Z', 'c2 的'),
    ]
    await backfillLeadIntroDetails(CLIENT)
    expect(fed.get('c1')!.map((m) => m.body)).toEqual(['c1 的'])
    expect(fed.get('c2')!.map((m) => m.body)).toEqual(['c2 的'])
  })

  it('只认私信渠道 —— 邮件对话不算（会得到一张说错渠道的档案）', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-mail', 'c1', { channel: 'email' })]
    tables.conversation_messages = [msg('m1', 'conv-mail', '2026-08-01T00:00:00Z')]
    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r.scanned).toBe(0)
    expect(backfillFromLeadIntro).not.toHaveBeenCalled()
  })

  it('别的客户的对话不算', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-x', 'c1', { client_id: 'other-client' })]
    tables.conversation_messages = [msg('m1', 'conv-x', '2026-08-01T00:00:00Z')]
    expect((await backfillLeadIntroDetails(CLIENT)).scanned).toBe(0)
  })

  it('两栏都填好的人不翻（翻了也只会被空值守卫挡回来）', async () => {
    tables.contacts = [contact('c1', { primary_phone: '+64211111111', primary_email: 'a@b.c' })]
    tables.conversations = [convo('conv-a', 'c1')]
    tables.conversation_messages = [msg('m1', 'conv-a', '2026-08-01T00:00:00Z')]
    expect((await backfillLeadIntroDetails(CLIENT)).scanned).toBe(0)
  })

  it('有对话但一条入站消息都没有的人，不算翻过', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-a', 'c1')]
    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r).toEqual({ scanned: 0, matched: 0 })
    expect(backfillFromLeadIntro).not.toHaveBeenCalled()
  })
})

describe('读失败不许被当成「这个人没有私信」', () => {
  it('🔴 读对话报错 → 整轮返回 0，而且一个档案都不动', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-a', 'c1')]
    tables.conversation_messages = [msg('m1', 'conv-a', '2026-08-01T00:00:00Z')]
    failTable = 'conversations'

    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r).toEqual({ scanned: 0, matched: 0 })
    expect(backfillFromLeadIntro).not.toHaveBeenCalled()
  })

  it('🔴 读消息报错 → 同上，绝不拿半截数据去补档案', async () => {
    tables.contacts = [contact('c1')]
    tables.conversations = [convo('conv-a', 'c1')]
    tables.conversation_messages = [msg('m1', 'conv-a', '2026-08-01T00:00:00Z')]
    failTable = 'conversation_messages'

    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r).toEqual({ scanned: 0, matched: 0 })
    expect(backfillFromLeadIntro).not.toHaveBeenCalled()
  })

  it('🔴 消息只读了一半就报错 → 一个档案都不许动（半截数据比没数据更危险）', async () => {
    // 这条是用来分清「失败」和「这个人没有私信」的：两者的返回值都是 0，
    // 只有「已经读到的那批有没有被写进档案」能把它们分开。
    tables.contacts = [contact('c1'), contact('c2')]
    for (let i = 0; i < 250; i++) {
      const cid = `conv-${String(i).padStart(3, '0')}`
      tables.conversations.push(convo(cid, i < 200 ? 'c1' : 'c2'))
      tables.conversation_messages.push(msg(`m-${String(i).padStart(3, '0')}`, cid, '2026-08-01T00:00:00Z'))
    }
    // 第一批消息读到了，第二批读挂了。
    failTable = 'conversation_messages'
    failTableOnNth = 2

    const r = await backfillLeadIntroDetails(CLIENT)
    expect(r).toEqual({ scanned: 0, matched: 0 })
    expect(backfillFromLeadIntro).not.toHaveBeenCalled()
  })

  it('读联系人报错 → 返回 0，不往下走', async () => {
    tables.contacts = [contact('c1')]
    failTable = 'contacts'
    expect(await backfillLeadIntroDetails(CLIENT)).toEqual({ scanned: 0, matched: 0 })
  })
})
