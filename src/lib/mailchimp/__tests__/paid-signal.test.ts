/**
 * 「这个人的钱到账了没有」——判据的回归测试。
 *
 * 语料全部取自 info@ctstours.co.nz 2026-09-02 的真实邮件，一个字没改。
 * 最要命的一条是 `Payment of Invoice` 那封：它是**催款**，长得却跟收款几乎
 * 一模一样。判错的代价不是脏数据，是把一个正在谈的客人标成已付款、停掉他所有
 * 跟进邮件 —— 这单就丢了。所以催款那几条用 🔴 标出来，它们比正例更重要。
 */

import { describe, expect, it } from 'vitest'
import {
  readPaidSignal,
  evidenceIsVerbatim,
  looksLikeCustomerAddress,
  isForwardedSubject,
} from '../paid-signal'

// ── 真实语料 ────────────────────────────────────────────────────────────────

/** Baker 发给 Nikki Smith 的确认信（Sent Items, 2026-09-01 11:02）。 */
const REAL_CONFIRM =
  'Fw: New Reborn Lead: Nikki Smith — still_deciding_—_show_me_all_4 ' +
  'Hi Nikki Your payment has been received in full. Thank you so much. Cheers! Baker'

/** 🔴 发给 Lorraine 的催款信（Sent Items, 2026-09-01 11:01）—— 她还没付。 */
const REAL_CHASING =
  'Payment of Invoice - Best of China Tour ' +
  'Dear Lorraine, Please find the credit card payment link below: ' +
  'https://gateway-app.latipay.net/payment-me'

/** 收款后发行程（Sent Items, 2026-09-02 18:51）。 */
const REAL_THANKS =
  'China Discovery Best of China | November ' +
  'Hi Lorraine, Thank you again for the payment. Please received the itinerary with flight details'

/** 客人发来的付款确认（Inbox, 2026-08-27）。 */
const REAL_INBOUND = 'Payment confirmation Get Outlook for Android'

describe('readPaidSignal · 我们自己确认收款', () => {
  it('真实语料：「Your payment has been received in full」→ confirmed', () => {
    const v = readPaidSignal({ text: REAL_CONFIRM, direction: 'outbound' })
    expect(v.kind).toBe('confirmed')
    if (v.kind === 'confirmed') {
      expect(v.evidence.toLowerCase()).toContain('payment has been received')
      expect(evidenceIsVerbatim(v.evidence, REAL_CONFIRM)).toBe(true)
    }
  })

  it('真实语料：「Thank you again for the payment」→ confirmed', () => {
    const v = readPaidSignal({ text: REAL_THANKS, direction: 'outbound' })
    expect(v.kind).toBe('confirmed')
  })

  it('同一封信里客人复述「payment has been received」→ 不算数（只认 outbound）', () => {
    // 客人转发我们的确认信回来，方向是 inbound —— 不能因此打标签
    const v = readPaidSignal({ text: REAL_CONFIRM, direction: 'inbound' })
    expect(v.kind).not.toBe('confirmed')
  })
})

describe('readPaidSignal · 🔴 催款不能当成付款', () => {
  it('🔴 真实语料：「please find the credit card payment link」→ chasing，绝不是 confirmed', () => {
    const v = readPaidSignal({ text: REAL_CHASING, direction: 'outbound' })
    expect(v.kind).toBe('chasing')
  })

  it('🔴 主题里有 payment、正文在催 → 仍是 chasing', () => {
    const v = readPaidSignal({
      text: 'Payment of Invoice please make payment before 30 September',
      direction: 'outbound',
    })
    expect(v.kind).toBe('chasing')
  })

  it('🔴 「awaiting payment」→ chasing', () => {
    expect(readPaidSignal({ text: 'Still awaiting payment for this booking', direction: 'outbound' }).kind)
      .toBe('chasing')
  })

})

/**
 * 🔴 魏征 2026-09-03 对抗复审攻破首版的那一组。
 *
 * 首版只匹配 received 的**词形**，不看时态语气，于是一句旅行社发票标准条款
 * 「Your booking will be confirmed once payment has been received in full」
 * 就能让一封带付款链接的催款信判成已付款 —— 客人还没付钱，却被摘光线索标签、
 * 从此收不到任何跟进。这单就丢了。这组必须永远红不了。
 */
