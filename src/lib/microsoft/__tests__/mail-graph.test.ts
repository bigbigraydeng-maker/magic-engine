/**
 * 从客户邮箱读信。
 *
 * 这里钉的全是**会安静出错**的地方 —— 它们不报错，只是让信少几封：
 *
 *   1. 不翻页 → 忙的那天悄悄漏掉最新的信
 *   2. 方向靠猜发件人 → 别名/转发/代发一出现就错，整条时间线读不通
 *   3. 水位线用发送时间 → 晚到的邮件直接跳过水位线，永远读不到
 *   4. 静默截断 → 以为读全了，其实漏的正是最新那些
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMailSince } from '../mail-graph'

const SINCE = new Date('2026-08-01T00:00:00Z')

const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversationId: 'cv1',
  subject: '想问长城团',
  bodyPreview: '你好，请问 11 月还有位子吗',
  receivedDateTime: '2026-08-02T01:00:00Z',
  from: { emailAddress: { address: 'Susan@Gmail.com', name: 'Susan Lee' } },
  toRecipients: [{ emailAddress: { address: 'info@ctstours.co.nz', name: 'CTS' } }],
  ...over,
})

/** 记下每次请求的 URL —— 筛选条件、排序、字段都靠它验证。 */
let urls: string[]

function mockGraph(pages: Array<{ value: unknown[]; next?: string }>, ok = true, status = 200) {
  urls = []
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const page = pages[i] ?? { value: [] }
      i += 1
      return {
        ok,
        status,
        json: async () => ({ value: page.value, ...(page.next ? { '@odata.nextLink': page.next } : {}) }),
        text: async () => 'boom',
      } as unknown as Response
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('方向由文件夹决定，不靠猜发件人', () => {
  it('收件箱 → inbound，对方是发件人', async () => {
    mockGraph([{ value: [msg()] }])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.messages[0]).toMatchObject({
      direction: 'inbound',
      counterparty: { address: 'susan@gmail.com', name: 'Susan Lee' },
    })
  })

  /** 已发送里「对方」是收件人 —— 拿发件人当对方会把每封信都算成我们自己。 */
  it('已发送 → outbound，对方是第一个收件人', async () => {
    mockGraph([{ value: [msg()] }])
    const r = await fetchMailSince('tok', 'sentitems', SINCE)
    expect(r.ok && r.messages[0]).toMatchObject({
      direction: 'outbound',
      counterparty: { address: 'info@ctstours.co.nz' },
    })
  })

  /** 抄送给全公司的一封信，不该变成十几个客人。 */
  it('只认第一个收件人，抄送的人不算往来对象', async () => {
    mockGraph([
      {
        value: [
          msg({
            toRecipients: [
              { emailAddress: { address: 'a@x.com' } },
              { emailAddress: { address: 'b@x.com' } },
            ],
          }),
        ],
      },
    ])
    const r = await fetchMailSince('tok', 'sentitems', SINCE)
    expect(r.ok && r.messages[0].counterparty?.address).toBe('a@x.com')
  })

  it('地址一律小写 —— 否则同一个人会因为大小写变成两个联系人', async () => {
    mockGraph([{ value: [msg()] }])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.messages[0].counterparty?.address).toBe('susan@gmail.com')
  })
})

describe('翻页', () => {
  it('有下一页就接着翻，不漏', async () => {
    mockGraph([
      { value: [msg({ id: 'm1' })], next: 'https://graph.microsoft.com/next-1' },
      { value: [msg({ id: 'm2' })] },
    ])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(urls[1]).toBe('https://graph.microsoft.com/next-1')
  })

  /** 静默截断会让人以为读全了，而漏掉的正是最新那些信。 */
  it('翻到上限还没完 → 如实标出来，不假装读全了', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      value: [msg({ id: `m${i}` })],
      next: 'https://graph.microsoft.com/more',
    }))
    mockGraph(many)
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.truncated).toBe(true)
  })

  it('一次读完就不标截断', async () => {
    mockGraph([{ value: [msg()] }])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.truncated).toBe(false)
  })
})

describe('请求本身', () => {
  it('水位线用「收到时间」—— 用发送时间会让晚到的邮件永远读不到', async () => {
    mockGraph([{ value: [] }])
    await fetchMailSince('tok', 'inbox', SINCE)
    expect(decodeURIComponent(urls[0])).toContain('receivedDateTime ge')
    expect(urls[0]).not.toContain('sentDateTime')
    // 空格必须编成 %20 —— 编成 + 的话 OData 可能不把它当空格，筛选静默失效
    expect(urls[0]).not.toContain('+ge+')
  })

  it('从旧到新取 —— 中途失败时水位线还能接着走，不留空洞', async () => {
    mockGraph([{ value: [] }])
    await fetchMailSince('tok', 'inbox', SINCE)
    expect(decodeURIComponent(urls[0])).toContain('receivedDateTime asc')
  })

  /** 不写 $select 的话 Graph 会把整封正文塞回来，几百封就是几十兆。 */
  it('只取用得上的字段，不拉全文', async () => {
    mockGraph([{ value: [] }])
    await fetchMailSince('tok', 'inbox', SINCE)
    const u = decodeURIComponent(urls[0])
    expect(u).toContain('bodyPreview')
    expect(u).not.toContain('$select=id,conversationId,subject,body,')
  })

  it('带上令牌', async () => {
    mockGraph([{ value: [] }])
    await fetchMailSince('tok-123', 'inbox', SINCE)
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((call[1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok-123')
  })
})

describe('出错', () => {
  /** 「权限不够」和「令牌过期」要分得清 —— 吞成一句「同步失败」排查要多花一小时。 */
  it('Microsoft 拒了 → 原样带回它说的话', async () => {
    mockGraph([{ value: [] }], false, 403)
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('403')
  })

  it('网络炸了 → 不抛异常，整批同步不该被一次网络抖动弄停', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    expect(await fetchMailSince('tok', 'inbox', SINCE)).toMatchObject({ ok: false, error: 'ECONNRESET' })
  })

  it('缺 id 或时间的脏记录跳过，不弄停整批', async () => {
    mockGraph([{ value: [msg(), { subject: '没有 id' }, msg({ id: 'm2' })] }])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('没有发件人信息 → 对方留空，不编一个', async () => {
    mockGraph([{ value: [msg({ from: null, sender: null })] }])
    const r = await fetchMailSince('tok', 'inbox', SINCE)
    expect(r.ok && r.messages[0].counterparty).toBeNull()
  })
})
