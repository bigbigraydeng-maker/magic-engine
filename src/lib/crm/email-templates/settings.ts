import { normalizeRecipient } from '@/lib/crm/email-compose/validate'
import type {
  EmailSettings,
  GuardrailRule,
  PublishedToursProviderSettings,
} from './types'

export type ParseSettingsResult =
  | { ok: true; settings: EmailSettings }
  | { ok: false; errors: string[] }

const MAX_ERRORS = 30
const MAX_FOOTER_LENGTH = 500
const MAX_ALLOWLIST = 50
const MAX_HOSTS = 20
const MAX_RULES = 50
const MAX_PHRASES = 50
const MAX_URL_LENGTH = 300

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const RULE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class ErrorSink {
  readonly errors: string[] = []

  add(path: string, message: string): void {
    if (this.errors.length >= MAX_ERRORS) return
    this.errors.push(`${path}: ${message}`)
  }

  get full(): boolean {
    return this.errors.length >= MAX_ERRORS
  }
}

// Returns the keys of `obj` that are not in `allowed`.
function unknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k))
}

// Verifies that `obj` has exactly the allowed keys (no missing, no unknown).
function readExactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  sink: ErrorSink,
): boolean {
  let ok = true
  for (const key of allowed) {
    if (!(key in obj)) {
      sink.add(`${path}.${key}`, 'is required')
      ok = false
    }
  }
  for (const key of unknownKeys(obj, allowed)) {
    sink.add(`${path}.${key}`, 'unknown key')
    ok = false
  }
  return ok
}

function readInt(
  value: unknown,
  min: number,
  max: number,
  path: string,
  sink: ErrorSink,
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    sink.add(path, `must be an integer between ${min} and ${max}`)
    return null
  }
  if (value < min || value > max) {
    sink.add(path, `must be an integer between ${min} and ${max}`)
    return null
  }
  return value
}

function readBoolean(
  value: unknown,
  path: string,
  sink: ErrorSink,
): boolean | null {
  if (typeof value !== 'boolean') {
    sink.add(path, 'must be a boolean')
    return null
  }
  return value
}

function readSendMailbox(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') {
    sink.add(path, 'must be null or a valid email address')
    return undefined
  }
  const normalized = normalizeRecipient(value)
  if (normalized === null) {
    sink.add(path, 'must be null or a valid email address')
    return undefined
  }
  return normalized
}

function readFooter(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') {
    sink.add(path, 'must be null or a non-empty string')
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    sink.add(path, 'must be null or a non-empty string')
    return undefined
  }
  if (trimmed.length > MAX_FOOTER_LENGTH) {
    sink.add(path, `must be at most ${MAX_FOOTER_LENGTH} characters`)
    return undefined
  }
  return trimmed
}

function parseLimits(
  value: unknown,
  path: string,
  sink: ErrorSink,
): EmailSettings['limits'] | null {
  if (!isPlainObject(value)) {
    sink.add(path, 'must be an object')
    return null
  }
  const keys = ['per_user_per_hour', 'per_user_per_day', 'per_mailbox_per_day']
  readExactKeys(value, keys, path, sink)
  const perUserPerHour = readInt(
    value.per_user_per_hour,
    1,
    1000,
    `${path}.per_user_per_hour`,
    sink,
  )
  const perUserPerDay = readInt(
    value.per_user_per_day,
    1,
    1000,
    `${path}.per_user_per_day`,
    sink,
  )
  const perMailboxPerDay = readInt(
    value.per_mailbox_per_day,
    1,
    1000,
    `${path}.per_mailbox_per_day`,
    sink,
  )
  if (
    perUserPerHour === null ||
    perUserPerDay === null ||
    perMailboxPerDay === null
  ) {
    return null
  }
  return { perUserPerHour, perUserPerDay, perMailboxPerDay }
}

function parseFrequencyCap(
  value: unknown,
  path: string,
  sink: ErrorSink,
): EmailSettings['frequencyCap'] | undefined {
  if (value === null) return null
  if (!isPlainObject(value)) {
    sink.add(path, 'must be null or an object')
    return undefined
  }
  readExactKeys(value, ['max', 'window_days'], path, sink)
  const max = readInt(value.max, 1, 20, `${path}.max`, sink)
  const windowDays = readInt(
    value.window_days,
    1,
    60,
    `${path}.window_days`,
    sink,
  )
  if (max === null || windowDays === null) return undefined
  return { max, windowDays }
}

