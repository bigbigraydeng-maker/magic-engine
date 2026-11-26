/**
 * The signed token behind the one-click unsubscribe link of an automated ME e-mail.
 *
 *   token   = <payload part> "." <signature part>
 *   payload = base64url(JSON { v: 1, s: <triggered_sends.id>, c: <client id>, t: <issued at, unix seconds> })
 *   signature = base64url(HMAC-SHA256(UNSUBSCRIBE_SIGNING_SECRET, <payload part>))   (43 characters, no padding)
 *
 * The token names the SEND, not the guest: the unsubscribe entry reads the contact and the address fingerprint from the
 * send ledger row, so the link carries no address, no name and no contact id.
 *
 * Rules:
 *  - The secret is only ever read from the environment (only the PM sets it). A missing or short secret means no token
 *    is signed and none is accepted. `UNSUBSCRIBE_SIGNING_SECRET_PREV`, when set, is also accepted, so the secret can be
 *    rotated without breaking the links in letters already sent.
 *  - The signature is checked (constant time) before the payload is even decoded.
 *  - Tokens never expire: a link in a letter from months ago must still work (the same as every mailing service). The
 *    accepted risk: whoever the letter is forwarded to can unsubscribe the original recipient.
 *  - The issue time is part of the signed payload, so the caller must freeze it per send (e.g. the claim time): a
 *    replayed send must carry byte-for-byte the same link, or its frozen content changes.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.3 (token names the send: §16.9 item 7).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const UNSUBSCRIBE_SECRET_ENV = 'UNSUBSCRIBE_SIGNING_SECRET'
export const UNSUBSCRIBE_SECRET_PREV_ENV = 'UNSUBSCRIBE_SIGNING_SECRET_PREV'
export const UNSUBSCRIBE_SECRET_MIN_LENGTH = 32
/** Longer than any token we sign; anything longer is refused before any work is done. */
export const UNSUBSCRIBE_TOKEN_MAX_LENGTH = 400

const TOKEN_RE = /^([A-Za-z0-9_-]{16,300})\.([A-Za-z0-9_-]{43})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** 2026-01-01T00:00:00Z and 2100-01-01T00:00:00Z: the issue time must be a plausible unix time in seconds. */
const ISSUED_AT_MIN = 1_767_225_600
const ISSUED_AT_MAX = 4_102_444_800
const PAYLOAD_KEYS = ['c', 's', 't', 'v']

export type EnvReader = (name: string) => string | undefined

export interface UnsubscribeTokenPayload {
  /** triggered_sends.id of the letter that carried the link (lower-case uuid). */
  sendId: string
  /** The client the letter was sent for (lower-case uuid). */
  clientId: string
  /** Unix seconds. Frozen per send by the caller. */
  issuedAt: number
}

export type SignUnsubscribeTokenResult =
  | { ok: true; token: string }
  | { ok: false; code: 'no_secret' | 'invalid_payload' }

export type VerifyUnsubscribeTokenResult =
  | { ok: true; payload: UnsubscribeTokenPayload }
  | { ok: false; code: 'malformed' | 'bad_signature' | 'no_secret' }

function readSecret(env: EnvReader, name: string): string | null {
  const raw = env(name)
  const secret = typeof raw === 'string' ? raw.trim() : ''
  return secret.length >= UNSUBSCRIBE_SECRET_MIN_LENGTH ? secret : null
}

function signaturePart(secret: string, payloadPart: string): string {
  return createHmac('sha256', secret).update(payloadPart, 'utf8').digest('base64url')
}

function payloadProblem(payload: UnsubscribeTokenPayload): boolean {
  return (
    !UUID_RE.test(payload.sendId) ||
    !UUID_RE.test(payload.clientId) ||
    !Number.isInteger(payload.issuedAt) ||
    payload.issuedAt < ISSUED_AT_MIN ||
    payload.issuedAt > ISSUED_AT_MAX
  )
}

/** Sign the link token of one send. Never falls back to a default secret. */
export function signUnsubscribeToken(payload: UnsubscribeTokenPayload, env: EnvReader): SignUnsubscribeTokenResult {
  if (payloadProblem(payload)) return { ok: false, code: 'invalid_payload' }
  const secret = readSecret(env, UNSUBSCRIBE_SECRET_ENV)
  if (secret === null) return { ok: false, code: 'no_secret' }
  const json = JSON.stringify({ v: 1, s: payload.sendId, c: payload.clientId, t: payload.issuedAt })
  const payloadPart = Buffer.from(json, 'utf8').toString('base64url')
  return { ok: true, token: `${payloadPart}.${signaturePart(secret, payloadPart)}` }
}

function signatureMatches(secrets: readonly string[], payloadPart: string, given: string): boolean {
  const givenBytes = Buffer.from(given, 'utf8')
  let matched = false
  // Every available secret is checked (no early exit), so the time taken does not tell which one matched.
  for (const secret of secrets) {
    const expected = Buffer.from(signaturePart(secret, payloadPart), 'utf8')
    if (expected.length === givenBytes.length && timingSafeEqual(expected, givenBytes)) matched = true
  }
  return matched
}

function decodePayload(payloadPart: string): UnsubscribeTokenPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== PAYLOAD_KEYS.join(',')) return null
  if (record.v !== 1 || typeof record.s !== 'string' || typeof record.c !== 'string' || typeof record.t !== 'number') return null
  const payload: UnsubscribeTokenPayload = { sendId: record.s, clientId: record.c, issuedAt: record.t }
  return payloadProblem(payload) ? null : payload
}

/** Check a token from a link. A bad token gets no detail beyond its code. */
export function verifyUnsubscribeToken(token: string, env: EnvReader): VerifyUnsubscribeTokenResult {
  if (typeof token !== 'string' || token.length > UNSUBSCRIBE_TOKEN_MAX_LENGTH) return { ok: false, code: 'malformed' }
  const match = TOKEN_RE.exec(token)
  if (match === null) return { ok: false, code: 'malformed' }
  const secrets = [readSecret(env, UNSUBSCRIBE_SECRET_ENV), readSecret(env, UNSUBSCRIBE_SECRET_PREV_ENV)].filter(
    (s): s is string => s !== null,
  )
  if (secrets.length === 0) return { ok: false, code: 'no_secret' }
  if (!signatureMatches(secrets, match[1], match[2])) return { ok: false, code: 'bad_signature' }
  const payload = decodePayload(match[1])
  return payload === null ? { ok: false, code: 'malformed' } : { ok: true, payload }
}
