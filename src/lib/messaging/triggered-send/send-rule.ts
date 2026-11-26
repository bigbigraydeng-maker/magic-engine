/**
 * The "real send" block of a rule snapshot (`rule.send`): everything the PM authorizes on top of the rehearsal rule —
 * who the letter comes from, where replies go, which template, the hours it may go out, and the sender's own stop lines.
 *
 * Optional in `parseRule`, so rehearsal proposals written before it existed stay valid (their fingerprint does not
 * change: an absent block is not written as a key). Required by `parseSendRule`: an authorization is only ever written
 * for a proposal that carries it. Strict like the rest of the rule: a missing key or a bad value makes it invalid, with
 * no fall-back to a default.
 * A trigger with several letters (the AI follow-up letters) names `send.letters` instead of `send.template`: one or
 * the other, never both (design 2026-11-17 §4.1, §7.2).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3 (plan: §17).
 */

import { createHash } from 'node:crypto'
import { isAutomatedTemplateKey } from '@/lib/crm/email-templates/automated-template-key'
import { LETTER_KEY_RE } from './trigger-scope'

export interface SendRuleBlock {
  identity: {
    /** 'Display Name <local@domain>' or 'local@domain' (lower-case address). */
    from: string
    /** Lower-case address the guest's reply goes to. */
    reply_to: string
  }
  /** The 127 template the letter is rendered from. Must be an automated (`auto-`) template. */
  template: { key: string }
  /**
   * The hours a letter may go out, `HH:MM`, start before end, in the rule's own time zone (`schedule.timezone`, the
   * client's zone: the design's "recipient local time" (§5.2 G) points at `time-zone.ts`, which is per client, not per
   * guest). Outside it the letter waits (retryable). Named a window, not "quiet hours": it is when sending is allowed.
   */
  send_window: { start: string; end: string }
  /** The sender's own stop lines (§4.3): crossing one revokes the authorization. */
  health_breaker: {
    window_days: number
    bounce_min_sent: number
    bounce_min_count: number
    bounce_rate_pct: number
    complaint_max: number
    provider_reject_streak: number
  }
}

/**
 * One letter of a letter list (a trigger with several letters, each sent to a guest at most once; design 2026-11-17
 * §7.2). The template is pinned: version and content fingerprint as they were when proposed. `context` is frozen with
 * it (the catalogue link the letter may carry): the sender never reads it from anywhere else (W1).
 */
export interface LetterEntry {
  letter_key: string
  template_key: string
  template_version: number
  template_sha256: string
  context: { catalogue_url: string | null; catalogue_valid_until: string | null }
}

/** The send block of a trigger with a list of letters: like `SendRuleBlock`, with `letters` instead of `template`. */
export interface LettersSendBlock {
  identity: SendRuleBlock['identity']
  letters: LetterEntry[]
  send_window: SendRuleBlock['send_window']
  health_breaker: SendRuleBlock['health_breaker']
}

export type SendBlockParse = { ok: true; send: SendRuleBlock | LettersSendBlock } | { ok: false; error: string }

/** At most this many letters in one list (the database does not count them; the rule does). */
export const MAX_LETTERS = 8

const SEND_KEYS = ['identity', 'template', 'send_window', 'health_breaker']
const LETTERS_SEND_KEYS = ['identity', 'letters', 'send_window', 'health_breaker']
const LETTER_KEYS = ['letter_key', 'template_key', 'template_version', 'template_sha256', 'context']
const CONTEXT_KEYS = ['catalogue_url', 'catalogue_valid_until']
const SHA256_RE = /^[0-9a-f]{64}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const IDENTITY_KEYS = ['from', 'reply_to']
const TEMPLATE_KEYS = ['key']
const WINDOW_KEYS = ['start', 'end']
const BREAKER_KEYS = ['window_days', 'bounce_min_sent', 'bounce_min_count', 'bounce_rate_pct', 'complaint_max', 'provider_reject_streak']

