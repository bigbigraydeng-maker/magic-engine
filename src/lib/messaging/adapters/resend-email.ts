/**
 * The one place where ME sends an automated e-mail through Resend (a connector: provider details stay in this file).
 *
 * What it guarantees:
 *  - Every sending account label has its own variable, `RESEND_API_KEY_<ACCOUNT>`. A missing, empty or malformed key
 *    means NO send. resend@6 quietly falls back to `RESEND_API_KEY` (ME's system key) when it is handed an empty key, so
 *    an empty value never reaches `new Resend(...)`, and the label 'system' is refused outright: a client's mail never
 *    uses the system key by accident. (Using the same Resend account on purpose is allowed: the client's own variable
 *    may hold a key of that account, as CTS does since 2026-11-10.) The SDK client is created inside each call, with the
 *    provider address pinned, so the SDK's own `RESEND_BASE_URL` variable cannot send the key somewhere else.
 *  - The SDK sets no request timeout. The call gets 15 seconds; after that the outcome is UNKNOWN (the request may have
 *    reached Resend). Unknown is never "failed": the caller keeps the send pending and may replay it only with the SAME
 *    idempotency key and the SAME frozen content, and never sends a second, different mail.
 *  - "rejected" (definitely not sent, the guest's address may be released) only for a FIRST attempt refused as a bad
 *    request (400 / 422). A replay's refusal cannot prove the first attempt did not go out, and 401 / 403 / 404 are our
 *    own key or account problem, not the guest's: all of those, 409, 429, 5xx, network errors and anything that cannot
 *    be classified are "unknown" (the provider status is passed on so the caller can raise a to-do for a key problem).
 *  - Everything is checked before the provider is called; a request that fails a check is "not_attempted".
 *  - Nothing here logs or returns an address, a subject, a body or a provider error message (those can echo addresses).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.1.
 */

import { Resend, type CreateEmailOptions, type CreateEmailRequestOptions } from 'resend'

export const RESEND_SEND_TIMEOUT_MS = 15_000
/** The provider address, pinned (the SDK would otherwise read it from RESEND_BASE_URL). */
export const RESEND_API_BASE_URL = 'https://api.resend.com'
/** First-attempt refusals that mean "this request was bad", so nothing was sent. */
const DEFINITE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 422])

/** The label of ME's own account (login links, notifications). Automated client mail must never use it. */
const SYSTEM_ACCOUNT = 'system'
const ACCOUNT_RE = /^[a-z][a-z0-9_]{0,30}$/
const KEY_RE = /^re_[A-Za-z0-9_-]{8,200}$/
const DOMAIN_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
const EMAIL_RE = new RegExp(`^[^\\s@<>()",;:\\\\\\[\\]]{1,64}@${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`)
// No quotes, angle brackets, commas or semicolons: an unquoted comma would make the provider read two addresses.
const DISPLAY_NAME_RE = /^[^<>"\r\n,;]{1,80}$/
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/
const TAG_RE = /^[A-Za-z0-9_-]{1,256}$/
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,256}$/
const ERROR_NAME_RE = /^[a-z_]{1,64}$/
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'bcc',
  'cc',
  'content-transfer-encoding',
  'content-type',
  'date',
  'dkim-signature',
  'from',
  'message-id',
  'mime-version',
  'received',
  'reply-to',
  'return-path',
  'sender',
  'subject',
  'to',
])
const MAX_HEADERS = 10
const MAX_TAGS = 10
const MAX_SUBJECT = 200
const MAX_TEXT = 100_000
const MAX_HTML = 500_000
const MAX_HEADER_VALUE = 2_000

export interface ResendEmailRequest {
  /** The sending account label of the authorization (e.g. 'cts'): lower-case letters, digits and underscores. */
  account: string
  /** 'local@domain' or 'Display Name <local@domain>'. */
  from: string
  to: string
  replyTo: string
  subject: string
  text: string
  html?: string
  /** Extra headers (List-Unsubscribe and the like). Names are header tokens; values carry no line breaks. */
  headers: Readonly<Record<string, string>>
  /** Sent as the Idempotency-Key header. One key must always carry one and the same payload. */
  idempotencyKey: string
  tags: ReadonlyArray<{ name: string; value: string }>
  /** 'replay' = this send was attempted before (same key, same frozen content): then no refusal counts as "not sent". */
  attempt: 'first' | 'replay'
}

