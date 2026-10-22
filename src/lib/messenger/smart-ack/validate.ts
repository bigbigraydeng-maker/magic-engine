/**
 * Smart auto-ack reply validator.
 * Pure function: strips the automated notice, then applies ordered checks.
 * Returns the first failure reason, or the cleaned text on success.
 */
import { AUTOMATED_NOTICE, type ValidateResult } from './types'
import { foldText, squashText } from './normalize'

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g
const MIN_LEN = 20
const MAX_LEN = 240

// Letters outside Basic Latin (U+0000–U+007F) and Latin-1 Supplement (U+0080–U+00FF).
const NON_LATIN_LETTER = /[^\u0000-\u00ff]/u

const LINK_OR_CONTACT = [
  /https?:\/\//i,
  /\bwww\./i,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b[a-z0-9-]+\.(com|net|org|io|co|nz|au|ly|me)\b/i,
  /\+?[\d][\d\s\-()]{4,}\d/,
]

const CURRENCY = /[$€£¥]/
const DIGIT = /\d/

const NUMBER_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand',
  'million', 'dozen', 'couple of',
]

const ALLOWED_NUMBER_PHRASES = [
  'one of our team',
  'one of our consultants',
  'one of our advisors',
]

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]

const IDENTITY_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bi am a bot\b/i,
  /\bi'm a bot\b/i,
  /\bi'm a human\b/i,
  /\bi am human\b/i,
  /\breal person\b/i,
  /\bmy name is\b/i,
  /\bthis is [A-Z][a-z]+ from\b/,
  /\bi personally\b/i,
  /\bi promise\b/i,
  /\bi guarantee\b/i,
  /\bwe promise\b/i,
  /\bwe guarantee\b/i,
]

// Case-sensitive self-naming: "I'm Sarah" / "I’m Sarah".
const SELF_NAME = /\b[Ii](?:'|’)?m\s+[A-Z][a-z]+/

const FORBIDDEN_TERMS = [
  'confirmed', 'confirm', 'approved', 'approve', 'free', 'complimentary',
  'upgrade', 'upgraded', 'included', 'include', 'waive', 'waived', 'refund',
  'refunded', 'cancel', 'cancelled', 'canceled', 'cancellation', 'guarantee',
  'guaranteed', 'discount', 'discounted', 'deposit', 'payment', 'pay', 'paid',
  'invoice', 'receipt', 'price', 'prices', 'pricing', 'priced', 'cost', 'costs',
  'quote', 'quoted', 'fee', 'fees', 'rate', 'rates', 'cheap', 'cheaper', 'offer',
  'offers', 'special', 'deal', 'deals', 'book', 'booked', 'booking', 'bookings',
  'reserve', 'reserved', 'reservation', 'available', 'availability', 'vacancy',
  'vacancies', 'seats', 'spots', 'sold out', 'visa', 'itinerary', 'flights',
  'flight', 'we will arrange', 'we will send', 'we will call', "we'll arrange",
  "we'll send", "we'll call", 'we will email', "we'll email", 'we will confirm',
  "we'll confirm", 'definitely', 'certainly will', 'no problem at all',
]

const FORBIDDEN_WORD_BOUNDARY = FORBIDDEN_TERMS.map(
  (t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i'),
)
const FORBIDDEN_SQUASH = FORBIDDEN_TERMS
  .filter((t) => t.replace(/[^a-z]/g, '').length >= 5)
  .map((t) => t.replace(/[^a-z]/g, ''))

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripNotice(reply: string): string {
  return reply.split(AUTOMATED_NOTICE).join('').trim()
}

function hasNonLatinLetter(text: string): boolean {
  for (const ch of text) {
    if (NON_LATIN_LETTER.test(ch) && /\p{L}/u.test(ch)) return true
  }
  return false
}

function hasLinkOrContact(text: string): boolean {
  return LINK_OR_CONTACT.some((re) => re.test(text))
}

function hasNumber(text: string): boolean {
  if (DIGIT.test(text) || CURRENCY.test(text)) return true
  let stripped = text.toLowerCase()
  for (const phrase of ALLOWED_NUMBER_PHRASES) {
    stripped = stripped.split(phrase).join(' ')
  }
  for (const w of NUMBER_WORDS) {
    if (new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(stripped)) return true
  }
  for (const m of MONTHS) {
    if (m === 'may') {
      if (/\b(?:in|next|this)\s+may\b/i.test(stripped)) return true
      continue
    }
    if (new RegExp(`\\b${m}\\b`, 'i').test(stripped)) return true
  }
  return false
}

function hasIdentity(text: string): boolean {
  if (SELF_NAME.test(text)) return true
  return IDENTITY_PATTERNS.some((re) => re.test(text))
}

function hasForbidden(text: string): boolean {
  const folded = foldText(text)
  if (FORBIDDEN_WORD_BOUNDARY.some((re) => re.test(folded))) return true
  const squashed = squashText(text)
  return FORBIDDEN_SQUASH.some((t) => squashed.includes(t))
}

function words(text: string): string[] {
  return foldText(text).split(' ').filter((w) => w.length > 0)
}

function hasEcho(reply: string, customerMessages: string[]): boolean {
  const replyWords = words(reply)
  if (replyWords.length < 6) return false
  const replyJoined = ` ${replyWords.join(' ')} `
  for (const msg of customerMessages) {
    const cw = words(msg)
    if (cw.length < 6) continue
    for (let i = 0; i + 6 <= cw.length; i++) {
      const run = ` ${cw.slice(i, i + 6).join(' ')} `
      if (replyJoined.includes(run)) return true
    }
  }
  return false
}

export function validateSmartAck(
  reply: string,
  customerMessages: string[],
): ValidateResult {
  const text = stripNotice(reply).normalize('NFKC').replace(ZERO_WIDTH, '')

  if (text.length === 0) return { ok: false, reason: 'validate_empty' }
  if (text.length < MIN_LEN || text.length > MAX_LEN) {
    return { ok: false, reason: 'validate_length' }
  }
  if (hasNonLatinLetter(text)) return { ok: false, reason: 'validate_language' }
  if (hasLinkOrContact(text)) return { ok: false, reason: 'validate_link_contact' }
  if (hasNumber(text)) return { ok: false, reason: 'validate_number' }
  if (hasIdentity(text)) return { ok: false, reason: 'validate_identity' }
  if (hasForbidden(text)) return { ok: false, reason: 'validate_forbidden' }
  if (hasEcho(text, customerMessages)) return { ok: false, reason: 'validate_echo' }

  return { ok: true, text }
}
