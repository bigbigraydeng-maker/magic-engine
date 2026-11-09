/**
 * Distributor self-service portal access, deliberately separate from ME's Supabase login:
 * distributors never get a Supabase session, so no existing /api route that trusts "any logged-in
 * user" can be reached by them. An admin creates a one-time invite link (24h); opening it trades the
 * invite for a portal session (30 days) held in an httpOnly cookie scoped to this portal.
 * Only SHA-256 hashes of tokens are stored.
 */
import { createHash, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { DistributorStoreError, fail } from './store'

export const PORTAL_COOKIE = 'me_partner_session'
export const INVITE_TTL_MS = 24 * 3_600_000
export const SESSION_TTL_MS = 30 * 24 * 3_600_000

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value)
}

/** Reads the portal session token from a Cookie header. */
export function sessionTokenFrom(req: Request): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === PORTAL_COOKIE) {
      const value = rest.join('=')
      return isTokenShaped(value) ? value : null
    }
  }
  return null
}

const PORTAL_STATUSES = new Set(['approved', 'suspended'])

async function distributorStatus(id: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('distributors').select('status').eq('id', id).maybeSingle()
  if (error) fail('load distributor', error)
  return (data as { status: string } | null)?.status ?? null
}

/** One-time invite for an approved (or suspended, view-only) distributor. Returns the raw token once. */
export async function createInvite(distributorId: string, actorEmail: string, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const status = await distributorStatus(distributorId)
  if (!status) throw new DistributorStoreError('distributor not found', 404)
  if (!PORTAL_STATUSES.has(status)) throw new DistributorStoreError('only approved distributors can get a login link', 409)
  const { token, hash } = newToken()
  const expiresAt = new Date(now + INVITE_TTL_MS).toISOString()
  const { error } = await supabaseAdmin.from('distributor_portal_tokens').insert({
    distributor_id: distributorId, kind: 'invite', token_hash: hash, expires_at: expiresAt, created_by: actorEmail,
  })
  if (error) fail('create invite', error)
  return { token, expiresAt }
}

/**
 * Trades an unused, unexpired invite for a new session. The invite is marked used with a conditional
 * update, so two clicks on the same link cannot both get a session.
 */
export async function redeemInvite(token: string, now = Date.now()): Promise<{ sessionToken: string; expiresAt: string } | null> {
  if (!isTokenShaped(token)) return null
  const nowIso = new Date(now).toISOString()
  const { data, error } = await supabaseAdmin
    .from('distributor_portal_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', hashToken(token))
    .eq('kind', 'invite')
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .select('distributor_id')
    .maybeSingle()
  if (error) fail('redeem invite', error)
  const distributorId = (data as { distributor_id: string } | null)?.distributor_id
  if (!distributorId) return null
  const status = await distributorStatus(distributorId)
  if (!status || !PORTAL_STATUSES.has(status)) return null
  const session = newToken()
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()
  const inserted = await supabaseAdmin.from('distributor_portal_tokens').insert({
    distributor_id: distributorId, kind: 'session', token_hash: session.hash, expires_at: expiresAt, created_by: 'invite',
  })
  if (inserted.error) fail('create portal session', inserted.error)
  return { sessionToken: session.token, expiresAt }
}

/** The distributor behind a live session, or null. Rejected / pending distributors lose access at once. */
export async function resolveSession(token: string | null, now = Date.now()): Promise<string | null> {
  if (!token || !isTokenShaped(token)) return null
  const { data, error } = await supabaseAdmin
    .from('distributor_portal_tokens')
    .select('distributor_id')
    .eq('token_hash', hashToken(token))
    .eq('kind', 'session')
    .is('revoked_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .maybeSingle()
  if (error) fail('load portal session', error)
  const distributorId = (data as { distributor_id: string } | null)?.distributor_id
  if (!distributorId) return null
  const status = await distributorStatus(distributorId)
  return status && PORTAL_STATUSES.has(status) ? distributorId : null
}

export async function revokeSession(token: string, now = Date.now()): Promise<void> {
  if (!isTokenShaped(token)) return
  const { error } = await supabaseAdmin
    .from('distributor_portal_tokens')
    .update({ revoked_at: new Date(now).toISOString() })
    .eq('token_hash', hashToken(token))
    .eq('kind', 'session')
    .is('revoked_at', null)
  if (error) fail('revoke portal session', error)
}

export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const attrs = [`${PORTAL_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expiresAt).toUTCString()}`]
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export function clearedSessionCookie(secure: boolean): string {
  const attrs = [`${PORTAL_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}
