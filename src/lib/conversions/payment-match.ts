/**
 * 成交自动回传的判定（纯函数，不读库、不发送）。
 *
 * 「金额对得上」在现有数据里是什么（2026-11-10）：
 * CRM 预订表故意不存钱（2026-10-13「不要金额」）。能拿来比的付款金额只有
 * 待核对成交行上的 `amount_minor` + `currency`。预订上的团价是团目录里的
 * 展示价：这个班期有自己的价格文字就用它，否则用团的展示价。两处都是
 * 「每人」的标价（例如 "From NZD $4,999 per person"），目录自己也写明这串
 * 文字不做运算。表格同步写进来的成交金额就是这个每人标价，不是人数乘标价。
 * 所以「对得上」= 币种相同，且最小单位金额与解析出来的每人标价完全相等。
 * 不乘出行人数。人数乘出来的总价对不上，留给人看。
 * 标价是目录里现在的价，不是下单当时的快照（预订上没有价的快照）。价后来
 * 改过就会对不上，同样留给人。
 *
 * 付款已确认 = 同一客户、同一联系人有一条仍有效的预订，且定金那一档已标成已收。
 * 只收了尾款不算。客人是否同一个人 = 成交行上的邮箱或电话能对上这个联系人
 * 的身份。两样都没有，不靠姓名去猜。
 */

import { parsePriceDisplayString } from './cts-tour-price'
import { isTooLateToApprove } from './event-window'
import { normalizeEmail, normalizePhone } from '@/lib/pii/normalize'

export const PAYMENT_MATCH_RULE = 'crm_deposit_paid_and_per_person_catalog_price'
export const PAYMENT_MATCH_ACTOR = 'auto:payment-match'
export const PAYMENT_MATCH_AUDIT = 'auto_approved_by_payment_match'

export type PriceSource = 'departure_override' | 'tour_display'

export interface CatalogPrice {
  amountMinor: number
  currency: string
  priceText: string
  source: PriceSource
}

export interface MatchBooking {
  id: string
  tourId: string
  departureId: string | null
  depositPaid: boolean
  price: CatalogPrice | null
}

export type HoldReason =
  | 'not_purchase'
  | 'too_late'
  | 'missing_contact'
  | 'missing_identity'
  | 'customer_mismatch'
  | 'payment_not_confirmed'
  | 'missing_amount'
  | 'missing_price'
  | 'amount_mismatch'
  | 'ambiguous_booking'
  | 'duplicate_booking'

export type PaymentMatchDecision =
  | {
      action: 'send'
      bookingId: string
      tourId: string
      departureId: string | null
      price: CatalogPrice
    }
  | { action: 'hold'; reason: HoldReason }

export interface PaymentMatchInput {
  outcomeKind: string
  contactId: string | null
  customerEmail: string | null
  customerPhone: string | null
  amountMinor: number | null
  currency: string | null
  occurredAt: string
  contact: { emails: readonly string[]; phones: readonly string[] } | null
  defaultPhoneCountry: string | null
  bookings: readonly MatchBooking[]
  now: Date
  /** 已经按这条规则发过的预订。同一笔不再发第二次。 */
  usedBookingIds: ReadonlySet<string>
  /**
   * 这个联系人已经有一笔已批准、金额相同的成交。
   * 只在「这个价只对应一条已付定金的预订」时由调用方置上，用来挡住人已经发过的那一笔。
   */
  approvedSameAmount: boolean
}

/** 班期有自己的标价就只用它；解析不了就不退回团展示价。 */
export function resolveBookedTourPrice(
  departureOverride: string | null | undefined,
  tourDisplay: string | null | undefined,
): CatalogPrice | null {
  const override = departureOverride?.trim() ?? ''
  if (override !== '') return toCatalogPrice(override, 'departure_override')
  const display = tourDisplay?.trim() ?? ''
  if (display === '') return null
  return toCatalogPrice(display, 'tour_display')
}

function toCatalogPrice(text: string, source: PriceSource): CatalogPrice | null {
  const parsed = parsePriceDisplayString(text)
  if (!parsed) return null
  return { amountMinor: parsed.amountMinor, currency: parsed.currency, priceText: text, source }
}

/** 邮箱或电话至少一样对上，且出现了的那几样都对上。对不上是客人不一致，缺了是资料不够。 */
export function customerAgreement(
  outcome: { customerEmail: string | null; customerPhone: string | null },
  contact: { emails: readonly string[]; phones: readonly string[] } | null,
  defaultPhoneCountry: string | null,
): 'match' | 'mismatch' | 'missing' {
  if (!contact) return 'missing'
  const email = normalizeEmail(outcome.customerEmail)
  const phoneRaw = outcome.customerPhone?.trim() ?? ''
  const phone = phoneRaw === '' ? null : normalizePhone(outcome.customerPhone, defaultPhoneCountry)
  if (phoneRaw !== '' && phone == null) return 'missing'
  if (email == null && phone == null) return 'missing'
  const emails = new Set(contact.emails.map((value) => normalizeEmail(value)).filter((value) => value != null))
  const phones = new Set(
    contact.phones.map((value) => normalizePhone(value, defaultPhoneCountry)).filter((value) => value != null),
  )
  if (email != null && !emails.has(email)) return 'mismatch'
  if (phone != null && !phones.has(phone)) return 'mismatch'
  return 'match'
}

function pricedBookings(bookings: readonly MatchBooking[], amountMinor: number, currency: string): MatchBooking[] {
  return bookings.filter(
    (booking) =>
      booking.depositPaid &&
      booking.price != null &&
      booking.price.amountMinor === amountMinor &&
      booking.price.currency === currency,
  )
}

function holdForUnmatched(bookings: readonly MatchBooking[]): HoldReason {
  const paid = bookings.filter((booking) => booking.depositPaid)
  if (paid.length === 0) return 'payment_not_confirmed'
  if (paid.every((booking) => booking.price == null)) return 'missing_price'
  return 'amount_mismatch'
}

/** 全部条件都满足才 `send`。任何一项不够就 `hold`，调用方保持待核对。 */
export function decidePaymentMatch(input: PaymentMatchInput): PaymentMatchDecision {
  if (input.outcomeKind !== 'purchase') return { action: 'hold', reason: 'not_purchase' }
  if (isTooLateToApprove(input.occurredAt, input.now)) return { action: 'hold', reason: 'too_late' }
  if (!input.contactId) return { action: 'hold', reason: 'missing_contact' }
  const who = customerAgreement(input, input.contact, input.defaultPhoneCountry)
  if (who === 'missing') return { action: 'hold', reason: 'missing_identity' }
  if (who === 'mismatch') return { action: 'hold', reason: 'customer_mismatch' }
  const currency = input.currency?.trim().toUpperCase() ?? ''
  if (input.amountMinor == null || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0 || currency === '') {
    return { action: 'hold', reason: 'missing_amount' }
  }
  const matches = pricedBookings(input.bookings, input.amountMinor, currency)
  if (matches.length > 1) return { action: 'hold', reason: 'ambiguous_booking' }
  if (matches.length === 0) return { action: 'hold', reason: holdForUnmatched(input.bookings) }
  const booking = matches[0]
  const price = booking.price
  if (!price) return { action: 'hold', reason: 'missing_price' }
  if (input.usedBookingIds.has(booking.id) || input.approvedSameAmount) {
    return { action: 'hold', reason: 'duplicate_booking' }
  }
  return { action: 'send', bookingId: booking.id, tourId: booking.tourId, departureId: booking.departureId, price }
}
