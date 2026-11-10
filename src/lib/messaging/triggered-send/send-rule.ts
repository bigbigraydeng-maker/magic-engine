/**
 * The "real send" block of a rule snapshot (`rule.send`): everything the PM authorizes on top of the rehearsal rule —
 * who the letter comes from, where replies go, which template, the quiet hours, and the sender's own stop lines.
 *
 * Optional in `parseRule`, so rehearsal proposals written before it existed stay valid (their fingerprint does not
 * change: an absent block is not written as a key). Required by `parseSendRule`: an authorization is only ever written
 * for a proposal that carries it. Strict like the rest of the rule: a missing key or a bad value makes it invalid, with
 * no fall-back to a default.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3 (plan: §17).
 */

import { isAutomatedTemplateKey } from '@/lib/crm/email-templates/automated-template-key'

export interface SendRuleBlock {
  identity: {
    /** 'Display Name <local@domain>' or 'local@domain' (lower-case address). */
    from: string
    /** Lower-case address the guest's reply goes to. */
    reply_to: string
  }
  /** The 127 template the letter is rendered from. Must be an automated (`auto-`) template. */
  template: { key: string }
  /** Local hours (rule time zone) outside which nothing is sent. `HH:MM`, start before end. */
  quiet_hours: { start: string; end: string }
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

export type SendBlockParse = { ok: true; send: SendRuleBlock } | { ok: false; error: string }

const SEND_KEYS = ['identity', 'template', 'quiet_hours', 'health_breaker']
const IDENTITY_KEYS = ['from', 'reply_to']
const TEMPLATE_KEYS = ['key']
const QUIET_KEYS = ['start', 'end']
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

function parseQuietHours(raw: unknown): SendRuleBlock['quiet_hours'] | string {
  if (!isPlainObject(raw)) return 'send.quiet_hours must be a plain object'
  const err = exactKeys(raw, QUIET_KEYS, 'send.quiet_hours')
  if (err) return err
  if (typeof raw.start !== 'string' || typeof raw.end !== 'string') return 'send.quiet_hours.start and end must be HH:MM'
  const start = minutesOf(raw.start)
  const end = minutesOf(raw.end)
  if (start < 0 || end < 0) return 'send.quiet_hours.start and end must be HH:MM'
  if (start >= end) return 'send.quiet_hours.start must be before end'
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

export function parseSendBlock(raw: unknown): SendBlockParse {
  if (!isPlainObject(raw)) return { ok: false, error: 'send must be a plain object' }
  const err = exactKeys(raw, SEND_KEYS, 'send')
  if (err) return { ok: false, error: err }
  const identity = parseIdentity(raw.identity)
  if (typeof identity === 'string') return { ok: false, error: identity }
  const template = parseTemplate(raw.template)
  if (typeof template === 'string') return { ok: false, error: template }
  const quiet = parseQuietHours(raw.quiet_hours)
  if (typeof quiet === 'string') return { ok: false, error: quiet }
  const breaker = parseBreaker(raw.health_breaker)
  if (typeof breaker === 'string') return { ok: false, error: breaker }
  return { ok: true, send: { identity, template, quiet_hours: quiet, health_breaker: breaker } }
}
