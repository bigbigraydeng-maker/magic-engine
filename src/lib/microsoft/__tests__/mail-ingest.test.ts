/**
 * 「这些信在 CRM 里意味着什么」。
 *
 * 这里钉的四条判断，每一条错了都会安静地毁掉销售早上那一页：
 *   ① 一条线程只有一个「对方」 —— 逐封重算会把同一串来回拆成两个人
 *   ② 客人自己开过口才建人   —— 我们主动发的信不配变成一张要跟的卡
 *   ③ 机器人线程整条丢       —— 只丢一半会留下「我们跟 noreply@ 聊过」
 *   ④ 自动回执不算跟进       —— 一封「我不在办公室」会让热线索在早上变灰
 *
 * 第 ④ 条是 8/2 修过的那个错（Mailchimp 群发把整页标成已跟进）换了件衣服
 * 又来一次，所以钉得最死。
 */

import { describe, expect, it } from 'vitest'
import { isAutoReply, ownDomainsOf, planMailIngest, threadKey } from '../mail-ingest'
import type { MailMessage } from '../mail-graph'

const OWN = { ownDomains: ['ctstours.co.nz'] }

let seq = 0
function mail(over: Partial<MailMessage> & { direction: 'inbound' | 'outbound' }): MailMessage {
  seq += 1
  return {
    id: `m${seq}`,
    conversationId: 'cv1',
    subject: '想问一下行程',
    preview: '你好，我想问……',
    receivedAt: '2026-08-01T00:00:00.000Z',
    counterparty: { address: 'susan@gmail.com', name: 'Susan Lee' },
    ...over,
  }
}

describe('线程编号', () => {
  it('用 Graph 的会话 id，带前缀跟私信彻底分开', () => {
    expect(threadKey(mail({ direction: 'inbound', conversationId: 'AAQk' }))).toBe('mail:AAQk')
  })

  /** 没有会话 id 时必须仍然唯一，否则两封无关的信会被并成一条线程。 */
  it('没有会话 id → 这封信自成一条线程', () => {
    const a = threadKey(mail({ direction: 'inbound', conversationId: null, id: 'x1' }))
    const b = threadKey(mail({ direction: 'inbound', conversationId: null, id: 'x2' }))
    expect(a).not.toBe(b)
    expect(a.startsWith('mail-msg:')).toBe(true)
  })
})

describe('① 一条线程只有一个「对方」', () => {
  it('客人来信 + 我们回信 → 一条线程，对方是客人', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'inbound', receivedAt: '2026-08-01T01:00:00.000Z' }),
        mail({ direction: 'outbound', receivedAt: '2026-08-01T02:00:00.000Z' }),
      ],
      OWN,
    )
    expect(plan.threads).toHaveLength(1)
    expect(plan.threads[0].counterparty.address).toBe('susan@gmail.com')
    expect(plan.threads[0].messages).toHaveLength(2)
  })

  /**
   * 线程中途被转发给同事，收件人变成了内部地址。逐封重算的话这条线程会
   * 突然「变成同事的」，客人的历史就断在这里。
   */
  it('中途转给同事 → 对方仍然是客人，不被后面那封改掉', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'inbound', receivedAt: '2026-08-01T01:00:00.000Z' }),
        mail({
          direction: 'outbound',
          receivedAt: '2026-08-01T03:00:00.000Z',
          counterparty: { address: 'amy@ctstours.co.nz', name: 'Amy' },
        }),
      ],
      OWN,
    )
    expect(plan.threads).toHaveLength(1)
    expect(plan.threads[0].counterparty.address).toBe('susan@gmail.com')
  })

  /** 传进来的顺序是乱的也要得到同样的结果 —— 身份由**最早**那封定。 */
  it('输入顺序打乱不影响谁是对方', () => {
    const later = mail({
      direction: 'outbound',
      receivedAt: '2026-08-01T03:00:00.000Z',
      counterparty: { address: 'amy@ctstours.co.nz', name: 'Amy' },
    })
    const earlier = mail({ direction: 'inbound', receivedAt: '2026-08-01T01:00:00.000Z' })
    expect(planMailIngest([later, earlier], OWN).threads[0].counterparty.address).toBe(
      'susan@gmail.com',
    )
  })

  it('两个不同的会话 id → 两条线程', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'inbound', conversationId: 'a' }),
        mail({ direction: 'inbound', conversationId: 'b' }),
      ],
      OWN,
    )
    expect(plan.threads).toHaveLength(2)
  })

  it('线程标题跟最新一封走 —— 跟邮箱里看到的一致', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'inbound', subject: '想问一下行程', receivedAt: '2026-08-01T01:00:00.000Z' }),
        mail({ direction: 'outbound', subject: 'Re: 想问一下行程（报价）', receivedAt: '2026-08-01T02:00:00.000Z' }),
      ],
      OWN,
    )
    expect(plan.threads[0].subject).toBe('Re: 想问一下行程（报价）')
  })

  it('最后是客人说的话 → 记成「等我们回」', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'outbound', receivedAt: '2026-08-01T01:00:00.000Z' }),
        mail({ direction: 'inbound', receivedAt: '2026-08-01T02:00:00.000Z' }),
      ],
      OWN,
    )
    expect(plan.threads[0].lastFrom).toBe('customer')
    expect(plan.threads[0].lastAt).toBe('2026-08-01T02:00:00.000Z')
  })
})