const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const ADDRESS_RE = new RegExp(`^[a-z0-9._%+-]{1,64}@${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`)
const NAMED_RE = /^([^<>"\r\n,;]{1,80}) <([^<>\s]+)>$/
const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function exactKeys(obj: Record<string, unknown>, expected: readonly string[], path: string): string | null {
  for (const key of expected) if (!Object.prototype.hasOwnProperty.call(obj, key)) return `${path}.${key} is required`
  for (const key of Object.keys(obj)) if (!expected.includes(key)) return `${path}.${key} is not allowed`
  return null
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && ADDRESS_RE.test(value)
}

/** 'Name <address>' or 'address'; the address part must be lower-case. */
export function fromAddressOf(from: string): string | null {
  const named = NAMED_RE.exec(from)
  const address = named === null ? from : named[2]
  if (named !== null && named[1].trim() !== named[1]) return null
  return isAddress(address) ? address : null
}

function minutesOf(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm)
  return m === null ? -1 : Number(m[1]) * 60 + Number(m[2])
}

function parseIdentity(raw: unknown): SendRuleBlock['identity'] | string {
  if (!isPlainObject(raw)) return 'send.identity must be a plain object'
  const err = exactKeys(raw, IDENTITY_KEYS, 'send.identity')
  if (err) return err
  if (typeof raw.from !== 'string' || fromAddressOf(raw.from) === null) return 'send.identity.from must be "Name <address>" or an address (lower-case)'
  if (!isAddress(raw.reply_to)) return 'send.identity.reply_to must be a lower-case address'
  return { from: raw.from, reply_to: raw.reply_to }
}

function parseTemplate(raw: unknown): SendRuleBlock['template'] | string {
  if (!isPlainObject(raw)) return 'send.template must be a plain object'
  const err = exactKeys(raw, TEMPLATE_KEYS, 'send.template')
  if (err) return err
  if (typeof raw.key !== 'string' || !TEMPLATE_KEY_RE.test(raw.key)) return 'send.template.key is malformed'
  if (!isAutomatedTemplateKey(raw.key)) return 'send.template.key must be an automated (auto-) template'
  return { key: raw.key }
}

function parseSendWindow(raw: unknown): SendRuleBlock['send_window'] | string {
  if (!isPlainObject(raw)) return 'send.send_window must be a plain object'
  const err = exactKeys(raw, WINDOW_KEYS, 'send.send_window')
  if (err) return err
  if (typeof raw.start !== 'string' || typeof raw.end !== 'string') return 'send.send_window.start and end must be HH:MM'
  const start = minutesOf(raw.start)
  const end = minutesOf(raw.end)
  if (start < 0 || end < 0) return 'send.send_window.start and end must be HH:MM'
  if (start >= end) return 'send.send_window.start must be before end'
  return { start: raw.start, end: raw.end }
}

function parseBreaker(raw: unknown): SendRuleBlock['health_breaker'] | string {
  if (!isPlainObject(raw)) return 'send.health_breaker must be a plain object'
  const err = exactKeys(raw, BREAKER_KEYS, 'send.health_breaker')
  if (err) return err
  if (!intIn(raw.window_days, 7, 90)) return 'send.health_breaker.window_days must be 7..90'
  if (!intIn(raw.bounce_min_sent, 10, 10_000)) return 'send.health_breaker.bounce_min_sent must be 10..10000'
  if (!intIn(raw.bounce_min_count, 1, 1_000)) return 'send.health_breaker.bounce_min_count must be 1..1000'
  if (!intIn(raw.bounce_rate_pct, 1, 20)) return 'send.health_breaker.bounce_rate_pct must be 1..20'
  if (!intIn(raw.complaint_max, 1, 10)) return 'send.health_breaker.complaint_max must be 1..10'
  if (!intIn(raw.provider_reject_streak, 1, 10)) return 'send.health_breaker.provider_reject_streak must be 1..10'
  return {
    window_days: raw.window_days,
    bounce_min_sent: raw.bounce_min_sent,
    bounce_min_count: raw.bounce_min_count,
    bounce_rate_pct: raw.bounce_rate_pct,
    complaint_max: raw.complaint_max,
    provider_reject_streak: raw.provider_reject_streak,
  }
}

function parseCatalogueUrl(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'string' || raw.length > 600) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? raw : undefined
  } catch {
    return undefined
  }
}