describe('readPaidSignal · 🔴🔴 时态语气攻击（魏征复审语料）', () => {
  const MUST_NOT_CONFIRM: Array<[string, string]> = [
    ['条件从句 once', 'Please find the credit card payment link below: https://gateway-app.latipay.net/payment-me Your booking will be confirmed once payment has been received in full.'],
    ['将来时 after', 'Your tickets will be issued after payment is received.'],
    ['until 条款', 'We cannot hold the seats until the deposit has been received.'],
    ['疑问句', 'can you confirm whether your payment has been received at your bank end?'],
    ['页脚样板', 'CTS Tours - payment received receipts are issued automatically within 24 hours'],
    ['否定句', 'Unfortunately payment has not been received yet.'],
    ['否定缩写', "Sorry, the payment hasn't been received."],
    ['once let us know', 'let us know once payment received.'],
    ['引用客人原话', 'RE: payment. Not yet sorry. From: Nikki Subject: payment received?'],
    // Codex 复审补充：请求语气用**句号**结尾，只看问号会漏
    ['请求语气 please confirm', 'Please confirm whether your payment has been received.'],
    ['请求语气 can you confirm', 'Can you confirm that your payment has been received.'],
    ['请求语气 kindly confirm', 'Kindly confirm if the deposit has been received.'],
    ['请求语气 let us know', 'Let us know whether your payment has been received.'],
  ]
  for (const [name, text] of MUST_NOT_CONFIRM) {
    it(`🔴 ${name} → 绝不能判成 confirmed`, () => {
      expect(readPaidSignal({ text, direction: 'outbound' }).kind).not.toBe('confirmed')
    })
  }
})

describe('readPaidSignal · 真实确认句必须仍然认得出（防止修假阳性时误杀）', () => {
  const MUST_CONFIRM: Array<[string, string]> = [
    ['Nikki 原文', 'Hi Nikki Your payment has been received in full. Thank you so much.'],
    ['Chris 原文', 'Hi Chris, We would like to confirm that your payment has been received. Please find the itinerary'],
    ['Isaac 原文（well 插词）', 'Hi Isaac, Your payment has been well received. Thank you very much.'],
    ['lisaamin 原文', 'Your payment is received with thanks and really appreciated your efforts to settle this'],
    ['we have received your final payment', 'we have received your final payment'],
    ['has now been received', 'Your deposit has now been received.'],
    ['many thanks for your payment', 'Many thanks for your payment'],
    ['funds have been received', 'Your funds have been received in full.'],
    ['confirming receipt of', 'Confirming receipt of your payment of NZ$4,500.'],
  ]
  for (const [name, text] of MUST_CONFIRM) {
    it(`${name} → confirmed`, () => {
      expect(readPaidSignal({ text, direction: 'outbound' }).kind).toBe('confirmed')
    })
  }
})

describe('readPaidSignal · 拿不准就交给人', () => {
  it('🔴 同一封信既确认收款又在催款 → needs_review，不自动执行', () => {
    const v = readPaidSignal({
      text: 'Your deposit has been received. For the balance please find the payment link below',
      direction: 'outbound',
    })
    expect(v.kind).toBe('needs_review')
    if (v.kind === 'needs_review') expect(v.reason).toBe('mixed_with_chasing')
  })

  it('🔴 转发信（Fw:）→ needs_review，收件人可能不是这句话说的那个人', () => {
    const v = readPaidSignal({
      text: 'Fw: booking Hi Nikki Your payment has been received in full.',
      direction: 'outbound',
      isForward: true,
    })
    expect(v.kind).toBe('needs_review')
    if (v.kind === 'needs_review') expect(v.reason).toBe('forwarded')
  })
})