describe('② 客人自己开过口才建人', () => {
  it('客人来过信 → 允许建人', () => {
    const plan = planMailIngest([mail({ direction: 'inbound' })], OWN)
    expect(plan.threads[0].hasInbound).toBe(true)
  })

  /** 我们主动发出去的询价 / 通知，对面不该因此在「今天该联系谁」里多一张卡。 */
  it('只有我们发出去的 → 不允许建人（线程照存）', () => {
    const plan = planMailIngest([mail({ direction: 'outbound' })], OWN)
    expect(plan.threads).toHaveLength(1)
    expect(plan.threads[0].hasInbound).toBe(false)
  })
})

describe('③ 机器人 / 内部线程整条丢', () => {
  it('noreply 来信 → 整条不要', () => {
    const plan = planMailIngest(
      [mail({ direction: 'inbound', counterparty: { address: 'noreply@shopify.com', name: null } })],
      OWN,
    )
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped[0]).toMatchObject({ address: 'noreply@shopify.com', messages: 1 })
  })

  /**
   * 只丢入站不丢出站，会剩下一条挂着 noreply@ 的对话，而且因为它有出站消息，
   * 看起来像「我们跟他聊过」。
   */
  it('机器人线程里我们回的那封也一起丢，不留半条', () => {
    const plan = planMailIngest(
      [
        mail({
          direction: 'inbound',
          receivedAt: '2026-08-01T01:00:00.000Z',
          counterparty: { address: 'noreply@shopify.com', name: null },
        }),
        mail({
          direction: 'outbound',
          receivedAt: '2026-08-01T02:00:00.000Z',
          counterparty: { address: 'noreply@shopify.com', name: null },
        }),
      ],
      OWN,
    )
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped[0].messages).toBe(2)
  })

  /**
   * 真正需要「记住这条线程已经作废」的场景：机器人开的头，我们在这条线程里
   * 回了一封给真人（订单通知转给客人、供应商邮件抄给客人）。
   *
   * 不记的话，那封出站会**另起一条**挂着机器人主题的对话，看起来像我们主动
   * 联系过这个客人 —— 上面那条「整条丢」的用例撞不到这里，因为它两封信的对方
   * 是同一个机器人，重判一次仍然会被丢掉。
   */
  it('机器人线程里我们回给真人的那封，也跟着作废，不另起一条幽灵对话', () => {
    const plan = planMailIngest(
      [
        mail({
          direction: 'inbound',
          receivedAt: '2026-08-01T01:00:00.000Z',
          counterparty: { address: 'noreply@bookingsystem.com', name: null },
        }),
        mail({
          direction: 'outbound',
          receivedAt: '2026-08-01T02:00:00.000Z',
          counterparty: { address: 'susan@gmail.com', name: 'Susan Lee' },
        }),
      ],
      OWN,
    )
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped.reduce((n, s) => n + s.messages, 0)).toBe(2)
  })

  it('同事之间的内部邮件不建人', () => {
    const plan = planMailIngest(
      [mail({ direction: 'inbound', counterparty: { address: 'amy@ctstours.co.nz', name: 'Amy' } })],
      OWN,
    )
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped[0].why).toBe('公司内部邮箱')
  })

  it('读不出对方是谁的信 → 不猜，丢掉并说明', () => {
    const plan = planMailIngest([mail({ direction: 'inbound', counterparty: null })], OWN)
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped[0].why).toContain('读不出对方')
  })

  /** 丢掉了谁、丢了几封要说得出来 —— 判据判错了要能从这个数看出规模。 */
  it('按发件人汇总丢掉的数量', () => {
    const plan = planMailIngest(
      [
        mail({ direction: 'inbound', conversationId: 'a', counterparty: { address: 'noreply@x.com', name: null } }),
        mail({ direction: 'inbound', conversationId: 'b', counterparty: { address: 'noreply@x.com', name: null } }),
      ],
      OWN,
    )
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0].messages).toBe(2)
  })

  it('真客人不受影响', () => {
    const plan = planMailIngest([mail({ direction: 'inbound' })], OWN)
    expect(plan.threads).toHaveLength(1)
    expect(plan.skipped).toHaveLength(0)
  })
})

