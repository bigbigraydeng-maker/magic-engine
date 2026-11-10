import { createHash } from 'node:crypto'
import { parseSendBlock, type SendRuleBlock } from './send-rule'

export type { SendRuleBlock }

export const GATE_CONTRACT_VERSION = 1
// Only sources whose lead-form touchpoints are known to exist. A source for hand-made test contacts is added with the
// controlled-trial batch, once the exact name the CRM writes for them has been verified.
export const ALLOWED_AUDIENCE_SOURCES = ['meta_lead_form'] as const

export interface TriggeredSendRule {
  gate_contract_version: number
  audience: { sources: string[]; max_age_days: number; min_age: 'previous_local_day' }
  schedule: { timezone: string }
  frequency_cap: { max: number; window_days: number }
  consent: { accepted_bases: string[] }
  /** The old daily batch: how to recognise its campaigns, and the member tags it skips (ME honours the same tags). */
  legacy: { mailchimp_campaign_title_prefix: string; excluded_tags: string[] }
  human_mail: { required_mailboxes: string[] }
  recipient_allowlist: string[] | null
  /** The real-send block (identity, template, quiet hours, stop lines). Absent on rehearsal-only proposals. */
  send?: SendRuleBlock
}

/** A rule that may be authorized for real sending: the send block is there. */
export type SendableRule = TriggeredSendRule & { send: SendRuleBlock }

export type RuleParseResult = { ok: true; rule: TriggeredSendRule } | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TOP_KEYS = [
  'gate_contract_version',
  'audience',
  'schedule',
  'frequency_cap',
  'consent',
  'legacy',
  'human_mail',
  'recipient_allowlist',
] as const

const AUDIENCE_KEYS = ['sources', 'max_age_days', 'min_age'] as const
const SCHEDULE_KEYS = ['timezone'] as const
const FREQUENCY_CAP_KEYS = ['max', 'window_days'] as const
const CONSENT_KEYS = ['accepted_bases'] as const
const LEGACY_KEYS = ['mailchimp_campaign_title_prefix', 'excluded_tags'] as const
const HUMAN_MAIL_KEYS = ['required_mailboxes'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function checkExactKeys(
  obj: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): string | null {
  const actual = Object.keys(obj)
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      return `${path ? path + '.' : ''}${key} is required`
    }
  }
  for (const key of actual) {
    if (!expected.includes(key)) {
      return `${path ? path + '.' : ''}${key} is not allowed`
    }
  }
  return null
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isLowerCaseEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value) && value === value.toLowerCase()
}

function isUniqueStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return false
    if (seen.has(item)) return false
    seen.add(item)
  }
  return true
}

function isUniqueEmailArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (!isLowerCaseEmail(item)) return false
    if (seen.has(item)) return false
    seen.add(item)
  }
  return true
}

function fail(error: string): RuleParseResult {
  return { ok: false, error }
}

