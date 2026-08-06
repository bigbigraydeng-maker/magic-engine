/**
 * 按「终端客户 / 同行」筛看板。
 *
 * 这里错了不是显示问题，是**谁会收到那封群发邮件**。第一版就在这里错过一次
 * （Codex 复审抓到）：只筛了人，群发地址原样保留 —— 一封面向散客的信会发给
 * 同行，而「已发出」那一笔只按筛后的人记，**收件人和 CRM 记录对不上**。
 */

import { describe, expect, it } from 'vitest'
import { batchRecipients, countTrade, filterBucketByKind, matchesKindView } from '../kind-filter'
import type { ContactKind } from '../contact-kind'

const person = (email: string | null, kind?: ContactKind) => ({ email, kind })

const bucket = (batch: 'send_email' | 'call_one_by_one') => ({
  batch,
  total: 3,
  people: [
    person('brett@gmail.com', 'retail'),
    person('pieta@hot.co.nz', 'trade'),
    person('greg@gmail.com'), // 没标 kind
  ],
  batchEmails: ['brett@gmail.com', 'pieta@hot.co.nz', 'greg@gmail.com'],
})

describe('哪些人留下', () => {
  it.each([
    ['retail' as const, ['brett@gmail.com', 'greg@gmail.com']],
    ['trade' as const, ['pieta@hot.co.nz']],
    ['all' as const, ['brett@gmail.com', 'pieta@hot.co.nz', 'greg@gmail.com']],
  ])('视图 %s', (view, want) => {
    expect(filterBucketByKind(bucket('send_email'), view).people.map((p) => p.email)).toEqual(want)
  })

  /** 后端还没上线这个字段时，页面不该整个空掉。 */
  it('没标 kind 的当终端客户', () => {
    expect(matchesKindView(undefined, 'retail')).toBe(true)
    expect(matchesKindView(undefined, 'trade')).toBe(false)
  })
})

describe('群发地址必须跟着筛 —— 这是会伤客户的那一条', () => {
  /**
   * **第一版的 bug 就在这。** 只看终端客户时，复制出来的地址里还带着同行，
   * 于是一封散客群发信发给了每周订十次位的同行。
   */
  it('只看终端客户 → 群发地址里没有同行', () => {
    const b = filterBucketByKind(bucket('send_email'), 'retail')
    expect(b.batchEmails).toEqual(['brett@gmail.com', 'greg@gmail.com'])
    expect(b.batchEmails).not.toContain('pieta@hot.co.nz')
  })

  /**
   * 更毒的一半：**收件人和记录必须是同一批人**。
   * 名单一旦开始说假话，销售就不再信它 —— 而这套东西存在的全部理由就是它可信。
   */
  it('群发地址和会被记一笔的人，完全对得上', () => {
    for (const view of ['retail', 'trade', 'all'] as const) {
      const b = filterBucketByKind(bucket('send_email'), view)
      expect(b.batchEmails).toEqual(b.people.map((p) => p.email).filter(Boolean))
    }
  })

  it('没邮箱的人不会混进群发地址', () => {
    const b = filterBucketByKind(
      { ...bucket('send_email'), people: [person(null, 'retail'), person('a@b.com', 'retail')] },
      'retail',
    )
    expect(b.batchEmails).toEqual(['a@b.com'])
  })

  /** 不该群发的桶永远给空数组 —— 免得页面误显示一个群发按钮。 */
  it('不是「该发邮件」的桶 → 群发地址恒为空', () => {
    expect(filterBucketByKind(bucket('call_one_by_one'), 'all').batchEmails).toEqual([])
  })
})

describe('列头数字', () => {
  /** 对不上，人会以为系统把人弄丢了。 */
  it('跟实际铺出来的卡片数一致', () => {
    const b = filterBucketByKind(bucket('send_email'), 'retail')
    expect(b.total).toBe(b.people.length)
    expect(b.total).toBe(2)
  })
})