describe('④ 自动回执不算「有人跟过他」', () => {
  it.each([
    'Automatic reply: 想问一下行程',
    'Out of Office',
    'Re: Automatic reply: 想问一下行程',
    '自动回复：我们已收到您的邮件',
    'Undeliverable: 想问一下行程',
  ])('%s → 标成自动，不算跟进', (subject) => {
    expect(isAutoReply(subject)).toBe(true)
  })

  it.each(['Re: 想问一下行程', '报价来了', '关于 out of office 期间的行程安排', null])(
    '%s → 是真回信',
    (subject) => {
      expect(isAutoReply(subject)).toBe(false)
    },
  )

  it('我们发的自动回执被标出来', () => {
    const plan = planMailIngest(
      [mail({ direction: 'outbound', subject: 'Automatic reply: 想问一下行程' })],
      OWN,
    )
    expect(plan.threads[0].messages[0].automated).toBe(true)
  })

  /**
   * 客人那边的自动回复不归我们管。把它标成 automated 会让一条真的来信从
   * 「他回话了」里消失 —— 那是把热线索埋掉，比多标一次贵得多。
   */
  it('客人发来的自动回复不标 —— 那是他的事，不是我们跟进过', () => {
    const plan = planMailIngest(
      [mail({ direction: 'inbound', subject: 'Automatic reply: 想问一下行程' })],
      OWN,
    )
    expect(plan.threads[0].messages[0].automated).toBe(false)
  })

  it('人写的回信不会被误标 —— 误标等于让销售以为自己没跟过，重复联系客人', () => {
    const plan = planMailIngest([mail({ direction: 'outbound', subject: 'Re: 想问一下行程' })], OWN)
    expect(plan.threads[0].messages[0].automated).toBe(false)
  })
})

describe('公司自己的域名', () => {
  it('从连进来的邮箱地址推出来', () => {
    expect(ownDomainsOf('info@ctstours.co.nz', null)).toEqual(['ctstours.co.nz'])
  })

  /** 官网域名和收信域名可能不是同一个（官网 .com、邮箱 .co.nz），两个都要认。 */
  it('官网域名和邮箱域名不同 → 两个都算内部', () => {
    expect(ownDomainsOf('info@ctstours.co.nz', 'https://www.ctstours.com/')).toEqual([
      'ctstours.co.nz',
      'ctstours.com',
    ])
  })

  it('两处一样时不重复', () => {
    expect(ownDomainsOf('info@ctstours.co.nz', 'ctstours.co.nz')).toEqual(['ctstours.co.nz'])
  })

  it('两处都没有 → 空，调用方据此不做内部判断，不猜', () => {
    expect(ownDomainsOf(null, null)).toEqual([])
  })
})