export function parseRule(input: unknown): RuleParseResult {
  try {
    if (!isPlainObject(input)) {
      return fail('rule must be a plain object')
    }

    // `send` is the one optional top-level key: rehearsal proposals do not carry it.
    const { send: sendRaw, ...required } = input
    const topErr = checkExactKeys(required, TOP_KEYS, '')
    if (topErr) return fail(topErr)

    // gate_contract_version
    const gateVersion = input.gate_contract_version
    if (!isIntegerInRange(gateVersion, 1, Number.MAX_SAFE_INTEGER)) {
      return fail('gate_contract_version must be an integer >= 1')
    }

    // audience
    const audienceRaw = input.audience
    if (!isPlainObject(audienceRaw)) {
      return fail('audience must be a plain object')
    }
    const audienceErr = checkExactKeys(audienceRaw, AUDIENCE_KEYS, 'audience')
    if (audienceErr) return fail(audienceErr)

    const sourcesRaw = audienceRaw.sources
    if (!Array.isArray(sourcesRaw) || sourcesRaw.length === 0) {
      return fail('audience.sources must be a non-empty array')
    }
    if (!isUniqueStringArray(sourcesRaw)) {
      return fail('audience.sources must contain unique strings')
    }
    for (const source of sourcesRaw) {
      if (!(ALLOWED_AUDIENCE_SOURCES as readonly string[]).includes(source)) {
        return fail(`audience.sources contains unknown source: ${source}`)
      }
    }

    const maxAgeDays = audienceRaw.max_age_days
    if (!isIntegerInRange(maxAgeDays, 1, 14)) {
      return fail('audience.max_age_days must be an integer between 1 and 14')
    }

    if (audienceRaw.min_age !== 'previous_local_day') {
      return fail("audience.min_age must be 'previous_local_day'")
    }

    // schedule
    const scheduleRaw = input.schedule
    if (!isPlainObject(scheduleRaw)) {
      return fail('schedule must be a plain object')
    }
    const scheduleErr = checkExactKeys(scheduleRaw, SCHEDULE_KEYS, 'schedule')
    if (scheduleErr) return fail(scheduleErr)

    const timezone = scheduleRaw.timezone
    if (typeof timezone !== 'string') {
      return fail('schedule.timezone must be a string')
    }
    const supportedZones = Intl.supportedValuesOf('timeZone')
    if (!supportedZones.includes(timezone)) {
      return fail(`schedule.timezone is not a supported IANA time zone: ${timezone}`)
    }

    // frequency_cap
    const freqRaw = input.frequency_cap
    if (!isPlainObject(freqRaw)) {
      return fail('frequency_cap must be a plain object')
    }
    const freqErr = checkExactKeys(freqRaw, FREQUENCY_CAP_KEYS, 'frequency_cap')
    if (freqErr) return fail(freqErr)

    const freqMax = freqRaw.max
    if (!isIntegerInRange(freqMax, 1, 5)) {
      return fail('frequency_cap.max must be an integer between 1 and 5')
    }
    const windowDays = freqRaw.window_days
    if (!isIntegerInRange(windowDays, 1, 30)) {
      return fail('frequency_cap.window_days must be an integer between 1 and 30')
    }

    // consent
    const consentRaw = input.consent
    if (!isPlainObject(consentRaw)) {
      return fail('consent must be a plain object')
    }
    const consentErr = checkExactKeys(consentRaw, CONSENT_KEYS, 'consent')
    if (consentErr) return fail(consentErr)

    const basesRaw = consentRaw.accepted_bases
    if (!Array.isArray(basesRaw) || basesRaw.length === 0) {
      return fail('consent.accepted_bases must be a non-empty array')
    }
    if (!isUniqueStringArray(basesRaw)) {
      return fail('consent.accepted_bases must contain unique strings')
    }
    for (const base of basesRaw) {
      if (!isNonEmptyString(base)) {
        return fail('consent.accepted_bases entries must be non-empty strings')
      }
      if (base.length > 80) {
        return fail('consent.accepted_bases entries must be at most 80 characters')
      }
    }

    // legacy
    const legacyRaw = input.legacy
    if (!isPlainObject(legacyRaw)) {
      return fail('legacy must be a plain object')
    }
    const legacyErr = checkExactKeys(legacyRaw, LEGACY_KEYS, 'legacy')
    if (legacyErr) return fail(legacyErr)

    const prefix = legacyRaw.mailchimp_campaign_title_prefix
    if (!isNonEmptyString(prefix)) {
      return fail('legacy.mailchimp_campaign_title_prefix must be a non-empty string')
    }
    if (prefix.length > 80) {
      return fail('legacy.mailchimp_campaign_title_prefix must be at most 80 characters')
    }

    // Member tags the old batch skips. Compared ignoring case, so the list itself must not repeat a tag in another case.
    const tagsRaw = legacyRaw.excluded_tags
    if (!Array.isArray(tagsRaw)) {
      return fail('legacy.excluded_tags must be an array')
    }
    if (tagsRaw.length > 20) {
      return fail('legacy.excluded_tags must have at most 20 entries')
    }
    for (const tag of tagsRaw) {
      if (!isNonEmptyString(tag) || tag !== tag.trim()) {
        return fail('legacy.excluded_tags entries must be non-empty strings without surrounding spaces')
      }
      if (tag.length > 80) {
        return fail('legacy.excluded_tags entries must be at most 80 characters')
      }
    }
    if (new Set(tagsRaw.map((tag: string) => tag.toLowerCase())).size !== tagsRaw.length) {
      return fail('legacy.excluded_tags must contain unique tags (ignoring case)')
    }

    // human_mail
    const humanMailRaw = input.human_mail
    if (!isPlainObject(humanMailRaw)) {
      return fail('human_mail must be a plain object')
    }
    const humanMailErr = checkExactKeys(humanMailRaw, HUMAN_MAIL_KEYS, 'human_mail')
    if (humanMailErr) return fail(humanMailErr)

    const mailboxesRaw = humanMailRaw.required_mailboxes
    if (!Array.isArray(mailboxesRaw) || mailboxesRaw.length === 0) {
      return fail('human_mail.required_mailboxes must be a non-empty array')
    }
    if (!isUniqueEmailArray(mailboxesRaw)) {
      return fail('human_mail.required_mailboxes must contain unique lower-case e-mail addresses')
    }

    // recipient_allowlist
    const allowlistRaw = input.recipient_allowlist
    let allowlist: string[] | null
    if (allowlistRaw === null) {
      allowlist = null
    } else {
      if (!Array.isArray(allowlistRaw) || allowlistRaw.length === 0) {
        return fail('recipient_allowlist must be null or a non-empty array')
      }
      if (!isUniqueEmailArray(allowlistRaw)) {
        return fail('recipient_allowlist must contain unique lower-case e-mail addresses')
      }
      allowlist = allowlistRaw.slice()
    }

    // The e-mail evidence window must reach back at least as far as a lead can be old, else a human e-mail sent
    // before the window opens would be missed and the lead judged "nobody wrote yet".
    if (windowDays < maxAgeDays) {
      return fail('frequency_cap.window_days must be at least audience.max_age_days')
    }

    const rule: TriggeredSendRule = {
      gate_contract_version: gateVersion,
      audience: {
        sources: sourcesRaw.slice(),
        max_age_days: maxAgeDays,
        min_age: 'previous_local_day',
      },
      schedule: { timezone },
      frequency_cap: { max: freqMax, window_days: windowDays },
      consent: { accepted_bases: basesRaw.slice() },
      legacy: { mailchimp_campaign_title_prefix: prefix, excluded_tags: tagsRaw.slice() },
      human_mail: { required_mailboxes: mailboxesRaw.slice() },
      recipient_allowlist: allowlist,
    }

    // Absent stays absent (never written as `undefined`): a rehearsal proposal keeps its fingerprint.
    if (Object.prototype.hasOwnProperty.call(input, 'send')) {
      const send = parseSendBlock(sendRaw)
      if (!send.ok) return fail(send.error)
      rule.send = send.send
    }

    return { ok: true, rule }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return fail(`rule could not be parsed: ${message}`)
  }
}

