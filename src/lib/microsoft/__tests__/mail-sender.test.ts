/**
 * 这封邮件的对方算不算一个「客人」。
 *
 * 接邮箱最要紧的一件事就是这个：公司邮箱里**大部分邮件不是客人发的**。
 * 全灌进 CRM，销售第二天早上会看到几百个 `noreply@` 和 `accounts@` 躺在
 * 今天的名单上 —— 那一页当场作废。8/2 已经有过一次小规模预演（4 个假冒
 * Meta 的钓鱼私信被当成真实客人），邮箱的量级比私信大得多。
 *
 * 这里钉的是一条**不对称的判断**：
 *   漏判一个真客人 = 少一次便利（他还会再来一封，信也照样存着）
 *   误判一个机器人 = 整页不可信
 * 所以判据保守，宁可漏。
 */

import { describe, expect, it } from 'vitest'
import { classifySender } from '../mail-sender'

const OWN = ['ctstours.co.nz']

describe('真客人 —— 要建人', () => {
  it('普通的个人邮箱', () => {
    expect(classifySender({ address: 'susan.lee@gmail.com', ownDomains: OWN })).toEqual({
      kind: 'customer',
    })
  })

  it('别的公司的正常邮箱', () => {
    expect(classifySender({ address: 'jane@acme.co.nz', ownDomains: OWN }).kind).toBe('customer')
  })

  /** `someone+shop@gmail.com` 是正常人在用的写法，拦了就是误伤真客人。 */
  it('带 + 号的一次性地址照样算客人 —— 拦它会误伤', () => {
    expect(classifySender({ address: 'susan+cts@gmail.com', ownDomains: OWN }).kind).toBe('customer')
  })

  it('大小写和空格不影响判断', () => {
    expect(classifySender({ address: '  Susan.Lee@Gmail.com  ', ownDomains: OWN }).kind).toBe('customer')
  })

  /**
   * **不能退化成「包含」。**
   *
   * 这是新判据（按段匹配）唯一真正的风险：一旦写成 `includes`，
   * `bounceback` `accountant` `invoiced` 里的真人会被一并误伤，
   * 而误伤一个真客人是**不可见**的损失 —— 没人会发现少了谁。
   *
   * 这几个的机器人词都嵌在更长的词里、不成段，必须放行。
   */
  it.each([
    'andrew.bounceback@gmail.com',
    'mary-accountant@firm.co.nz',
    'sam.invoiced@xtra.co.nz',
  ])('机器人词嵌在更长的词里、不成段（%s）→ 仍算客人', (address) => {
    expect(classifySender({ address, ownDomains: OWN }).kind).toBe('customer')
  })
})

describe('机器人 —— 不建人', () => {
  it.each([
    'noreply@shopify.com',
    'no-reply@meta.com',
    'donotreply@bank.co.nz',
    'mailer-daemon@googlemail.com',
    'postmaster@outlook.com',
    'notifications@facebookmail.com',
    'newsletter@someshop.com',
    'invoices@supplier.co.nz',
    'billing@xero.com',
  ])('%s 不建人', (address) => {
    expect(classifySender({ address, ownDomains: OWN }).kind).toBe('skip')
  })

  /**
   * **2026-08-04 的真实事故。**
   *
   * `testflight_no_reply@email.apple.com` 不以任何机器人词开头，所以旧的
   * 「开头匹配」把它放行了 —— 它变成了 CTS 名单上的一张卡，显示名是
   * 「Meta Platform,lnc. via TestFlight」。客户当场反馈「contact 里怎么还有这些」。
   *
   * `前缀_noreply@` / `前缀-noreply@` 是系统邮件最常见的形式之一，
   * 只判开头等于把这一整类全放过去。
   */
  it.each([
    'testflight_no_reply@email.apple.com',
    'github-noreply@github.com',
    'shopify_notifications@shopify.com',
    'xero.billing@xero.com',
    'meta-notification@facebookmail.com',
  ])('机器人词在后面（%s）→ 照样挡住', (address) => {
    expect(classifySender({ address, ownDomains: OWN }).kind).toBe('skip')
  })

  /**
   * 「以机器人词开头、但后面还粘着别的字」也照挡 —— 这是**故意保留**的宽松边界。
   *
   * `noreply123@` `notificationsystems@` 这类几乎不可能是真人的名字，
   * 而它们恰恰是系统邮箱最常见的另一种写法。
   */
  it.each(['noreply123@shop.com', 'notificationsystems@company.com'])(
    '以机器人词开头、后面还粘着字（%s）→ 挡住',
    (address) => {
      expect(classifySender({ address, ownDomains: OWN }).kind).toBe('skip')
    },
  )

  it('说得出为什么不建 —— 将来能回查判错没有', () => {
    const v = classifySender({ address: 'noreply@x.com', ownDomains: OWN })
    expect(v.kind === 'skip' && v.why).toContain('系统发件人')
  })
})

describe('公司内部', () => {
  it('同域来信 = 同事，不建人', () => {
    const v = classifySender({ address: 'amy@ctstours.co.nz', ownDomains: OWN })
    expect(v).toMatchObject({ kind: 'skip', why: '公司内部邮箱' })
  })

  /**
   * 公司自己的 accounts@ 两条都命中。说「是同事」比说「是机器人」更准确 ——
   * 理由会被写进记录，含糊的理由让将来的回查变成猜。
   */
  it('公司自己的 accounts@ → 理由说「内部」，不说「机器人」', () => {
    const v = classifySender({ address: 'accounts@ctstours.co.nz', ownDomains: OWN })
    expect(v).toMatchObject({ kind: 'skip', why: '公司内部邮箱' })
  })

  it('没告诉我们公司域名 → 不做这项判断，不猜', () => {
    expect(classifySender({ address: 'amy@ctstours.co.nz' }).kind).toBe('customer')
  })

  it('多个公司域名都认', () => {
    const v = classifySender({
      address: 'amy@ctstours.com',
      ownDomains: ['ctstours.co.nz', 'ctstours.com'],
    })
    expect(v.kind).toBe('skip')
  })
})

describe('脏地址', () => {
  it.each(['', '   ', 'not-an-email', '@nolocal.com', 'nodomain@'])('%s → 不建人', (address) => {
    const v = classifySender({ address })
    expect(v).toMatchObject({ kind: 'skip', why: '地址不成形' })
  })
})