describe('同行总数', () => {
  it('看板里的同行算进去', () => {
    expect(countTrade([{ people: [person('a', 'trade'), person('b', 'retail')] }], [])).toBe(1)
  })

  /**
   * **必须把名单外的也算上。** 一个客户的同行如果全都成交 / 停止 / 推迟了，
   * 他们只存在于 offList；只数看板的话这个数字是 0 → 切换器不渲染 →
   * offList 又按默认的「终端客户」筛掉他们 → **这批人在界面上彻底消失**。
   */
  it('全在名单外的同行也算进去 —— 否则他们没有任何入口能翻到', () => {
    expect(countTrade([{ people: [person('a', 'retail')] }], [{ kind: 'trade' }, { kind: 'won' as never }])).toBe(1)
  })

  it('一个同行都没有 → 0（切换器不该出现）', () => {
    expect(countTrade([{ people: [person('a', 'retail')] }], [{ kind: 'retail' }])).toBe(0)
  })
})

/**
 * 今天已经处理过的人，**不能进群发地址**。
 *
 * 名单改成「一天不变」之后（lib/crm/day-list），处理过的人不再消失，而是
 * 留在桶里就地变灰。群发地址如果照抄整桶 —— 一个今天亲口说「不买了」的人
 * 当天就会收到一封面向他的群发信，CRM 里还记一笔我们发过。
 *
 * 这是这个文件开头那次事故的第二种形态：第一次是筛选没跟上，这次是冻结没跟上。
 * 同一条教训：**群发地址必须从「真正该收信的那批人」重新推**。
 */
describe('已经处理过的人不进群发地址', () => {
  const withDone = {
    batch: 'send_email' as const,
    total: 3,
    people: [
      { email: 'a@gmail.com', kind: 'retail' as const },
      { email: 'b@gmail.com', kind: 'retail' as const, doneToday: true },
      { email: 'c@gmail.com', kind: 'retail' as const },
    ],
    batchEmails: ['a@gmail.com', 'b@gmail.com', 'c@gmail.com'],
  }

  it('今天标了「不买了」的那个，地址里没有他', () => {
    const b = filterBucketByKind(withDone, 'retail')
    expect(b.batchEmails).toEqual(['a@gmail.com', 'c@gmail.com'])
    expect(b.batchEmails).not.toContain('b@gmail.com')
  })

  /** 卡片还在（就地变灰），只是不收这封信 —— 两件事不能混。 */
  it('人还在桶里，只是不收这封信', () => {
    const b = filterBucketByKind(withDone, 'retail')
    expect(b.people).toHaveLength(3)
    expect(b.total).toBe(3)
  })

  it('看「全部」时同样排除', () => {
    expect(filterBucketByKind(withDone, 'all').batchEmails).not.toContain('b@gmail.com')
  })
})

/**
 * 地址和「记一笔」的名单，必须是**同一批人**。
 *
 * 上一版各推各的：20 人的桶里 3 个今天点了「他不买了」，复制出 17 个地址，
 * 却给 20 个人各记了一笔「群发了一封邮件」。那 3 位收到了一封他们根本
 * 没收到的信的记录，而系统回报「已给 20 人记了一笔」。
 *
 * 这是这个文件开头标注为「比前面那条更毒」的那一条：实际收件人和 CRM 记录对不上。
 */
describe('收信人只有一份', () => {
  const b = {
    batch: 'send_email' as const,
    total: 4,
    people: [
      { email: 'a@x.com', kind: 'retail' as const },
      { email: 'b@x.com', kind: 'retail' as const, doneToday: true },
      { email: null, kind: 'retail' as const },
      { email: 'd@x.com', kind: 'retail' as const },
    ],
    batchEmails: [],
  }

  it('地址数 == 会被记一笔的人数', () => {
    const recipients = batchRecipients(b)
    expect(recipients).toHaveLength(2)
    expect(filterBucketByKind(b, 'all').batchEmails).toHaveLength(recipients.length)
  })

  it('今天已处理的、没邮箱的，两边一起排掉', () => {
    expect(batchRecipients(b).map((p) => p.email)).toEqual(['a@x.com', 'd@x.com'])
  })

  it('不该群发的桶 → 一个收信人都没有', () => {
    expect(batchRecipients({ ...b, batch: 'call_one_by_one' })).toEqual([])
  })
})