export type ResendSendOutcome =
  | { kind: 'sent'; messageId: string }
  | { kind: 'rejected'; code: string; status: number }
  | { kind: 'unknown'; code: string; status: number | null }
  | {
      kind: 'not_attempted'
      code: 'invalid_account' | 'no_account_key' | 'invalid_request' | 'client_init_failed'
      detail: string
    }

export type EnvReader = (name: string) => string | undefined

/**
 * The slice of the SDK client we use. The result is `unknown` on purpose: the SDK hands back whatever the provider's
 * error body parsed into, so every field is checked before it is believed (outcomeOfResponse).
 */
export interface ResendClientLike {
  emails: {
    send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions): Promise<unknown>
  }
}

export interface ResendEmailPortDeps {
  env: EnvReader
  createClient: (key: string) => ResendClientLike
  timeoutMs: number
}

export interface ResendEmailPort {
  send(request: ResendEmailRequest): Promise<ResendSendOutcome>
}

export type AccountKeyRead =
  | { ok: true; key: string; envName: string }
  | { ok: false; code: 'invalid_account' | 'no_account_key'; detail: string }

/** `cts` → `RESEND_API_KEY_CTS`; null for a malformed label or the system account. */
export function resendAccountKeyEnvName(account: string): string | null {
  if (!ACCOUNT_RE.test(account) || account === SYSTEM_ACCOUNT) return null
  return `RESEND_API_KEY_${account.toUpperCase()}`
}

/** Reads and checks the account's own key. Never falls back to any other key. */
export function readResendAccountKey(account: string, env: EnvReader): AccountKeyRead {
  const envName = resendAccountKeyEnvName(account)
  if (envName === null) return { ok: false, code: 'invalid_account', detail: 'account label is malformed or reserved' }
  const raw = env(envName)
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!KEY_RE.test(key)) return { ok: false, code: 'no_account_key', detail: `${envName} is missing or malformed` }
  return { ok: true, key, envName }
}

function fromAddress(from: string): string | null {
  const trimmed = from.trim()
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(trimmed)
  if (named === null) return trimmed
  return DISPLAY_NAME_RE.test(named[1].trim()) ? named[2] : null
}

function isEmail(value: string | null): boolean {
  return value !== null && value.length <= 254 && EMAIL_RE.test(value)
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value)
}

function headersProblem(headers: Readonly<Record<string, string>>): string | null {
  const entries = Object.entries(headers)
  if (entries.length > MAX_HEADERS) return 'too many headers'
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) return 'header name not allowed'
    if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_HEADER_VALUE || hasLineBreak(value)) {
      return 'header value not allowed'
    }
  }
  return null
}

function tagsProblem(tags: ReadonlyArray<{ name: string; value: string }>): string | null {
  if (tags.length > MAX_TAGS) return 'too many tags'
  for (const tag of tags) {
    if (!TAG_RE.test(tag.name) || !TAG_RE.test(tag.value)) return 'tag not allowed'
  }
  return null
}

/** Why the request must not be sent, or null when it may. Never mentions the address or the content. */
export function resendRequestProblem(request: ResendEmailRequest): string | null {
  if (!isEmail(fromAddress(request.from))) return 'from is not a valid sender'
  if (!isEmail(request.to.trim())) return 'to is not a single valid address'
  if (!isEmail(request.replyTo.trim())) return 'replyTo is not a single valid address'
  const subject = request.subject.trim()
  if (subject === '' || subject.length > MAX_SUBJECT || hasLineBreak(request.subject)) return 'subject is empty, too long or multi-line'
  if (request.text.trim() === '' || request.text.length > MAX_TEXT) return 'text is empty or too long'
  if (request.html !== undefined && (request.html.trim() === '' || request.html.length > MAX_HTML)) return 'html is empty or too long'
  if (!IDEMPOTENCY_KEY_RE.test(request.idempotencyKey)) return 'idempotency key is malformed'
  if (request.attempt !== 'first' && request.attempt !== 'replay') return 'attempt must be first or replay'
  return headersProblem(request.headers) ?? tagsProblem(request.tags)
}

/**
 * A provider error: on a first attempt, a bad-request refusal (400 / 422) is "rejected"; everything else, and every
 * refusal of a replay, is an unknown outcome.
 */
