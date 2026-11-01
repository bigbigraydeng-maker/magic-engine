/**
 * Read-time routing for Facebook page comments already stored in
 * `social_comment_engagements`. Does not change auto-reply behaviour — only
 * labels intent for PM todo copy. Rows with `needs_human=true` that look
 * "auto_ok" here are upgraded to `unknown` in comment-human-items.ts.
 */
import { foldText } from '@/lib/messenger/smart-ack/normalize'

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
  needs_human?: boolean | null
}

export interface CommentRoutingResult {
  route: CommentRoute
  intent: CommentIntent
  guide_to_dm: boolean
}

const REFUND_ASCII = [
  'refund',
  'chargeback',
  'money back',
  'get my money back',
  'want to cancel',
  'need to cancel',
  'like to cancel',
  'cancel my',
  'cancel the',
  'cancel this',
  'cancel our',
  'cancellation',
]
const REFUND_CJK = ['退款', '退钱', '还钱', '退团', '退订', '取消']

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
  'rip off',
  'ripoff',
  'waste of money',
  'not happy',
  'disappointed',
  'worst',
]
const COMPLAINT_CJK = [
  '投诉',
  '太差',
  '很差',
  '态度差',
  '愤怒',
  '骗子',
  '律师',
  '差评',
  '失望',
  '不满意',
  '赔偿',
  '垃圾',
]

const PRICE_ASCII = [
  'price',
  'pricing',
  'priced',
  'how much',
  'quotation',
  'quote',
  'fee',
  'per person',
  'pp',
  'discount',
  'deposit',
  'charge',
  'charged',
  'overcharged',
  'cheap',
  'expensive',
  'payment',
]
const PRICE_CJK = ['报价', '多少钱', '价格', '价钱', '费用', '收费', '团费', '怎么收', '折扣', '优惠', '订金', '押金', '人均']

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
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text)
}

/** English keyword hits use whole-word / phrase boundaries only (no squashed substring). */
function includesAsciiPhrase(folded: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    if (wordBoundary(phrase).test(folded)) return true
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

  if (includesAsciiPhrase(folded, REFUND_ASCII) || includesCjkPhrase(folded, REFUND_CJK)) {
    return { route: 'human', intent: 'refund', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, BOOKING_CHANGE_ASCII) ||
    includesCjkPhrase(folded, BOOKING_CHANGE_CJK)
  ) {
    return { route: 'human', intent: 'booking_change', guide_to_dm: false }
  }

  if (
    includesAsciiPhrase(folded, COMPLAINT_ASCII) ||
    includesCjkPhrase(folded, COMPLAINT_CJK) ||
    input.category === 'complaint'
  ) {
    return { route: 'human', intent: 'complaint', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, PRICE_ASCII) || includesCjkPhrase(folded, PRICE_CJK)) {
    return { route: 'human', intent: 'price', guide_to_dm: true }
  }

  if (includesAsciiPhrase(folded, FAQ_ITINERARY_ASCII) || includesCjkPhrase(folded, FAQ_ITINERARY_CJK)) {
    return { route: 'auto_ok', intent: 'faq_itinerary', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, FAQ_VISA_ASCII) || includesCjkPhrase(folded, FAQ_VISA_CJK)) {
    return { route: 'auto_ok', intent: 'faq_visa', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, FAQ_SIGNUP_ASCII) || includesCjkPhrase(folded, FAQ_SIGNUP_CJK)) {
    return { route: 'auto_ok', intent: 'faq_signup', guide_to_dm: false }
  }

  if (includesAsciiPhrase(folded, GREETING_ASCII) || includesCjkPhrase(folded, GREETING_CJK)) {
    return { route: 'auto_ok', intent: 'greeting', guide_to_dm: false }
  }

  return { route: 'human', intent: 'unknown', guide_to_dm: false }
}

/** Intent bucket for PM todo when the row is already flagged needs_human in DB. */
export function intentForNeedsHumanRow(
  row: Pick<CommentRoutingInput, 'category' | 'comment_text' | 'needs_human'>,
): CommentIntent {
  const routing = routeComment(row)
  if (row.needs_human === true && routing.route === 'auto_ok') return 'unknown'
  if (routing.route === 'human') return routing.intent
  return 'unknown'
}
