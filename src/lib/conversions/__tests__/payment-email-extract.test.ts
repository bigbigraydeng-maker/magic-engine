/**
 * 付款邮件提取器的回归测试。语料全部是虚构的（不含任何真实客人信息）。
 *
 * 最重要的是「不该算成交」和「金额不许猜」两类：成交事件发给 Meta 后撤不回。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyPaymentKind,
  extractInvoiceNumbers,
  extractPaymentFromEmail,
  stripQuotedChain,
} from '../payment-email-extract'

const CFG = { defaultCurrency: 'NZD' }

function run(body: string, subject: string | null = 'Your booking') {
  return extractPaymentFromEmail({ subject, body }, CFG)
}

function confirmed(body: string, subject: string | null = 'Your booking') {
  const r = run(body, subject)
  if (r.status !== 'confirmed') throw new Error(`expected confirmed, got ${r.status}`)
  return r
}

describe('定金 / 全款 / 尾款 类型', () => {
  it('deposit received → deposit，金额取同句', () => {
    const r = confirmed('Hi Sam, your deposit of $500.00 has been received. Thanks! Invoice INV-20481.')
    expect(r.kind).toBe('deposit')
    expect(r.amount).toEqual({ value: '500.00', currency: 'NZD' })
    expect(r.amountIssue).toBeNull()
    expect(r.invoiceNo).toBe('INV20481')
    expect(r.flags).toEqual([])
  })

  it('payment received in full → full', () => {
    const r = confirmed('Hi Sam, your payment of $4,500 has been received in full. Cheers')
    expect(r.kind).toBe('full')
    expect(r.amount).toEqual({ value: '4500.00', currency: 'NZD' })
  })

  it('balance received → balance（调用方据此不生成成交）', () => {
    const r = confirmed('Your balance payment of $4,000.00 has been received. See you soon.')
    expect(classifyPaymentKind(r.evidence)).toBe('balance')
    expect(r.kind).toBe('balance')
  })

  it('只写 payment received，没写 deposit/full → unknown（不进自动车道）', () => {
    const r = confirmed('Hi Sam, your payment has been received, thank you.')
    expect(r.kind).toBe('unknown')
  })

  it('确认句里同时出现 balance 字样但被确认的是 deposit → deposit', () => {
    const r = confirmed('Your deposit of $500 has been received, balance due 30 days prior to departure.')
    expect(r.kind).toBe('deposit')
  })
})

describe('🔴 不该算成交', () => {
  it('催款信（付款链接）不是成交', () => {
    expect(run('Please find the credit card payment link below: https://pay.example/abc').status).toBe('not_confirmed')
  })

  it('条件句 once payment has been received 不是成交', () => {
    expect(
      run('Please use the payment link below. Your booking will be confirmed once payment has been received in full.')
        .status,
    ).toBe('not_confirmed')
  })

  it('否定 / 询问不是成交', () => {
    expect(run('Your payment has not been received yet.').status).toBe('not_confirmed')
    expect(run('Can you confirm whether your payment has been received.').status).toBe('not_confirmed')
  })

  it('只有引用链里有确认句（本封没有）→ 不是成交', () => {
    const body = ['Hi Sam, which tour dates suit you?', '', 'On Mon, 5 Oct 2026 at 10:00, Admin <a@b.test> wrote:', '> Your deposit of $500 has been received.'].join('\n')
    expect(run(body).status).toBe('not_confirmed')
  })
})

describe('金额：不估算、多个就不选', () => {
  it('同句没金额、相邻句有唯一金额 → 取相邻句', () => {
    const r = confirmed('Thank you, your deposit has been received. Amount received: $750.00.')
    expect(r.amount).toEqual({ value: '750.00', currency: 'NZD' })
  })

  it('相邻句带 balance/due 字样的金额不取 → missing', () => {
    const r = confirmed('Your deposit has been received. Balance of $4,500.00 is due 30 days prior.')
    expect(r.amount).toBeNull()
    expect(r.amountIssue).toBe('missing')
  })

  it('同句出现两个不同金额 → ambiguous，不选', () => {
    const r = confirmed('Your deposit of $500 has been received, out of a total of $5,000.')
    expect(r.amount).toBeNull()
    expect(r.amountIssue).toBe('ambiguous')
  })

  it('完全没有金额 → missing，绝不补', () => {
    const r = confirmed('Your deposit has been received. Thank you.')
    expect(r.amount).toBeNull()
    expect(r.amountIssue).toBe('missing')
  })

  it('显式币种优先于默认币种', () => {
    const r = confirmed('Your deposit of AUD 600.00 has been received.')
    expect(r.amount).toEqual({ value: '600.00', currency: 'AUD' })
  })

  it('同一金额「NZD $500」「$500」重复出现算一笔', () => {
    const r = confirmed('Your deposit of NZD $500.00 has been received (that is $500.00 in total).')
    expect(r.amount).toEqual({ value: '500.00', currency: 'NZD' })
  })

  it('没配默认币种、正文只写 $ → no_currency，不猜', () => {
    const r = extractPaymentFromEmail(
      { subject: null, body: 'Your deposit of $500.00 has been received.' },
      { defaultCurrency: null },
    )
    expect(r.status === 'confirmed' && r.amountIssue).toBe('no_currency')
  })

  it('不支持的币种（JPY）不被当成金额读出来 → missing，不猜', () => {
    const r = confirmed('Your deposit has been received (JPY 50000).')
    expect(r.amountIssue).toBe('missing')
  })
})

describe('🔴 魏征 2026-10-04 复审：金额口径', () => {
  it('邻句取到的金额带 amount_adjacent 旗标（不得进自动车道）', () => {
    const r = confirmed('Thank you, your deposit has been received. Amount: $500.00.')
    expect(r.amount).toEqual({ value: '500.00', currency: 'NZD' })
    expect(r.flags).toContain('amount_adjacent')
  })

  it('邻句是总价/团费 → 不取（OWED_WORDS 含 total/price/fee/fare…）', () => {
    for (const lead of ['The total tour price is $5,200.', 'Package cost $5,200.', 'The fare is $5,200.']) {
      const r = confirmed(`${lead} Your deposit has been received.`)
      expect(r.amount, lead).toBeNull()
      expect(r.amountIssue, lead).toBe('missing')
    }
  })

  it('币种冲突：正文出现与所取币种不同的币种代码 → currency_conflict 旗标', () => {
    const r = confirmed('Your deposit of $500.00 has been received. All prices are in AUD.')
    expect(r.flags).toContain('currency_conflict')
  })

  it('同句带显式币种、全文只有这一个币种 → 无旗标', () => {
    const r = confirmed('Your deposit of AUD 600.00 has been received.')
    expect(r.flags).toEqual([])
  })
})

describe('发票号', () => {
  it('多个不同发票号 → 不选', () => {
    const r = confirmed('Your deposit of $500 has been received for INV-1001. Earlier invoice INV-0999 is closed.')
    expect(r.invoiceNo).toBeNull()
    expect(r.invoiceAmbiguous).toBe(true)
  })

  it('年份不当发票号', () => {
    expect(extractInvoiceNumbers('Invoice 2026 for your trip')).toEqual([])
  })

  it('支持 "Invoice No: 20481" 写法', () => {
    expect(extractInvoiceNumbers('Invoice No: 20481')).toEqual(['20481'])
  })

  it('第二行业格式：由配置的 pattern 提取（共享核心不改）', () => {
    const r = extractPaymentFromEmail(
      { subject: null, body: 'Your deposit of $1,000.00 has been received. Contract ref REA-77123.' },
      { defaultCurrency: 'AUD', invoicePatterns: [/\bcontract\s+ref\s+([A-Z]{3}-\d{5})\b/gi] },
    )
    expect(r.status === 'confirmed' && r.invoiceNo).toBe('REA77123')
  })
})

describe('转发与引用', () => {
  it('主题是转发 → 命中但带 forwarded 旗标（不得进自动车道）', () => {
    const r = confirmed('Your deposit of $500 has been received.', 'Fw: Booking for Sam')
    expect(r.flags).toContain('forwarded')
  })

  it('正文内嵌转发标记 → embedded_forward 旗标', () => {
    const r = confirmed(
      ['Your deposit of $500 has been received.', '', '---------- Forwarded message ---------', 'From: a@b.test'].join('\n'),
    )
    expect(r.flags).toContain('embedded_forward')
  })

  it('同时有确认句和催款句 → mixed_with_chasing 旗标', () => {
    const r = confirmed(
      'Your deposit of $500 has been received. Please find the payment link below for the balance: https://pay.example/x',
    )
    expect(r.flags).toContain('mixed_with_chasing')
  })

  it('剥引用链：本封确认句保留，引用里的旧金额不参与', () => {
    const body = [
      'Your deposit of $500 has been received.',
      '',
      'On Mon, 5 Oct 2026 at 10:00, Sam <s@x.test> wrote:',
      '> I will pay $5,000 later',
    ].join('\n')
    const r = confirmed(body)
    expect(r.amount).toEqual({ value: '500.00', currency: 'NZD' })
    expect(r.flags).toContain('quoted_chain_removed')
  })
})

describe('stripQuotedChain', () => {
  it('Outlook 分隔线之后全部丢掉', () => {
    const { text, hadQuotedChain } = stripQuotedChain('Hello\n________________________________\nFrom: x\nSent: y')
    expect(text.trim()).toBe('Hello')
    expect(hadQuotedChain).toBe(true)
  })

  it('没有引用时原样返回', () => {
    const { text, hadQuotedChain } = stripQuotedChain('Just a note.')
    expect(text).toBe('Just a note.')
    expect(hadQuotedChain).toBe(false)
  })
})
