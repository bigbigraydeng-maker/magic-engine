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
  'sue',
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

const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'twenty',
  'thirty',
  'hundred',
  'thousand',
  'million',
]

const MONTH_WORDS = [
  'january',
  'february',
  'march',
  'april',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
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
]

const CJK_NUMERALS = /[一二三四五六七八九十百千万月号]/

const LINK_PATTERN =
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|nz|au|ly|me)\b/

const NON_ASCII_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}]/u

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

function hasMayAsMonth(folded: string): boolean {
  const re = /\bmay\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(folded)) !== null) {
    const after = folded.slice(match.index + match[0].length)
    const before = folded.slice(0, match.index)
    if (/^\s*\d/.test(after)) return true
    if (/\b(in|next|this|early|late|mid)\s+$/.test(before)) return true
  }
  return false
}

function isNumbers(folded: string, raw: string): boolean {
  if (/\d/.test(folded)) return true
  if (/[$£€¥₹]/.test(folded)) return true
  for (const w of NUMBER_WORDS) {
    if (wordBoundary(w).test(folded)) return true
  }
  for (const w of MONTH_WORDS) {
    if (wordBoundary(w).test(folded)) return true
  }
  if (hasMayAsMonth(folded)) return true
  for (const w of PROMISE_WORDS) {
    if (wordBoundary(w).test(folded)) return true
  }
  if (CJK_NUMERALS.test(raw)) return true
  return false
}

function isLinkOnly(folded: string): boolean {
  return LINK_PATTERN.test(folded)
}

function isNonEnglish(raw: string): boolean {
  if (NON_ASCII_SCRIPT.test(raw)) return true
  const letters = raw.match(/\p{L}/gu)
  if (!letters || letters.length === 0) return false
  let nonAscii = 0
  for (const ch of letters) {
    if (ch.charCodeAt(0) > 0x7f) nonAscii += 1
  }
  return nonAscii / letters.length > 0.3
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
  if (isNumbers(folded, joined)) {
    return { useModel: false, reason: 'triage_numbers' }
  }
  if (isLinkOnly(folded)) {
    return { useModel: false, reason: 'triage_link_only' }
  }
  if (squashed.length < 3) {
    return { useModel: false, reason: 'triage_too_short' }
  }
  if (isNonEnglish(joined)) {
    return { useModel: false, reason: 'triage_non_english' }
  }
  return { useModel: true }
}
