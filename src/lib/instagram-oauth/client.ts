/** Instagram Login, identity only. Separate product credentials from Facebook Login.
 * Protocol source/date and deployment prerequisites are recorded in the onboarding spec.
 * Never log requests, responses or exceptions: long-token exchange has secrets in its URL.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isInstagramAccountId, normalizeInstagramHandle, requiredInstagramScopes } from './identity'

export const INSTAGRAM_STATE_COOKIE = 'instagram_oauth_state'
export const INSTAGRAM_STATE_PATH = '/api/auth/instagram'
export const INSTAGRAM_STATE_TTL_SECS = 600
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

interface InstagramConfig { appId: string; secret: string; origin: string; redirectUri: string }

function configuredOrigin(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '')
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/'
      && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}

export function getInstagramConfig(): InstagramConfig | null {
  const origin = configuredOrigin()
  const appId = process.env.INSTAGRAM_APP_ID?.trim()
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (process.env.INSTAGRAM_LOGIN_ENABLED !== 'true' || !origin || !appId || !/^\d+$/.test(appId)
    || !secret?.trim()) return null
  return { appId, secret, origin, redirectUri: `${origin}${INSTAGRAM_STATE_PATH}/callback` }
}

export function instagramReturnUrl(clientId: string | null, outcome: string): string {
  const origin = configuredOrigin() ?? 'http://localhost:3001'
  const query = new URLSearchParams({ tab: 'content', section: 'social-connections', instagram: outcome })
  return clientId && UUID.test(clientId)
    ? `${origin}/dashboard/clients/${clientId}/settings?${query}`
    : `${origin}/dashboard?instagram=bad_state`
}

export interface InstagramState { clientId: string; userId: string; handle: string; nonce: string }

export function buildInstagramState(input: Omit<InstagramState, 'nonce'>, secret: string): string {
  if (!UUID.test(input.clientId) || !UUID.test(input.userId) || normalizeInstagramHandle(input.handle) !== input.handle) {
    throw new Error('Invalid Instagram consent context')
  }
  const payload = Buffer.from(JSON.stringify({ ...input, purpose: 'instagram_identity_v1',
    nonce: randomBytes(24).toString('hex'), exp: Date.now() + INSTAGRAM_STATE_TTL_SECS * 1000 })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

export function verifyInstagramState(state: string, secret: string): InstagramState | null {
  try {
    if (state.length > 2048) return null
    const parts = state.split('.')
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
    const signature = createHmac('sha256', secret).update(parts[0]).digest('base64url')
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(parts[1]))) return null
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (!data || data.purpose !== 'instagram_identity_v1' || typeof data.exp !== 'number'
      || !Number.isSafeInteger(data.exp) || data.exp <= Date.now()
      || data.exp > Date.now() + INSTAGRAM_STATE_TTL_SECS * 1000
      || typeof data.clientId !== 'string' || !UUID.test(data.clientId)
      || typeof data.userId !== 'string' || !UUID.test(data.userId)
      || typeof data.handle !== 'string' || normalizeInstagramHandle(data.handle) !== data.handle
      || typeof data.nonce !== 'string' || !/^[a-f\d]{48}$/.test(data.nonce)) return null
    return { clientId: data.clientId, userId: data.userId, handle: data.handle, nonce: data.nonce }
  } catch { return null }
}

export function instagramAuthUrl(config: InstagramConfig, state: string): string {
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: requiredInstagramScopes().join(','), state }).toString()
  return url.toString()
}

type JsonObject = Record<string, unknown>
function object(value: unknown): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value) }
/** Official examples vary between flat and a single data item. Never pick an arbitrary account. */
function oneRecord(value: unknown): JsonObject | null {
  if (!object(value) || 'error' in value) return null
  if (!('data' in value)) return value
  if (Object.keys(value).length !== 1 || !Array.isArray(value.data) || value.data.length !== 1) return null
  return object(value.data[0]) && !('error' in value.data[0]) ? value.data[0] : null
}
function token(value: unknown): value is string { return typeof value === 'string' && /^[\x21-\x7e]{1,8192}$/.test(value) }

async function providerJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Instagram request failed')
  return response.json()
}

/** No /me/permissions fiction: permissions comes from the actual code exchange. */
export async function readInstagramIdentity(code: string, config: InstagramConfig): Promise<{
  accessToken: string; tokenExpiry: Date; accountId: string; username: string; scopes: string[]
} | null> {
  try {
    if (!code || code.length > 4096) return null
    const form = new FormData()
    for (const [name, value] of Object.entries({ client_id: config.appId, client_secret: config.secret,
      grant_type: 'authorization_code', redirect_uri: config.redirectUri, code })) form.set(name, value)
    const short = oneRecord(await providerJson('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }))
    if (!short || !token(short.access_token) || !isInstagramAccountId(short.user_id) || typeof short.permissions !== 'string') return null
    const scopes = short.permissions.split(',').map(value => value.trim())
    if (!scopes.length || scopes.length > 32 || scopes.some(scope => !/^[a-z_]{1,100}$/.test(scope))
      || new Set(scopes).size !== scopes.length || !requiredInstagramScopes().every(scope => scopes.includes(scope))) return null
    const exchange = new URL('https://graph.instagram.com/access_token')
    exchange.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: config.secret, access_token: short.access_token }).toString()
    const long = oneRecord(await providerJson(exchange.toString()))
    if (!long || !token(long.access_token) || typeof long.token_type !== 'string' || long.token_type.toLowerCase() !== 'bearer'
      || typeof long.expires_in !== 'number' || !Number.isSafeInteger(long.expires_in)
      || long.expires_in <= 0 || long.expires_in > 60 * 24 * 60 * 60) return null
    // Start the expiry clock at receipt, not after the identity request's latency.
    const tokenExpiry = new Date(Date.now() + long.expires_in * 1000)
    const me = oneRecord(await providerJson('https://graph.instagram.com/v26.0/me?fields=user_id,username', {
      headers: { Authorization: `Bearer ${long.access_token}` },
    }))
    if (!me || !isInstagramAccountId(me.user_id)) return null
    const username = normalizeInstagramHandle(me.username)
    if (!username || tokenExpiry.getTime() <= Date.now()) return null
    return { accessToken: long.access_token, tokenExpiry, accountId: me.user_id, username, scopes }
  } catch { return null }
}

/** Renew a long-lived value (official `ig_refresh_token`). Needs no app secret; the provider only accepts
 * values that are >=24h old and unexpired. Returns null on any failure and never throws: the URL carries the
 * secret value, so no error text from this call may leave this function. */
export async function refreshInstagramToken(accessToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    if (!token(accessToken)) return null
    const url = new URL('https://graph.instagram.com/refresh_access_token')
    url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken }).toString()
    const body = oneRecord(await providerJson(url.toString()))
    if (!body || !token(body.access_token) || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer'
      || typeof body.expires_in !== 'number' || !Number.isSafeInteger(body.expires_in)
      || body.expires_in <= 0 || body.expires_in > 60 * 24 * 60 * 60) return null
    return { accessToken: body.access_token, expiresIn: body.expires_in }
  } catch { return null }
}