function parseAllowlist(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value)) {
    sink.add(path, 'must be null or an array of email addresses')
    return undefined
  }
  if (value.length > MAX_ALLOWLIST) {
    sink.add(path, `must have at most ${MAX_ALLOWLIST} entries`)
    return undefined
  }
  const seen = new Set<string>()
  const out: string[] = []
  let ok = true
  value.forEach((entry, i) => {
    const normalized = normalizeRecipient(entry)
    if (normalized === null) {
      sink.add(`${path}[${i}]`, 'must be a valid email address')
      ok = false
      return
    }
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  })
  return ok ? out : undefined
}

function parseAllowedHosts(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string[] | null {
  if (!Array.isArray(value)) {
    sink.add(path, 'must be an array of hostnames')
    return null
  }
  if (value.length > MAX_HOSTS) {
    sink.add(path, `must have at most ${MAX_HOSTS} entries`)
    return null
  }
  const seen = new Set<string>()
  const out: string[] = []
  let ok = true
  value.forEach((entry, i) => {
    if (typeof entry !== 'string') {
      sink.add(`${path}[${i}]`, 'must be a hostname string')
      ok = false
      return
    }
    const normalized = entry.trim().toLowerCase()
    if (!HOSTNAME_RE.test(normalized)) {
      sink.add(`${path}[${i}]`, 'must be a bare hostname')
      ok = false
      return
    }
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  })
  return ok ? out : null
}

function parsePhrases(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string[] | null {
  if (!Array.isArray(value)) {
    sink.add(path, 'must be an array of strings')
    return null
  }
  if (value.length < 1 || value.length > MAX_PHRASES) {
    sink.add(path, `must have between 1 and ${MAX_PHRASES} entries`)
    return null
  }
  const seen = new Set<string>()
  const out: string[] = []
  let ok = true
  value.forEach((entry, i) => {
    if (typeof entry !== 'string') {
      sink.add(`${path}[${i}]`, 'must be a string')
      ok = false
      return
    }
    const trimmed = entry.trim()
    if (trimmed.length < 2 || trimmed.length > 80) {
      sink.add(`${path}[${i}]`, 'must be between 2 and 80 characters')
      ok = false
      return
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      sink.add(`${path}[${i}]`, 'duplicate phrase')
      ok = false
      return
    }
    seen.add(key)
    out.push(trimmed)
  })
  return ok ? out : null
}

function parseRule(
  value: unknown,
  path: string,
  sink: ErrorSink,
): GuardrailRule | null {
  if (!isPlainObject(value)) {
    sink.add(path, 'must be an object')
    return null
  }
  readExactKeys(value, ['id', 'phrases', 'message', 'severity'], path, sink)

  let id: string | null = null
  if (typeof value.id !== 'string' || !RULE_ID_RE.test(value.id)) {
    sink.add(`${path}.id`, 'must match /^[a-z0-9][a-z0-9_-]{1,40}$/')
  } else {
    id = value.id
  }

  const phrases = parsePhrases(value.phrases, `${path}.phrases`, sink)

  let message: string | null = null
  if (typeof value.message !== 'string') {
    sink.add(`${path}.message`, 'must be a string')
  } else {
    const trimmed = value.message.trim()
    if (trimmed.length < 1 || trimmed.length > 200) {
      sink.add(`${path}.message`, 'must be between 1 and 200 characters')
    } else {
      message = trimmed
    }
  }

  let severity: GuardrailRule['severity'] | null = null
  if (value.severity === 'block' || value.severity === 'warn') {
    severity = value.severity
  } else {
    sink.add(`${path}.severity`, "must be 'block' or 'warn'")
  }

  if (id === null || phrases === null || message === null || severity === null) {
    return null
  }
  return { id, phrases, message, severity }
}

function parseRules(
  value: unknown,
  path: string,
  sink: ErrorSink,
): GuardrailRule[] | null {
  if (!Array.isArray(value)) {
    sink.add(path, 'must be an array of rules')
    return null
  }
  if (value.length > MAX_RULES) {
    sink.add(path, `must have at most ${MAX_RULES} entries`)
    return null
  }
  const seenIds = new Set<string>()
  const out: GuardrailRule[] = []
  let ok = true
  value.forEach((entry, i) => {
    const rule = parseRule(entry, `${path}[${i}]`, sink)
    if (rule === null) {
      ok = false
      return
    }
    if (seenIds.has(rule.id)) {
      sink.add(`${path}[${i}].id`, 'duplicate rule id')
      ok = false
      return
    }
    seenIds.add(rule.id)
    out.push(rule)
  })
  return ok ? out : null
}

function parseGuardrails(
  value: unknown,
  path: string,
  sink: ErrorSink,
): EmailSettings['guardrails'] | null {
  if (!isPlainObject(value)) {
    sink.add(path, 'must be an object')
    return null
  }
  readExactKeys(value, ['allowed_link_hosts', 'rules'], path, sink)
  const allowedLinkHosts = parseAllowedHosts(
    value.allowed_link_hosts,
    `${path}.allowed_link_hosts`,
    sink,
  )
  const rules = parseRules(value.rules, `${path}.rules`, sink)
  if (allowedLinkHosts === null || rules === null) return null
  return { allowedLinkHosts, rules }
}

function parseUrlPattern(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string | null {
  if (typeof value !== 'string') {
    sink.add(path, 'must be a string')
    return null
  }
  if (value.length > MAX_URL_LENGTH) {
    sink.add(path, `must be at most ${MAX_URL_LENGTH} characters`)
    return null
  }
  if (/\s/.test(value)) {
    sink.add(path, 'must not contain whitespace')
    return null
  }
  if (!value.startsWith('https://')) {
    sink.add(path, 'must start with https://')
    return null
  }
  const host = value.slice('https://'.length).split(/[/?#]/, 1)[0].toLowerCase()
  if (!HOSTNAME_RE.test(host)) {
    sink.add(path, 'host must be a bare hostname (no placeholders, port or userinfo)')
    return null
  }
  for (const token of ['{destination}', '{tier}', '{slug}']) {
    if (!value.includes(token)) {
      sink.add(path, `must contain ${token}`)
      return null
    }
  }
  return value
}

function parseAllToursUrl(
  value: unknown,
  path: string,
  sink: ErrorSink,
): string | null {
  if (typeof value !== 'string') {
    sink.add(path, 'must be a string')
    return null
  }
  if (value.length > MAX_URL_LENGTH) {
    sink.add(path, `must be at most ${MAX_URL_LENGTH} characters`)
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    sink.add(path, 'must be a valid URL')
    return null
  }
  if (parsed.protocol !== 'https:') {
    sink.add(path, 'must use https')
    return null
  }
  if (parsed.username !== '' || parsed.password !== '') {
    sink.add(path, 'must not contain credentials')
    return null
  }
  return value
}

function parsePublishedTours(
  value: unknown,
  path: string,
  sink: ErrorSink,
): PublishedToursProviderSettings | null {
  if (!isPlainObject(value)) {
    sink.add(path, 'must be an object')
    return null
  }
  readExactKeys(value, ['url_pattern', 'all_tours_url'], path, sink)
  const urlPattern = parseUrlPattern(value.url_pattern, `${path}.url_pattern`, sink)
  const allToursUrl = parseAllToursUrl(
    value.all_tours_url,
    `${path}.all_tours_url`,
    sink,
  )
  if (urlPattern === null || allToursUrl === null) return null
  return { urlPattern, allToursUrl }
}

function parseProviders(
  value: unknown,
  path: string,
  sink: ErrorSink,
): EmailSettings['providers'] | null {
  if (!isPlainObject(value)) {
    sink.add(path, 'must be an object')
    return null
  }
  for (const key of unknownKeys(value, ['published_tours'])) {
    sink.add(`${path}.${key}`, 'unknown key')
  }
  if (!('published_tours' in value)) {
    return {}
  }
  const publishedTours = parsePublishedTours(
    value.published_tours,
    `${path}.published_tours`,
    sink,
  )
  if (publishedTours === null) return null
  return { publishedTours }
}

const TOP_LEVEL_KEYS = [
  'enabled',
  'send_mailbox',
  'allow_unsolicited',
  'footer',
  'limits',
  'frequency_cap',
  'recipient_allowlist',
  'same_template_cooldown_hours',
  'call_prompt_hours',
  'guardrails',
  'providers',
] as const

interface ParsedParts {
  enabled: boolean | null
  sendMailbox: string | null | undefined
  allowUnsolicited: boolean | null
  footer: string | null | undefined
  limits: EmailSettings['limits'] | null
  frequencyCap: EmailSettings['frequencyCap'] | undefined
  recipientAllowlist: string[] | null | undefined
  sameTemplateCooldownHours: number | null
  callPromptHours: number | null
  guardrails: EmailSettings['guardrails'] | null
  providers: EmailSettings['providers'] | null
}

function readParts(raw: Record<string, unknown>, sink: ErrorSink): ParsedParts {
  return {
    enabled: readBoolean(raw.enabled, 'enabled', sink),
    sendMailbox: readSendMailbox(raw.send_mailbox, 'send_mailbox', sink),
    allowUnsolicited: readBoolean(raw.allow_unsolicited, 'allow_unsolicited', sink),
    footer: readFooter(raw.footer, 'footer', sink),
    limits: parseLimits(raw.limits, 'limits', sink),
    frequencyCap: parseFrequencyCap(raw.frequency_cap, 'frequency_cap', sink),
    recipientAllowlist: parseAllowlist(
      raw.recipient_allowlist,
      'recipient_allowlist',
      sink,
    ),
    sameTemplateCooldownHours: readInt(
      raw.same_template_cooldown_hours,
      0,
      720,
      'same_template_cooldown_hours',
      sink,
    ),
    callPromptHours: readInt(raw.call_prompt_hours, 1, 168, 'call_prompt_hours', sink),
    guardrails: parseGuardrails(raw.guardrails, 'guardrails', sink),
    providers: parseProviders(raw.providers, 'providers', sink),
  }
}

// null/undefined in any part means that part failed to parse (an error is already in the sink).
function assemble(p: ParsedParts): EmailSettings | null {
  if (
    p.enabled === null ||
    p.sendMailbox === undefined ||
    p.allowUnsolicited === null ||
    p.footer === undefined ||
    p.limits === null ||
    p.frequencyCap === undefined ||
    p.recipientAllowlist === undefined ||
    p.sameTemplateCooldownHours === null ||
    p.callPromptHours === null ||
    p.guardrails === null ||
    p.providers === null
  ) {
    return null
  }
  return {
    enabled: p.enabled,
    sendMailbox: p.sendMailbox,
    allowUnsolicited: p.allowUnsolicited,
    footer: p.footer,
    limits: p.limits,
    frequencyCap: p.frequencyCap,
    recipientAllowlist: p.recipientAllowlist,
    sameTemplateCooldownHours: p.sameTemplateCooldownHours,
    callPromptHours: p.callPromptHours,
    guardrails: p.guardrails,
    providers: p.providers,
  }
}

export function parseEmailSettingsStrict(raw: unknown): ParseSettingsResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['root: must be an object'] }
  }
  const sink = new ErrorSink()
  readExactKeys(raw, TOP_LEVEL_KEYS, 'root', sink)
  const settings = assemble(readParts(raw, sink))
  if (sink.errors.length > 0 || settings === null) {
    return { ok: false, errors: sink.errors }
  }
  return { ok: true, settings }
}

export function serialiseEmailSettings(
  settings: EmailSettings,
): Record<string, unknown> {
  const providers: Record<string, unknown> = {}
  if (settings.providers.publishedTours) {
    providers.published_tours = {
      url_pattern: settings.providers.publishedTours.urlPattern,
      all_tours_url: settings.providers.publishedTours.allToursUrl,
    }
  }
  return {
    enabled: settings.enabled,
    send_mailbox: settings.sendMailbox,
    allow_unsolicited: settings.allowUnsolicited,
    footer: settings.footer,
    limits: {
      per_user_per_hour: settings.limits.perUserPerHour,
      per_user_per_day: settings.limits.perUserPerDay,
      per_mailbox_per_day: settings.limits.perMailboxPerDay,
    },
    frequency_cap: settings.frequencyCap
      ? { max: settings.frequencyCap.max, window_days: settings.frequencyCap.windowDays }
      : null,
    recipient_allowlist: settings.recipientAllowlist
      ? [...settings.recipientAllowlist]
      : null,
    same_template_cooldown_hours: settings.sameTemplateCooldownHours,
    call_prompt_hours: settings.callPromptHours,
    guardrails: {
      allowed_link_hosts: [...settings.guardrails.allowedLinkHosts],
      rules: settings.guardrails.rules.map((rule) => ({
        id: rule.id,
        phrases: [...rule.phrases],
        message: rule.message,
        severity: rule.severity,
      })),
    },
    providers,
  }
}