function isCalendarDay(raw: string): boolean {
  if (!DAY_RE.test(raw)) return false
  const at = new Date(`${raw}T00:00:00.000Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === raw
}

function parseContext(raw: unknown, path: string): LetterEntry['context'] | string {
  if (!isPlainObject(raw)) return `${path} must be a plain object`
  const err = exactKeys(raw, CONTEXT_KEYS, path)
  if (err) return err
  const url = parseCatalogueUrl(raw.catalogue_url)
  if (url === undefined) return `${path}.catalogue_url must be null or an https link`
  const until = raw.catalogue_valid_until
  if (until !== null && (typeof until !== 'string' || !isCalendarDay(until))) return `${path}.catalogue_valid_until must be null or YYYY-MM-DD`
  return { catalogue_url: url, catalogue_valid_until: until }
}

function parseLetter(raw: unknown, i: number): LetterEntry | string {
  const path = `send.letters[${i}]`
  if (!isPlainObject(raw)) return `${path} must be a plain object`
  const err = exactKeys(raw, LETTER_KEYS, path)
  if (err) return err
  if (typeof raw.letter_key !== 'string' || !LETTER_KEY_RE.test(raw.letter_key)) return `${path}.letter_key is malformed`
  if (typeof raw.template_key !== 'string' || !TEMPLATE_KEY_RE.test(raw.template_key)) return `${path}.template_key is malformed`
  if (!isAutomatedTemplateKey(raw.template_key)) return `${path}.template_key must be an automated (auto-) template`
  if (!intIn(raw.template_version, 1, Number.MAX_SAFE_INTEGER)) return `${path}.template_version must be an integer >= 1`
  if (typeof raw.template_sha256 !== 'string' || !SHA256_RE.test(raw.template_sha256)) return `${path}.template_sha256 must be 64 lower-case hex characters`
  const context = parseContext(raw.context, `${path}.context`)
  if (typeof context === 'string') return context
  return { letter_key: raw.letter_key, template_key: raw.template_key, template_version: raw.template_version, template_sha256: raw.template_sha256, context }
}

function parseLetters(raw: unknown): LetterEntry[] | string {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_LETTERS) return `send.letters must hold 1..${MAX_LETTERS} letters`
  const letters: LetterEntry[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i += 1) {
    const letter = parseLetter(raw[i], i)
    if (typeof letter === 'string') return letter
    if (seen.has(letter.letter_key)) return `send.letters has the letter_key ${letter.letter_key} twice`
    seen.add(letter.letter_key)
    letters.push(letter)
  }
  return letters
}

function parseLettersBlock(raw: Record<string, unknown>): SendBlockParse {
  if (Object.prototype.hasOwnProperty.call(raw, 'template')) return { ok: false, error: 'send.template and send.letters are exclusive' }
  const err = exactKeys(raw, LETTERS_SEND_KEYS, 'send')
  if (err) return { ok: false, error: err }
  const identity = parseIdentity(raw.identity)
  if (typeof identity === 'string') return { ok: false, error: identity }
  const letters = parseLetters(raw.letters)
  if (typeof letters === 'string') return { ok: false, error: letters }
  const window = parseSendWindow(raw.send_window)
  if (typeof window === 'string') return { ok: false, error: window }
  const breaker = parseBreaker(raw.health_breaker)
  if (typeof breaker === 'string') return { ok: false, error: breaker }
  return { ok: true, send: { identity, letters, send_window: window, health_breaker: breaker } }
}

export function parseSendBlock(raw: unknown): SendBlockParse {
  if (!isPlainObject(raw)) return { ok: false, error: 'send must be a plain object' }
  if (Object.prototype.hasOwnProperty.call(raw, 'letters')) return parseLettersBlock(raw)
  const err = exactKeys(raw, SEND_KEYS, 'send')
  if (err) return { ok: false, error: err }
  const identity = parseIdentity(raw.identity)
  if (typeof identity === 'string') return { ok: false, error: identity }
  const template = parseTemplate(raw.template)
  if (typeof template === 'string') return { ok: false, error: template }
  const window = parseSendWindow(raw.send_window)
  if (typeof window === 'string') return { ok: false, error: window }
  const breaker = parseBreaker(raw.health_breaker)
  if (typeof breaker === 'string') return { ok: false, error: breaker }
  return { ok: true, send: { identity, template, send_window: window, health_breaker: breaker } }
}

/** A send block with a letter list (and not a single template). */
export function isLettersBlock(send: SendRuleBlock | LettersSendBlock): send is LettersSendBlock {
  return Object.prototype.hasOwnProperty.call(send, 'letters')
}

/**
 * The fingerprint of a letter list, stored as the authorization's `template_sha256` (with `template_version` 1): sha256
 * of the canonical JSON of the letters sorted by key, each with only its key and its pinned template. The list itself
 * lives in the rule (covered by the rule's own fingerprint); this makes a changed template visible in the same column
 * the one-letter authorization uses.
 */
export function lettersFingerprint(letters: readonly LetterEntry[]): string {
  const sorted = [...letters]
    .sort((a, b) => (a.letter_key < b.letter_key ? -1 : a.letter_key > b.letter_key ? 1 : 0))
    .map((l) => `{"letter_key":${JSON.stringify(l.letter_key)},"template_key":${JSON.stringify(l.template_key)},"template_sha256":${JSON.stringify(l.template_sha256)},"template_version":${l.template_version}}`)
  return createHash('sha256').update(`[${sorted.join(',')}]`, 'utf8').digest('hex')
}

/** The template version stored on a letter-list authorization (the list's own fingerprint is the sha). */
export const LETTER_LIST_TEMPLATE_VERSION = 1
