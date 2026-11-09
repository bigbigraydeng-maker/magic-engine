import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../event-window'
import {
  PAYMENT_MATCH_RULE,
  customerAgreement,
  decidePaymentMatch,
  resolveBookedTourPrice,
  type CatalogPrice,
  type MatchBooking,
  type PaymentMatchInput,
} from '../payment-match'

const NOW = new Date('2026-11-10T00:00:00Z')
const RECENT = new Date(NOW.getTime() - 2 * DAY_MS).toISOString()
const PRICE_TEXT = 'From NZD $4,999 per person'

function price(over: Partial<CatalogPrice> = {}): CatalogPrice {
  return { amountMinor: 499900, currency: 'NZD', priceText: PRICE_TEXT, source: 'tour_display', ...over }
}

function booking(over: Partial<MatchBooking> = {}): MatchBooking {
  return { id: 'b1', tourId: 't1', departureId: null, depositPaid: true, price: price(), ...over }
}

function input(over: Partial<PaymentMatchInput> = {}): PaymentMatchInput {
  return {
    outcomeKind: 'purchase',
    contactId: 'contact-1',
    customerEmail: 'guest@example.com',
    customerPhone: null,
    amountMinor: 499900,
    currency: 'NZD',
    occurredAt: RECENT,
    contact: { emails: ['guest@example.com'], phones: [] },
    defaultPhoneCountry: '64',
    bookings: [booking()],
    now: NOW,
    usedBookingIds: new Set(),
    approvedSameAmount: false,
    ...over,
  }
}

describe('resolveBookedTourPrice', () => {
  it('用团展示价的每人标价，不把文字改成别的数', () => {
    expect(resolveBookedTourPrice(null, PRICE_TEXT)).toEqual(price())
  })

  it('班期有自己的标价时只用班期价', () => {
    const override = 'From NZD $5,200 per person'
    expect(resolveBookedTourPrice(override, PRICE_TEXT)).toMatchObject({
      amountMinor: 520000,
      source: 'departure_override',
      priceText: override,
    })
  })

  it('班期价解析不了时不退回团展示价', () => {
    expect(resolveBookedTourPrice('TBC', PRICE_TEXT)).toBeNull()
  })

  it('没有可解析的标价时返回空', () => {
    expect(resolveBookedTourPrice('  ', 'ask us')).toBeNull()
    expect(resolveBookedTourPrice(null, null)).toBeNull()
  })
})

describe('customerAgreement', () => {
  it('邮箱对上就算同一个客人，大小写和空格不算差异', () => {
    expect(
      customerAgreement(
        { customerEmail: ' Guest@Example.com ', customerPhone: null },
        { emails: ['guest@example.com'], phones: [] },
        '64',
      ),
    ).toBe('match')
  })

  it('电话对上就算同一个客人', () => {
    expect(
      customerAgreement(
        { customerEmail: null, customerPhone: '021 555 1234' },
        { emails: [], phones: ['64215551234'] },
        '64',
      ),
    ).toBe('match')
  })

  it('邮箱对上但电话是别人的 → 客人不一致', () => {
    expect(
      customerAgreement(
        { customerEmail: 'guest@example.com', customerPhone: '021 555 9999' },
        { emails: ['guest@example.com'], phones: ['64215551234'] },
        '64',
      ),
    ).toBe('mismatch')
  })

  it('没有邮箱也没有电话 → 资料不够，不靠姓名猜', () => {
    expect(customerAgreement({ customerEmail: null, customerPhone: '   ' }, { emails: [], phones: [] }, '64')).toBe(
      'missing',
    )
  })
})