/**
 * 🔴 客人报付款用的是**短句**，不是完整主谓。
 *
 * 真实语料（info@ 2026-08-10，Isaac Brown）：「Invoice paid thanks Isaac.」
 * —— 首版的 `paid the (deposit|balance|invoice)` 匹配不到它。
 *
 * 更糟的是这类句子里常常带着「payment link」（客人在回我们发去的付款链接），
 * 于是会被催款判据抢走判成 chasing =「我们在催他」，一个**已经付了钱的客人
 * 永远进不了人工核对名单**，继续收招揽邮件。
 */
describe('readPaidSignal · 🔴 客人的短句付款声明（真实语料）', () => {
  const MUST_REVIEW = [
    'Invoice paid thanks Isaac.',
    'Payment done via the payment link you sent.',
    'Payment made, please confirm.',
    'Transfer done today, invoice attached.',
    'Just paid using the payment link.',
    'I have made the payment using the payment link below. Thanks',
  ]
  for (const text of MUST_REVIEW) {
    it(`🔴 「${text.slice(0, 34)}…」→ needs_review，不能被当成催款`, () => {
      expect(readPaidSignal({ text, direction: 'inbound' }).kind).toBe('needs_review')
    })
  }

  it('🔴 回归：我们自己发的催款信仍然是 chasing（别把催款也放进来）', () => {
    expect(
      readPaidSignal({
        text: 'Dear Lorraine, Please find the credit card payment link below: https://x',
        direction: 'outbound',
      }).kind,
    ).toBe('chasing')
  })
})

describe('readPaidSignal · 客人自己说付了 → 只到 needs_review', () => {
  it('真实语料：客人主题「Payment confirmation」→ needs_review，不自动打标签', () => {
    const v = readPaidSignal({ text: REAL_INBOUND, direction: 'inbound' })
    expect(v.kind).toBe('needs_review')
  })

  it('「I have transferred the deposit」→ needs_review', () => {
    const v = readPaidSignal({ text: 'Hi, I have transferred the deposit today', direction: 'inbound' })
    expect(v.kind).toBe('needs_review')
  })

  it('🔴 「I\'ll transfer tomorrow」是未来式 → 什么都不算（看账不看话）', () => {
    const v = readPaidSignal({ text: "Sounds good, I'll transfer the deposit tomorrow", direction: 'inbound' })
    expect(v.kind).toBe('not_payment')
  })

  it('🔴 客人说付了，但方向标成 outbound → 也不能 confirmed', () => {
    const v = readPaidSignal({ text: 'I have paid the deposit', direction: 'outbound' })
    expect(v.kind).not.toBe('confirmed')
  })

  it('🔴 「I have made the payment using the payment link below」→ needs_review，不能被 payment link 抢成 chasing', () => {
    const v = readPaidSignal({
      text: 'Hi, I have made the payment using the payment link below. Thanks!',
      direction: 'inbound',
    })
    expect(v.kind).toBe('needs_review')
    if (v.kind === 'needs_review') expect(v.reason).toBe('inbound_claim')
  })
})

describe('readPaidSignal · 🔴 条件式收款句不能当成 confirmed', () => {
  it('🔴 「Once your payment is received, ...」→ 不是 confirmed（钱还没到）', () => {
    const v = readPaidSignal({
      text: 'Once your payment is received, we will send the invoice.',
      direction: 'outbound',
    })
    expect(v.kind).not.toBe('confirmed')
  })

  it('🔴 「Once we have received your payment, ...」→ 不是 confirmed（条件词隔着几个词）', () => {
    const v = readPaidSignal({
      text: 'Once we have received your payment, we will ship your tickets.',
      direction: 'outbound',
    })
    expect(v.kind).not.toBe('confirmed')
  })

  it('🔴 「When your deposit has been received, ...」→ 不是 confirmed', () => {
    const v = readPaidSignal({
      text: 'When your deposit has been received, our team will confirm your seats.',
      direction: 'outbound',
    })
    expect(v.kind).not.toBe('confirmed')
  })

  it('真实确认句不受影响：「Your payment has been received in full」仍是 confirmed', () => {
    const v = readPaidSignal({ text: REAL_CONFIRM, direction: 'outbound' })
    expect(v.kind).toBe('confirmed')
  })

  it('🔴 「Until your payment is received, ...」→ 不是 confirmed（钱还没到）', () => {
    const v = readPaidSignal({
      text: 'Until your payment is received, we are unable to confirm your seats.',
      direction: 'outbound',
    })
    expect(v.kind).not.toBe('confirmed')
  })

  it('🔴 「Before the payment is received, ...」→ 不是 confirmed（钱还没到）', () => {
    const v = readPaidSignal({
      text: 'Before the payment is received, please do not book your flights.',
      direction: 'outbound',
    })
    expect(v.kind).not.toBe('confirmed')
  })
})