function encode(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'string') return JSON.stringify(value)
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalJson: non-finite number is not allowed')
    }
    return JSON.stringify(value)
  }
  if (t === 'undefined') throw new Error('canonicalJson: undefined is not allowed')
  if (t === 'function') throw new Error('canonicalJson: function is not allowed')
  if (t === 'symbol') throw new Error('canonicalJson: symbol is not allowed')
  if (t === 'bigint') throw new Error('canonicalJson: bigint is not allowed')
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      parts.push(encode(item))
    }
    return '[' + parts.join(',') + ']'
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (const key of keys) {
      parts.push(JSON.stringify(key) + ':' + encode(value[key]))
    }
    return '{' + parts.join(',') + '}'
  }
  throw new Error('canonicalJson: only plain objects, arrays and JSON primitives are allowed')
}

/** A rule that may be authorized for real sending: valid, and carrying its send block. */
export function parseSendRule(input: unknown): { ok: true; rule: SendableRule } | { ok: false; error: string } {
  const parsed = parseRule(input)
  if (!parsed.ok) return parsed
  const { send } = parsed.rule
  if (send === undefined) return { ok: false, error: 'send is required for a rule that may be authorized' }
  return { ok: true, rule: { ...parsed.rule, send } }
}

export function canonicalJson(value: unknown): string {
  return encode(value)
}

export function ruleSha256(rule: TriggeredSendRule): string {
  return createHash('sha256').update(canonicalJson(rule), 'utf8').digest('hex')
}
