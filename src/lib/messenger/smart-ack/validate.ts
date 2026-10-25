/**
 * Smart auto-ack reply validator.
 * Pure function: strips the automated notice, then applies ordered checks.
 * Returns the first failure reason, or the cleaned text on success.
 */
import { AUTOMATED_NOTICE, type ValidateResult } from './types'
import { foldText, squashText } from './normalize'
import { evaluateClaims } from '@/lib/messenger-agent/verifier/content-claims-gate'

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
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'dozen',
  'couple of',
]

// Harmless staff-reference idiom: "one of our team", "one of the advisers".
const STAFF_REFERENCE = /\bone of (?:our|the) [a-z]+\b/gi

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
  'quote', 'quoted', 'fee', 'fees', 'rate', 'rates', 'cheap', 'cheaper',
  'special offer', 'special offers', 'special deal', 'exclusive offer',
  'deal', 'deals', 'book', 'booked', 'booking', 'bookings',
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

// Short forbidden terms (letters-only length < 5) can be obfuscated with
// separators between letters: "f.r.e.e", "f r e e", "co st". Build one regex
// per term at module load. Each regex requires at least one separator overall
// so ordinary words containing the term as a substring (e.g. "coffee" for
// "fee") are unaffected.
const SEPARATOR_CLASS = '[\\s._\\-*|/\\\\]'
const SEPARATED_SHORT_TERMS: Array<{ re: RegExp; plainLength: number }> = FORBIDDEN_TERMS
  .map((t) => t.replace(/[^a-z]/g, ''))
  .filter((letters) => letters.length > 0 && letters.length < 5)
  .map((letters) => ({
    // Separators are OPTIONAL between each pair, so "co st" (one gap) matches as
    // well as "f.r.e.e" (a gap everywhere). Requiring a gap between EVERY pair
    // would miss "co st"; requiring none would hit "fee" inside "coffee". The
    // "at least one separator" rule is enforced below by comparing lengths.
    re: new RegExp(letters.split('').join(`${SEPARATOR_CLASS}*`), 'gi'),
    plainLength: letters.length,
  }))

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
  const stripped = text.toLowerCase().replace(STAFF_REFERENCE, ' ')
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
  if (FORBIDDEN_SQUASH.some((t) => squashed.includes(t))) return true
  // Separated-letter obfuscation of short terms, on the NFKC-folded text.
  const nfkc = text.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase()
  for (const { re, plainLength } of SEPARATED_SHORT_TERMS) {
    // Fresh lastIndex each time: these are /g regexes, and a shared lastIndex
    // would make the same input answer differently on consecutive calls.
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(nfkc)) !== null) {
      // Longer than the bare word = separators were inserted = obfuscation.
      // Exactly the bare word = an ordinary substring ("fee" inside "coffee"),
      // which the word-boundary pass above already judged.
      if (m[0].length > plainLength) return true
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return false
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

function hasUnverifiedClaim(text: string): boolean {
  try {
    const reason = evaluateClaims({ text, validPrices: new Set<number>(), validDates: new Set<string>() })
    return reason !== null
  } catch {
    return true
  }
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
  if (hasUnverifiedClaim(text)) return { ok: false, reason: 'validate_forbidden' }

  return { ok: true, text }
}