describe('readPaidSignal · 附件里的付款凭证 → needs_review(attachment_only)', () => {
  it('客人只写「Please see attached」但主题在谈付款、带附件 → needs_review/attachment_only', () => {
    const v = readPaidSignal({
      text: 'Payment of Invoice - Best of China Tour Please see attached.',
      direction: 'inbound',
      hasAttachment: true,
    })
    expect(v.kind).toBe('needs_review')
    if (v.kind === 'needs_review') expect(v.reason).toBe('attachment_only')
  })

  it('同样的文本没有附件 → 不触发 attachment_only', () => {
    const v = readPaidSignal({
      text: 'Payment of Invoice - Best of China Tour Please see attached.',
      direction: 'inbound',
      hasAttachment: false,
    })
    expect(v.kind).not.toBe('needs_review')
  })

  it('带附件但正文完全没提付款 → 不触发（避免把行程单附件也当成付款凭证）', () => {
    const v = readPaidSignal({
      text: 'Please see attached for the updated itinerary',
      direction: 'inbound',
      hasAttachment: true,
    })
    expect(v.kind).toBe('not_payment')
  })
})

describe('readPaidSignal · 无关邮件', () => {
  it('普通行程询问 → not_payment', () => {
    expect(readPaidSignal({ text: 'Can you please forward me the full itinerary', direction: 'inbound' }).kind)
      .toBe('not_payment')
  })

  it('空文本 → not_payment，不炸', () => {
    expect(readPaidSignal({ text: '', direction: 'outbound' }).kind).toBe('not_payment')
  })

  it('🔴 「booking is confirmed」不等于钱到账 → not_payment', () => {
    expect(readPaidSignal({ text: 'Your booking is confirmed for November', direction: 'outbound' }).kind)
      .toBe('not_payment')
  })
})

describe('evidenceIsVerbatim · 说不出原话就不算数', () => {
  it('原话在文里 → true', () => {
    expect(evidenceIsVerbatim('payment has been received', REAL_CONFIRM)).toBe(true)
  })

  it('🔴 编出来的句子 → false', () => {
    expect(evidenceIsVerbatim('he paid NZ$2000 last Tuesday', REAL_CONFIRM)).toBe(false)
  })

  it('空 evidence → false', () => {
    expect(evidenceIsVerbatim('   ', REAL_CONFIRM)).toBe(false)
  })
})

/** CTS 的真实自有域名（含 2026-08-04 事故里的关联公司）。由调用方算好传进来。 */
const CTS_OWN = ['ctstours.co.nz', 'chinatravel.co.nz']

describe('isForwardedSubject · Outlook 的前缀链', () => {
  it('🔴 RE: Fw: —— 员工回复一封转发，首版正则认不出（Codex 复审）', () => {
    expect(isForwardedSubject('RE: Fw: China Tour - November')).toBe(true)
    expect(isForwardedSubject('Re: Fwd: booking')).toBe(true)
    expect(isForwardedSubject('RE: RE: FW: payment')).toBe(true)
  })

  it('直接转发 → true', () => {
    expect(isForwardedSubject('Fw: New Reborn Lead')).toBe(true)
    expect(isForwardedSubject('Fwd: invoice')).toBe(true)
  })

  it('纯回复不算转发 —— 那是正常往来，不该降级', () => {
    expect(isForwardedSubject('Re: China Tour')).toBe(false)
    expect(isForwardedSubject('RE: RE: booking')).toBe(false)
  })

  it('普通主题 / 空 → false', () => {
    expect(isForwardedSubject('Best of China - November')).toBe(false)
    expect(isForwardedSubject(null)).toBe(false)
    // 「Forward」出现在正文式主题里不算前缀链
    expect(isForwardedSubject('Forwarding your itinerary')).toBe(false)
  })
})