export function classifyResendError(
  error: unknown,
  attempt: ResendEmailRequest['attempt'],
): Extract<ResendSendOutcome, { kind: 'rejected' | 'unknown' }> {
  const fields: { statusCode?: unknown; name?: unknown } =
    typeof error === 'object' && error !== null ? (error as { statusCode?: unknown; name?: unknown }) : {}
  const status = typeof fields.statusCode === 'number' && Number.isInteger(fields.statusCode) ? fields.statusCode : null
  const code = typeof fields.name === 'string' && ERROR_NAME_RE.test(fields.name) ? fields.name : 'unknown_error'
  if (attempt === 'first' && status !== null && DEFINITE_REFUSAL_STATUSES.has(status)) {
    return { kind: 'rejected', code, status }
  }
  return { kind: 'unknown', code, status }
}

function payloadOf(request: ResendEmailRequest): CreateEmailOptions {
  const base = {
    from: request.from.trim(),
    to: [request.to.trim()],
    replyTo: request.replyTo.trim(),
    subject: request.subject.trim(),
    headers: { ...request.headers },
    tags: request.tags.map((tag) => ({ name: tag.name, value: tag.value })),
  }
  return request.html === undefined ? { ...base, text: request.text } : { ...base, text: request.text, html: request.html }
}

type CallResult = { type: 'response'; response: unknown } | { type: 'thrown' } | { type: 'timeout' }

async function callWithTimeout(
  client: ResendClientLike,
  payload: CreateEmailOptions,
  idempotencyKey: string,
  timeoutMs: number,
): Promise<CallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // A synchronous throw becomes a rejection, and a late rejection after the timeout is still handled here.
  const call: Promise<CallResult> = Promise.resolve()
    .then(() => client.emails.send(payload, { idempotencyKey }))
    .then(
      (response): CallResult => ({ type: 'response', response }),
      (): CallResult => ({ type: 'thrown' }),
    )
  const timeout = new Promise<CallResult>((resolve) => {
    timer = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs)
  })
  try {
    return await Promise.race([call, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function outcomeOfResponse(response: unknown, attempt: ResendEmailRequest['attempt']): ResendSendOutcome {
  if (typeof response !== 'object' || response === null) return { kind: 'unknown', code: 'malformed_response', status: null }
  const { data, error } = response as { data?: unknown; error?: unknown }
  if (error !== null && error !== undefined) return classifyResendError(error, attempt)
  const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined
  if (typeof id === 'string' && id.trim() !== '') return { kind: 'sent', messageId: id.trim() }
  return { kind: 'unknown', code: 'no_message_id', status: null }
}

const DEFAULT_DEPS: ResendEmailPortDeps = {
  env: (name) => process.env[name],
  createClient: (key) => new Resend(key, { baseUrl: RESEND_API_BASE_URL }),
  timeoutMs: RESEND_SEND_TIMEOUT_MS,
}

export function createResendEmailPort(overrides: Partial<ResendEmailPortDeps> = {}): ResendEmailPort {
  const deps: ResendEmailPortDeps = { ...DEFAULT_DEPS, ...overrides }
  const timeoutMs = Number.isInteger(deps.timeoutMs) && deps.timeoutMs > 0 && deps.timeoutMs <= 60_000 ? deps.timeoutMs : RESEND_SEND_TIMEOUT_MS
  return {
    async send(request) {
      const key = readResendAccountKey(request.account, deps.env)
      if (!key.ok) return { kind: 'not_attempted', code: key.code, detail: key.detail }
      const problem = resendRequestProblem(request)
      if (problem !== null) return { kind: 'not_attempted', code: 'invalid_request', detail: problem }
      let client: ResendClientLike
      try {
        client = deps.createClient(key.key)
      } catch {
        return { kind: 'not_attempted', code: 'client_init_failed', detail: 'the Resend client could not be created' }
      }
      const result = await callWithTimeout(client, payloadOf(request), request.idempotencyKey, timeoutMs)
      if (result.type === 'timeout') return { kind: 'unknown', code: 'timeout', status: null }
      if (result.type === 'thrown') return { kind: 'unknown', code: 'exception', status: null }
      return outcomeOfResponse(result.response, request.attempt)
    },
  }
}
