import { describe, expect, it } from 'vitest'

import { readPaidSignal } from '@/lib/mailchimp/paid-signal'
import { extractPaymentFromEmail } from '@/lib/conversions/payment-email-extract'

describe('readPaidSignal — Chinese outbound confirmations must not auto-confirm', () => {
  const notConfirmed = [
    '已收到定金$500，请核实',
    '已收到定金$500，请核对',
    '已收到定金$500，如有问题请联系我们',
    '他说已收到定金$500',
    '对方说已收到定金$500',
    '你说已收到定金$500',
    '客户已收到定金$500',
  ]

  for (const text of notConfirmed) {
    it(`does not confirm: ${text}`, () => {
      const signal = readPaidSignal({ text, direction: 'outbound' })
      expect(signal.kind).not.toBe('confirmed')
    })
  }

  it('confirms a clean Chinese receipt sentence', () => {
    const signal = readPaidSignal({ text: '已收到您的定金 $500（含 GST）', direction: 'outbound' })
    expect(signal.kind).toBe('confirmed')
  })
})

describe('extractPaymentFromEmail — Chinese amount / kind extraction', () => {
  const config = { defaultCurrency: 'NZD' }

  it('does not take the balance amount from an adjacent sentence', () => {
    const result = extractPaymentFromEmail(
      { subject: null, body: '已收到定金。尾款$1000，请于出发前付清。' },
      config,
    )
    expect(result.status).toBe('confirmed')
    if (result.status !== 'confirmed') return
    expect(result.amount).toBeNull()
    expect(result.amountIssue).toBe('missing')
  })

  it('does not take the total price from an adjacent sentence', () => {
    const result = extractPaymentFromEmail(
      { subject: null, body: '已收到定金。总价$3000。' },
      config,
    )
    expect(result.status).toBe('confirmed')
    if (result.status !== 'confirmed') return
    expect(result.amount).toBeNull()
    expect(result.amountIssue).toBe('missing')
  })

  it('takes the amount from the same sentence as the confirmation', () => {
    const result = extractPaymentFromEmail(
      { subject: null, body: '已收到定金$500。尾款$1000。' },
      config,
    )
    expect(result.status).toBe('confirmed')
    if (result.status !== 'confirmed') return
    expect(result.amount).toEqual({ value: '500.00', currency: 'NZD' })
  })

  it('downgrades kind to unknown when the body also mentions a deposit', () => {
    const result = extractPaymentFromEmail(
      { subject: null, body: '已收到全款$1500。此前定金已含在内。' },
      config,
    )
    expect(result.status).toBe('confirmed')
    if (result.status !== 'confirmed') return
    expect(result.kind).toBe('unknown')
  })

  it('classifies a clean full-payment confirmation as full', () => {
    const result = extractPaymentFromEmail(
      { subject: null, body: '已收到全款$1500。' },
      config,
    )
    expect(result.status).toBe('confirmed')
    if (result.status !== 'confirmed') return
    expect(result.kind).toBe('full')
  })
})