describe('looksLikeCustomerAddress · 别把同事标成付费客户', () => {
  it('🔴 自己人 @ctstours.co.nz → 挡掉', () => {
    expect(looksLikeCustomerAddress('info@ctstours.co.nz', CTS_OWN)).toBe(false)
    expect(looksLikeCustomerAddress('bdm@ctstours.co.nz', CTS_OWN)).toBe(false)
  })

  it('🔴 机器人地址 → 挡掉', () => {
    expect(looksLikeCustomerAddress('noreply@shopify.com', CTS_OWN)).toBe(false)
    expect(looksLikeCustomerAddress('mailer-daemon@outlook.com', CTS_OWN)).toBe(false)
  })

  it('真实客人邮箱 → 放行', () => {
    expect(looksLikeCustomerAddress('enrkay@gmail.com', CTS_OWN)).toBe(true)
    expect(looksLikeCustomerAddress('judc@xtra.co.nz', CTS_OWN)).toBe(true)
  })

  it('🔴 关联公司域名（2026-08-04 pa@chinatravel.co.nz 真实事故）→ 挡掉', () => {
    expect(looksLikeCustomerAddress('pa@chinatravel.co.nz', CTS_OWN)).toBe(false)
  })

  it('🔴 换个客户：CTS 的域名清单对 Oztop 不成立 —— 域名必须来自客户配置', () => {
    const OZTOP_OWN = ['oztop.com.au']
    // 同一个地址，在 CTS 是自己人，在 Oztop 是外人
    expect(looksLikeCustomerAddress('info@ctstours.co.nz', CTS_OWN)).toBe(false)
    expect(looksLikeCustomerAddress('info@ctstours.co.nz', OZTOP_OWN)).toBe(true)
    // 反过来也一样 —— 硬编码成任何一方都会让另一方的过滤器静默失效
    expect(looksLikeCustomerAddress('sales@oztop.com.au', OZTOP_OWN)).toBe(false)
  })

  it('🔴 域名清单为空 → 自己人挡不住（所以调用方必须传，不能忘）', () => {
    expect(looksLikeCustomerAddress('info@ctstours.co.nz', [])).toBe(true)
  })

  it('子域名也算自己人', () => {
    expect(looksLikeCustomerAddress('a@mail.ctstours.co.nz', CTS_OWN)).toBe(false)
  })

  it('格式不对 / 空 → 挡掉', () => {
    expect(looksLikeCustomerAddress('', CTS_OWN)).toBe(false)
    expect(looksLikeCustomerAddress(null, CTS_OWN)).toBe(false)
    expect(looksLikeCustomerAddress('not-an-email', CTS_OWN)).toBe(false)
  })
})

describe('readPaidSignal · 金额夹在名词和 received 之间 / 口语收尾（2026-10-04 成交识别要用）', () => {
  const out = (text: string) => readPaidSignal({ text, direction: 'outbound' })

  it.each([
    'Hi Sam, your deposit of $500.00 has been received. Thanks!',
    'Hi Sam, your payment $7760.00 has been received in full.',
    'I confirm your payment NZD 2000 has been received in full.',
    'Deposit received with thanks and we confirm the departure date.',
    'The payment was received with thanks.',
    'Thank you for the deposit payment received well.',
  ])('认得出：%s', (text) => {
    expect(out(text).kind).toBe('confirmed')
  })

  it.each([
    'Your booking will be confirmed once your deposit of $500 has been received.',
    'Has your deposit of $500 been received?',
    'Your payment of $500 has not been received.',
    'Please confirm whether the deposit of $500 has been received.',
    'Thanks for the booking form received well.',
    'Your payment 2 has been received.',
  ])('🔴 仍然不算确认：%s', (text) => {
    expect(out(text).kind).not.toBe('confirmed')
  })
})