describe('decidePaymentMatch', () => {
  it('定金已收且金额等于每人标价 → 发送，并带上规则要用的价', () => {
    const decision = decidePaymentMatch(input())
    expect(decision).toMatchObject({
      action: 'send',
      bookingId: 'b1',
      price: { amountMinor: 499900, currency: 'NZD', source: 'tour_display' },
    })
    expect(PAYMENT_MATCH_RULE).toBe('crm_deposit_paid_and_per_person_catalog_price')
  })

  it('两人同行、金额是标价的两倍 → 金额对不上，不把人数乘进去', () => {
    expect(decidePaymentMatch(input({ amountMinor: 999800 }))).toEqual({ action: 'hold', reason: 'amount_mismatch' })
  })

  it('差 1 分、币种不同、标价缺失，各自留下给人看', () => {
    expect(decidePaymentMatch(input({ amountMinor: 499901 }))).toEqual({ action: 'hold', reason: 'amount_mismatch' })
    expect(decidePaymentMatch(input({ currency: 'AUD' }))).toEqual({ action: 'hold', reason: 'amount_mismatch' })
    expect(decidePaymentMatch(input({ bookings: [booking({ price: null })] }))).toEqual({
      action: 'hold',
      reason: 'missing_price',
    })
  })

  it('没有已收定金的预订 → 付款还没在 CRM 确认', () => {
    expect(decidePaymentMatch(input({ bookings: [booking({ depositPaid: false })] }))).toEqual({
      action: 'hold',
      reason: 'payment_not_confirmed',
    })
    expect(decidePaymentMatch(input({ bookings: [] }))).toEqual({ action: 'hold', reason: 'payment_not_confirmed' })
  })

  it('两条已付定金的预订都对得上这个金额 → 分不清是哪一笔', () => {
    expect(decidePaymentMatch(input({ bookings: [booking(), booking({ id: 'b2' })] }))).toEqual({
      action: 'hold',
      reason: 'ambiguous_booking',
    })
  })

  it('两条预订里只有一条价对得上 → 发对得上的那条', () => {
    const other = booking({ id: 'b2', price: price({ amountMinor: 100000, priceText: 'From NZD $1,000 per person' }) })
    expect(decidePaymentMatch(input({ bookings: [other, booking()] }))).toMatchObject({ action: 'send', bookingId: 'b1' })
  })

  it('客人不一致、没有联系人、没有邮箱电话、不是成交、来不及发，都不发', () => {
    expect(decidePaymentMatch(input({ contact: { emails: ['other@example.com'], phones: [] } }))).toEqual({
      action: 'hold',
      reason: 'customer_mismatch',
    })
    expect(decidePaymentMatch(input({ contactId: null }))).toEqual({ action: 'hold', reason: 'missing_contact' })
    expect(decidePaymentMatch(input({ customerEmail: null }))).toEqual({ action: 'hold', reason: 'missing_identity' })
    expect(decidePaymentMatch(input({ outcomeKind: 'lead' }))).toEqual({ action: 'hold', reason: 'not_purchase' })
    expect(decidePaymentMatch(input({ outcomeKind: 'balance' }))).toEqual({ action: 'hold', reason: 'not_purchase' })
    const late = new Date(NOW.getTime() - (7 * DAY_MS - 30 * 60 * 1000)).toISOString()
    expect(decidePaymentMatch(input({ occurredAt: late }))).toEqual({ action: 'hold', reason: 'too_late' })
  })

  it('这笔预订已经发过，或已有一笔相同金额的已批准成交 → 不再发', () => {
    expect(decidePaymentMatch(input({ usedBookingIds: new Set(['b1']) }))).toEqual({
      action: 'hold',
      reason: 'duplicate_booking',
    })
    expect(decidePaymentMatch(input({ approvedSameAmount: true }))).toEqual({
      action: 'hold',
      reason: 'duplicate_booking',
    })
  })

  it('金额缺失 → 资料不够', () => {
    expect(decidePaymentMatch(input({ amountMinor: null }))).toEqual({ action: 'hold', reason: 'missing_amount' })
    expect(decidePaymentMatch(input({ currency: null }))).toEqual({ action: 'hold', reason: 'missing_amount' })
  })
})
