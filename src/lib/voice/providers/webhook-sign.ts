/**
 * OpenAI/Svix-style webhook HMAC signing + verification (stable, documented
 * scheme — avoids guessing SDK helper types, spec §8.3 / rule #24).
 *
 * signedContent = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * signature      = base64(HMAC_SHA256(secretBytes, signedContent))
 * header         = "v1,<sig>" (space-separated list allowed)
 */
import { createHmac, timingSafeEqual } from 'crypto'

function secretBytes(secret: string): Buffer {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  // Svix secrets are base64; fall back to utf8 if not valid base64.
  try {
    const b = Buffer.from(raw, 'base64')
    if (b.length > 0) return b
  } catch { /* noop */ }
  return Buffer.from(raw, 'utf8')
}

export function computeSignature(rawBody: string, secret: string, id: string, timestamp: string): string {
  const signed = `${id}.${timestamp}.${rawBody}`
  return createHmac('sha256', secretBytes(secret)).update(signed).digest('base64')
}

export interface SignedHeaders {
  [k: string]: string
  'webhook-id': string
  'webhook-timestamp': string
  'webhook-signature': string
}

/** Build signed headers for a payload (used by simulate script + tests). */
export function signWebhook(rawBody: string, secret: string, id: string, timestampSec: number): SignedHeaders {
  const ts = String(timestampSec)
  return {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': `v1,${computeSignature(rawBody, secret, id, ts)}`,
  }
}

export interface VerifyResult {
  valid: boolean
  id: string | null
  reason?: string
}

export function verifyWebhookSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  replayWindowSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const lower: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const id = lower['webhook-id'] ?? null
  const ts = lower['webhook-timestamp']
  const sigHeader = lower['webhook-signature']
  if (!id || !ts || !sigHeader) return { valid: false, id, reason: 'missing webhook headers' }

  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return { valid: false, id, reason: 'bad timestamp' }
  if (Math.abs(nowSec - tsNum) > replayWindowSec) return { valid: false, id, reason: 'timestamp outside replay window' }

  const expected = computeSignature(rawBody, secret, id, ts)
  const expectedBuf = Buffer.from(expected)
  const provided = sigHeader.split(/\s+/).map((p) => p.replace(/^v1,/, ''))
  for (const p of provided) {
    const pBuf = Buffer.from(p)
    if (pBuf.length === expectedBuf.length && timingSafeEqual(pBuf, expectedBuf)) {
      return { valid: true, id }
    }
  }
  return { valid: false, id, reason: 'signature mismatch' }
}
