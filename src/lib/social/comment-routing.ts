/**
 * Read-time routing for Facebook page comments already stored in
 * `social_comment_engagements`. Does not change auto-reply behaviour — only
 * labels whether a row should surface in PM todos as needing a human reply.
 */
import { foldText, squashText } from '@/lib/messenger/smart-ack/normalize'

export type CommentRoute = 'auto_ok' | 'human'

export type CommentIntent =
  | 'greeting'
  | 'faq_itinerary'
  | 'faq_visa'
  | 'faq_signup'
  | 'price'
  | 'complaint'
  | 'refund'
  | 'booking_change'
  | 'unknown'

export interface CommentRoutingInput {
  category: string | null
  comment_text: string | null
}

export interface CommentRoutingResult {
  route: CommentRoute
  intent: CommentIntent
  guide_to_dm: boolean
}

const REFUND_ASCII = ['refund', 'chargeback', 'money back', 'get my money back']
const REFUND_CJK = ['退款', '退钱', '还钱']

const BOOKING_CHANGE_ASCII = [
  'change booking',
  'change my booking',
  'change date',
  'change dates',
  'reschedule',
  'rebook',
  'move my trip',
  'change tour',
  'swap tour',
]
const BOOKING_CHANGE_CJK = ['改期', '改单', '改团', '换团', '改人数', '改行程', '改出发', '出发日期', '改一下']

const COMPLAINT_ASCII = [
  'complain',
  'complaint',
  'cancel',
  'cancellation',
  'lawyer',
  'legal action',
  'scam',
  'fraud',
  'unacceptable',
  'terrible',
  'disgusting',
  'angry',
  'furious',
  'no reply',
  'no response',
]
const COMPLAINT_CJK = ['投诉', '太差', '愤怒', '骗子', '律师', '取消订单']

const PRICE_ASCII = [
  'price',
  'priced',
  'how much',
  'quotation',
  'quote',
  'cost',
  'fee',
  'rate',
  'per person',
  'pp',
  'discount',
  'deal',
  'deposit',
]
const PRICE_CJK = ['报价', '多少钱', '价格', '费用', '折扣', '优惠', '订金', '押金', '人均']

const FAQ_ITINERARY_ASCII = ['itinerary', 'schedule', 'day trip', 'days tour', 'what included']
const FAQ_ITINERARY_CJK = ['行程', '几晚', '几天', '包含什么', '包括什么', '路线']

const FAQ_VISA_ASCII = ['visa', 'immigration', 'entry requirement']
const FAQ_VISA_CJK = ['签证', '入境', '海关']

const FAQ_SIGNUP_ASCII = [
  'how to book',
  'how do i book',
  'how to sign up',
  'how to register',
  'where to book',
  'booking process',
]
const FAQ_SIGNUP_CJK = ['怎么订', '怎么报名', '如何预订', '如何报名', '怎么下单', '在哪订']

const GREETING_ASCII = ['hello', 'hi there', 'good morning', 'good afternoon', 'thanks', 'thank you']
const GREETING_CJK = ['你好', '您好', '谢谢', '感谢', '早上好', '在吗']

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordBoundary(term: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`)
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text)
}

function includesAsciiPhrase(folded: string, squashed: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    if (wordBoundary(phrase).test(folded)) return true
    const compact = phrase.replace(/\s+/g, '')
    if (compact.length >= 4 && squashed.includes(compact)) return true
  }
  return false
}

function includesCjkPhrase(folded: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    if (folded.includes(phrase)) return true
  }
  return false
}

function isMostlyEmojiOrEmpty(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return true
  return !hasLetter(trimmed)
}

/** Keyword routing for one comment row (pure, no DB writes). */
export function routeComment(input: CommentRoutingInput): CommentRoutingResult {
  const raw = input.comment_text ?? ''
  if (isMostlyEmojiOrEmpty(raw)) {
    return { route: 'human', intent: 'unknown', guide_to_dm: false }
  }

  const folded = foldText(raw)
  const squashed = squashText(raw)

  if (
    includesAsciiPhrase(folded, squashed, REFUND_ASCII) ||
    includesCjkPhrase(folded, REFUND_CJK)
  ) {
    return { route: 'human', intent: 'refund', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, squashed, BOOKING_CHANGE_ASCII) ||
    includesCjkPhrase(folded, BOOKING_CHANGE_CJK)
  ) {
    return { route: 'human', intent: 'booking_change', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, squashed, COMPLAINT_ASCII) ||
    includesCjkPhrase(folded, COMPLAINT_CJK) ||
    input.category === 'complaint'
  ) {
    return { route: 'human', intent: 'complaint', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, squashed, PRICE_ASCII) || includesCjkPhrase(folded, PRICE_CJK)) {
    return { route: 'human', intent: 'price', guide_to_dm: true }
  }

  if (
    includesAsciiPhrase(folded, squashed, FAQ_ITINERARY_ASCII) ||
    includesCjkPhrase(folded, FAQ_ITINERARY_CJK)
  ) {
    return { route: 'auto_ok', intent: 'faq_itinerary', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, squashed, FAQ_VISA_ASCII) || includesCjkPhrase(folded, FAQ_VISA_CJK)) {
    return { route: 'auto_ok', intent: 'faq_visa', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, squashed, FAQ_SIGNUP_ASCII) ||
    includesCjkPhrase(folded, FAQ_SIGNUP_CJK)
  ) {
    return { route: 'auto_ok', intent: 'faq_signup', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, squashed, GREETING_ASCII) ||
    includesCjkPhrase(folded, GREETING_CJK)
  ) {
    return { route: 'auto_ok', intent: 'greeting', guide_to_dm: false }
  }

  return { route: 'human', intent: 'unknown', guide_to_dm: false }
}
