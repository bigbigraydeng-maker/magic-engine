/**
 * Meta data deletion callback (Magic Bridge self-serve opening, PR-3;
 * design docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md §8.5).
 *
 * Meta POSTs `signed_request` = base64url(HMAC-SHA256 signature) + '.' + base64url(JSON payload)
 * when someone removes the Magic Engine app and asks for their data to be deleted.
 * We verify the signature with the app secret (constant-time compare, algorithm checked),
 * then run the database function that revokes that person's read-only ads connections in
 * every client, blanks the tokens, empties report contents and revokes keys.
 * Only the hashed app-scoped user id is stored.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

export interface DeletionRequest {
  userId: string
  issuedAt: Date
}

export interface DeletionResult {
  confirmationCode: string
  status: 'completed' | 'no_data'
}

/** Meta may deliver a request a little ahead of our clock; anything further in the future is refused. */
const MAX_CLOCK_SKEW_SECONDS = 300

function base64UrlDecode(part: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null
  return Buffer.from(part, 'base64url')
}

function parsePayload(encoded: string): Record<string, unknown> | null {
  const raw = base64UrlDecode(encoded)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Returns the verified request, or null for anything malformed, unsigned or wrongly signed. */
export function parseSignedRequest(signedRequest: string, appSecret: string, nowSeconds: number): DeletionRequest | null {
  if (!appSecret) return null
  const parts = signedRequest.split('.')
  if (parts.length !== 2) return null
  const [encodedSig, encodedPayload] = parts
  const signature = base64UrlDecode(encodedSig)
  const payload = parsePayload(encodedPayload)
  if (!signature || !payload) return null
  if (typeof payload.algorithm !== 'string' || payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return null
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest()
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null
  const userId = payload.user_id
  const issuedAt = payload.issued_at
  if (typeof userId !== 'string' || !/^[0-9]{1,32}$/.test(userId)) return null
  if (typeof issuedAt !== 'number' || !Number.isInteger(issuedAt) || issuedAt <= 0) return null
  if (issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null
  return { userId, issuedAt: new Date(issuedAt * 1000) }
}

export function appUserHash(userId: string): string {
  return createHash('sha256').update(`meta-app-user:${userId}`).digest('hex')
}

export function newConfirmationCode(): string {
  return randomBytes(24).toString('base64url')
}

export async function processDeletion(request: DeletionRequest): Promise<DeletionResult> {
  const { data, error } = await supabaseAdmin.rpc('meta_process_data_deletion', {
    p_app_user_id: request.userId,
    p_app_user_hash: appUserHash(request.userId),
    p_issued_at: request.issuedAt.toISOString(),
    p_confirmation: newConfirmationCode(),
  })
  if (error) throw new Error('data_deletion_failed')
  const row = (Array.isArray(data) ? data[0] : data) as { confirmation_code?: unknown; status?: unknown } | null
  if (!row || typeof row.confirmation_code !== 'string' || (row.status !== 'completed' && row.status !== 'no_data')) {
    throw new Error('data_deletion_failed')
  }
  return { confirmationCode: row.confirmation_code, status: row.status }
}

/** Public status lookup by confirmation code (unguessable, 32 chars). Returns no personal data. */
export async function deletionStatus(code: string): Promise<{ status: 'completed' | 'no_data'; receivedAt: string } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(code)) return null
  const { data, error } = await supabaseAdmin
    .from('meta_data_deletion_requests')
    .select('status, received_at')
    .eq('confirmation_code', code)
    .maybeSingle()
  if (error) throw new Error('data_deletion_status_failed')
  if (!data) return null
  const row = data as { status: 'completed' | 'no_data'; received_at: string }
  return { status: row.status, receivedAt: row.received_at }
}
