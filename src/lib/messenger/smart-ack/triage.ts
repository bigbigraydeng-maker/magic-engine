/**
 * Smart auto-ack triage: decide whether a model may draft the acknowledgement.
 * Pure function, no I/O. See docs/specs/2026-10-22-smart-ack-design-v0.md §9.
 */
import type { TriageReason, TriageResult } from './types'
import { foldText, squashText } from './normalize'

const OPTOUT_ASCII = [
  'stop messaging',
  'stop texting',
  'stop contacting',
  'unsubscribe',
  'remove me',
  'do not contact',
  'dont contact',
  'leave me alone',
  'spam',
]

const OPTOUT_CJK = ['别再发', '不要再发', '退订', '取消订阅', '骚扰']

const COMPLAINT_ASCII = [
  'complain',
  'complaint',
  'refund',
  'cancel',
  'cancellation',
  'chargeback',
  'lawyer',
  'legal action',
  'solicitor',
  'ombudsman',
  'scam',
  'fraud',
  'suing',
  'sue you',
  'take legal',
  'court',
  'ignored',
  'no reply',
  'no response',
  'hospital',
  'emergency',
  'urgent',
  'died',
  'death',
  'funeral',
  'unacceptable',
  'terrible',
  'disgusting',
  'angry',
  'furious',
]

const COMPLAINT_CJK = [
  '投诉',
  '退款',
  '取消',
  '退钱',
  '律师',
  '骗',
  '紧急',
  '住院',
  '去世',
  '太差',
  '愤怒',
]

const PROMISE_WORDS = [
  'promised',
  'promise',
  'discount',
  'free',
  'deal',
  'quote',
  'quoted',
  'price',
  'priced',
  'how much',
  'quotation',
  'discounted',
  'refundable',
  'deposit',
  'you said',
  'as agreed',
  'agreed price',
]

const PROMISE_CJK = ['报价', '折扣', '优惠', '多少钱', '答应', '承诺', '订金', '押金']

// Well-known URL shorteners and obvious spam hosts. A hit here always blocks.
const SHORTENER_PATTERN =
  /\b(?:bit\.ly|bitly\.com|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|is\.gd|cutt\.ly|rb\.gy|shorturl\.at|rebrand\.ly|lnkd\.in)\b/i

// An email address (name.surname+tag@host.tld) is not a link.
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

// Real URLs: scheme, leading www., or a bare host with a known TLD.
// 两份同样的式子：带 g 的只用于 replace。`.test()` 绝不能用带 g 的正则——
// 它会记住上次匹配到哪（lastIndex），同一个输入连着问两次会一次真一次假。
const URL_SOURCE =
  'https?:\\/\\/\\S+|www\\.\\S+|\\b[a-z0-9-]+\\.(?:com|net|org|io|co|nz|au|me|info|xyz|top|shop|site|online)\\b'
const URL_PATTERN = new RegExp(URL_SOURCE, 'i')
const URL_PATTERN_ALL = new RegExp(URL_SOURCE, 'gi')

const NON_ASCII_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}]/u

// Positive English signal: at least two distinct stopwords must appear as
// whole words. Latin script is not the same as English — Spanish and French
// messages use Latin letters but almost none of these words.
//
// Known trade-off: a very short English message like "Hi" is already caught
// earlier by triage_too_short, and a terse English message with fewer than
// two stopwords falls back to the fixed template — that is the safe direction.
const ENGLISH_STOPWORDS: readonly string[] = [
  'the', 'and', 'you', 'your', 'we', 'our', 'us', 'for', 'with', 'is', 'are',
  'was', 'be', 'to', 'of', 'in', 'on', 'at', 'a', 'an', 'i', 'my', 'me',
  'would', 'like', 'want', 'please', 'about', 'have', 'has', 'can', 'could',
  'will', 'do', 'does', 'need', 'looking', 'interested', 'information', 'info',
  'trip', 'tour', 'travel', 'holiday', 'thanks', 'thank', 'hello', 'hi',
]

const ENGLISH_STOPWORD_PATTERNS: RegExp[] = ENGLISH_STOPWORDS.map(
  (w) => new RegExp(`\\b${escapeRegExp(w)}\\b`),
)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordBoundary(term: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`)
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text)
}

function joinRecent(messages: string[]): string {
  const nonEmpty = messages.map((m) => m.trim()).filter((m) => m.length > 0)
  return nonEmpty.slice(-3).join(' ')
}

function isOptout(folded: string, squashed: string): boolean {
  for (const phrase of OPTOUT_ASCII) {
    if (folded.includes(phrase)) return true
    if (squashed.includes(phrase.replace(/\s+/g, ''))) return true
  }
  for (const phrase of OPTOUT_CJK) {
    if (folded.includes(phrase)) return true
  }
  return false
}

function isComplaint(folded: string, squashed: string): boolean {
  for (const term of COMPLAINT_ASCII) {
    if (wordBoundary(term).test(folded)) return true
    if (term.replace(/\s+/g, '').length >= 5) {
      if (squashed.includes(term.replace(/\s+/g, ''))) return true
    }
  }
  for (const term of COMPLAINT_CJK) {
    if (folded.includes(term)) return true
  }
  return false
}

function isPromiseMaterial(folded: string): boolean {
  for (const w of PROMISE_WORDS) {
    if (wordBoundary(w).test(folded)) return true
  }
  for (const term of PROMISE_CJK) {
    if (folded.includes(term)) return true
  }
  return false
}

// Block only link spam: an email address in a form dump is not a link, and a
// link surrounded by real prose is not spam. Shorteners always block.
function isLinkSpam(folded: string): boolean {
  if (SHORTENER_PATTERN.test(folded)) return true
  const withoutEmails = folded.replace(EMAIL_PATTERN, ' ')
  if (!URL_PATTERN.test(withoutEmails)) return false
  const withoutUrls = withoutEmails.replace(URL_PATTERN_ALL, ' ')
  const letters = withoutUrls.match(/\p{L}/gu)
  return (letters ? letters.length : 0) < 40
}

function isNonEnglish(raw: string, folded: string): boolean {
  if (NON_ASCII_SCRIPT.test(raw)) return true
  const letters = raw.match(/\p{L}/gu)
  if (letters && letters.length > 0) {
    let nonAscii = 0
    for (const ch of letters) {
      if (ch.charCodeAt(0) > 0x7f) nonAscii += 1
    }
    if (nonAscii / letters.length > 0.3) return true
  }
  // Positive English test: require at least two distinct stopwords.
  let hits = 0
  for (const re of ENGLISH_STOPWORD_PATTERNS) {
    if (re.test(folded)) {
      hits += 1
      if (hits >= 2) return false
    }
  }
  return true
}

export function triageMessages(messages: string[]): TriageResult {
  const joined = joinRecent(messages)
  const folded = foldText(joined)
  const squashed = squashText(joined)

  if (joined.length === 0 || !hasLetter(joined)) {
    return { useModel: false, reason: 'triage_no_text' }
  }
  if (isOptout(folded, squashed)) {
    return { useModel: false, reason: 'triage_optout' }
  }
  if (isComplaint(folded, squashed)) {
    return { useModel: false, reason: 'triage_complaint' }
  }
  if (isPromiseMaterial(folded)) {
    return { useModel: false, reason: 'triage_promise' }
  }
  if (isLinkSpam(folded)) {
    return { useModel: false, reason: 'triage_link_only' }
  }
  if (squashed.length < 3) {
    return { useModel: false, reason: 'triage_too_short' }
  }
  if (isNonEnglish(joined, folded)) {
    return { useModel: false, reason: 'triage_non_english' }
  }
  return { useModel: true }
}
