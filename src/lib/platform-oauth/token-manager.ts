/**
 * Platform OAuth Token Manager — Phase 24.A.2
 *
 * Single entry point for all platform API callers:
 *
 *   const token = await getValidToken(clientId, 'google_gbp')
 *   // token is always a valid plaintext access_token — never expired.
 *
 * If the stored token is expired (or within the 5-min safety buffer),
 * this module transparently:
 *   1. Decrypts the refresh_token
 *   2. Calls the provider's token endpoint
 *   3. Re-encrypts and persists the new access_token
 *   4. Returns the fresh token
 *
 * Callers never check expiry or trigger refresh themselves.
 * Server-side only.
 */

import { supabaseAdmin } from '../supabase'
import {
  decryptToken,
  encryptToken,
  isTokenExpired,
  PLATFORM_PROVIDERS,
  CONNECTION_STATUS,
  type PlatformProvider,
  type PlatformOAuthConnectionRow,
} from './vocabulary'
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'

// ─── Custom errors ────────────────────────────────────────────────────────────

export class PlatformConnectionNotFoundError extends Error {
  readonly clientId: string
  readonly provider: PlatformProvider

  constructor(clientId: string, provider: PlatformProvider) {
    super(`No active ${provider} connection for client ${clientId}`)
    this.name      = 'PlatformConnectionNotFoundError'
    this.clientId  = clientId
    this.provider  = provider
  }
}

export class PlatformTokenRefreshError extends Error {
  readonly provider: PlatformProvider

  constructor(provider: PlatformProvider, reason: string) {
    super(`Token refresh failed for ${provider}: ${reason}`)
    this.name     = 'PlatformTokenRefreshError'
    this.provider = provider
  }
}

// ─── Provider-specific refresh logic ─────────────────────────────────────────

interface RefreshResult {
  accessToken: string
  expiresAt:   Date
  /**
   * 提供方换给我们的**新**刷新令牌。
   *
   * Microsoft 每刷新一次就轮换一次刷新令牌，旧的会作废。不把新的存回去，
   * 连接会在某一天变成 `invalid_grant` 停掉 —— 而且是安静地停：邮件不再进来、
   * 没有任何报错，只能让客户重新授权一次。
   * Google 通常不回这个字段，所以是可选的：没回就继续用原来那个。
   */
  refreshToken?: string
}

async function refreshGoogleToken(
  refreshTokenPlain: string,
  provider: PlatformProvider = PLATFORM_PROVIDERS.GOOGLE_GBP,
): Promise<RefreshResult> {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new PlatformTokenRefreshError(
      provider,
      'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured',
    )
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshTokenPlain,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)')
    throw new PlatformTokenRefreshError(provider, `HTTP ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    access_token?:       string
    expires_in?:         number
    error?:              string
    error_description?:  string
  }

  if (!data.access_token) {
    const detail = data.error_description ?? data.error ?? 'missing access_token in response'
    throw new PlatformTokenRefreshError(provider, detail)
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000)
  return { accessToken: data.access_token, expiresAt }
}

/**
 * 刷新客户邮箱的令牌（Microsoft Graph）。
 *
 * 跟 Google 那段的差别只有两处，但都会静默毁掉刷新：
 *  · 端点带 tenant 段。用 `common` 而不是具体 tenant id —— 客户可能是
 *    Outlook.com 个人账号，也可能是公司的 Microsoft 365，写死任一种都会把
 *    另一种挡在门外。
 *  · **必须回传 scope**。Microsoft 只把「本次请求要了的权限」发新令牌，漏掉
 *    scope 会拿到一个权限更小的令牌，读信时才报 403 —— 那时已经离现场很远了。
 *    `offline_access` 也必须在里面，否则换来的令牌不再带刷新能力，下一次就断。
 */
async function refreshMicrosoftToken(refreshTokenPlain: string): Promise<RefreshResult> {
  const clientId     = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new PlatformTokenRefreshError(
      PLATFORM_PROVIDERS.MICROSOFT_MAIL,
      'MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not configured',
    )
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshTokenPlain,
    scope:         MICROSOFT_MAIL_SCOPES.join(' '),
  })

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)')
    throw new PlatformTokenRefreshError(
      PLATFORM_PROVIDERS.MICROSOFT_MAIL,
      `HTTP ${res.status}: ${text}`,
    )
  }

  const data = (await res.json()) as {
    access_token?:      string
    refresh_token?:     string
    expires_in?:        number
    error?:             string
    error_description?: string
  }

  if (!data.access_token) {
    const detail = data.error_description ?? data.error ?? 'missing access_token in response'
    throw new PlatformTokenRefreshError(PLATFORM_PROVIDERS.MICROSOFT_MAIL, detail)
  }

  return {
    accessToken:  data.access_token,
    // 轮换过的刷新令牌必须存回去，否则连接迟早安静地断（见 RefreshResult）。
    refreshToken: data.refresh_token,
    expiresAt:    new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  }
}

function isGoogleProvider(provider: PlatformProvider): boolean {
  return (
    provider === PLATFORM_PROVIDERS.GOOGLE_GBP ||
    provider === PLATFORM_PROVIDERS.GOOGLE_GSC ||
    provider === PLATFORM_PROVIDERS.GOOGLE_ADS ||
    provider === PLATFORM_PROVIDERS.GOOGLE_GA4 ||
    provider === PLATFORM_PROVIDERS.GOOGLE_GTM ||
    provider === PLATFORM_PROVIDERS.GOOGLE_YOUTUBE
  )
}

async function callProviderRefresh(
  provider: PlatformProvider,
  refreshTokenPlain: string,
): Promise<RefreshResult> {
  if (isGoogleProvider(provider)) {
    return refreshGoogleToken(refreshTokenPlain, provider)
  }
  if (provider === PLATFORM_PROVIDERS.MICROSOFT_MAIL) {
    return refreshMicrosoftToken(refreshTokenPlain)
  }
  // Phase 18 will add Meta / TikTok refresh
  throw new PlatformTokenRefreshError(
    provider,
    `Token refresh not yet implemented for provider=${provider}`,
  )
}

// ─── DB helpers (package-private for testing) ────────────────────────────────

export async function fetchConnectionRow(
  clientId: string,
  provider: PlatformProvider,
): Promise<PlatformOAuthConnectionRow> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', provider)
    .eq('status', CONNECTION_STATUS.ACTIVE)
    .eq('purpose', 'legacy')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    throw new PlatformConnectionNotFoundError(clientId, provider)
  }

  return data as PlatformOAuthConnectionRow
}

async function persistRefreshedToken(
  connectionId: string,
  refreshed:    RefreshResult,
): Promise<void> {
  const patch: Record<string, string> = {
    access_token_enc: encryptToken(refreshed.accessToken),
    token_expiry:     refreshed.expiresAt.toISOString(),
    last_synced_at:   new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }
  // 提供方轮换了刷新令牌就跟着换 —— 跟 access token 写在同一次更新里，
  // 不留「新的 access 配旧的 refresh」这种半截状态。
  if (refreshed.refreshToken) {
    patch.refresh_token_enc = encryptToken(refreshed.refreshToken)
  }

  const { error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update(patch)
    .eq('id', connectionId)

  if (error) {
    // Non-fatal: caller still gets a valid token.
    console.error('[token-manager] Failed to persist refreshed token:', error.message)
  }
}

/**
 * 刷新失败是不是**临时的**：对方服务器出错（HTTP 5xx）、限流（429）、网络断一下（fetch failed / 连接被重置 / 超时）。
 *
 * 🔴 临时失败绝不能把连接标成 error（2026-11-03 实查）：CTS 的 GA4 在 10-31 刷新时谷歌回了一次 500 internal_failure，
 *    NAL 的 GA4 在 11-02 碰上一次 fetch failed，两条连接都被永久标成 error，之后每天的谷歌数据回拉都直接跳过它们
 *    （GA4 一连几天没数）。同一刷新令牌事后实测换得到访问令牌——令牌是好的，坏的只是那一次请求。
 *    只有对方明确拒绝（invalid_grant 之类的 4xx、缺配置）才是「这条连接真的断了」，那时才标 error。
 */
export function isTransientRefreshFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof PlatformTokenRefreshError) {
    // 对方回了话：只认我们自己拼的开头「Token refresh failed for <平台>: HTTP <状态码>」里的状态码。
    // 🔴 不许在整段错误原文里找字样——对方 400 拒绝的说明里碰巧带 "network" / "HTTP 500"，会把被拒绝的授权误当临时故障，
    //    连接就永远不进 error（魏征补审 P2-1，2026-11-03）。
    const m = /^Token refresh failed for [^:]+: HTTP (\d{3})\b/.exec(message)
    if (m === null) return false
    const status = Number(m[1])
    return status >= 500 || status === 429
  }
  // 请求根本没拿到完整回应（fetch 自己抛的错、回应读到一半断了 / 内容不是 JSON）：只在这种「没拿到回应」的错误上认网络字样
  return (
    err instanceof SyntaxError ||
    /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|terminated|network/i.test(message)
  )
}

async function markConnectionError(connectionId: string, message: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('platform_oauth_connections')
      .update({
        status:        CONNECTION_STATUS.ERROR,
        error_message: message.slice(0, 500),   // guard against very long messages
        updated_at:    new Date().toISOString(),
      })
      .eq('id', connectionId)
  } catch {
    // best-effort — never throw from error-marking
  }
}
// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return a valid plaintext access_token for the given client + provider.
 *
 * Transparently refreshes the token if expired.
 *
 * @throws {PlatformConnectionNotFoundError}  No active connection exists.
 * @throws {PlatformTokenRefreshError}         Refresh call failed (connection marked error unless the failure was transient).
 */
export async function getValidToken(
  clientId: string,
  provider: PlatformProvider,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const row         = await fetchConnectionRow(clientId, provider)
  const accessToken = decryptToken(row.access_token_enc)

  // Fast path — token still valid AND caller hasn't asked us to refresh
  // anyway. Callers pass forceRefresh=true after they catch a 401 on the
  // cached token; Google can invalidate access tokens before token_expiry
  // and the cron logs on 06-27/06-28/06-30 showed exactly that pattern.
  if (!opts?.forceRefresh && !isTokenExpired(row.token_expiry)) {
    return accessToken
  }

  // Slow path — token expired, refresh
  const refreshTokenPlain = decryptToken(row.refresh_token_enc)

  let refreshed: RefreshResult
  try {
    refreshed = await callProviderRefresh(provider, refreshTokenPlain)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 临时失败只抛给调用方（这一轮读不到），不把连接标坏；下一轮会再试
    if (!isTransientRefreshFailure(err)) await markConnectionError(row.id, msg)
    throw err
  }

  await persistRefreshedToken(row.id, refreshed)
  return refreshed.accessToken
}

/**
 * 跟 getValidToken 一样，但认的是**某一条具体的连接**，不是「这个客户这个平台
 * 最新的那条」。
 *
 * 为什么需要：一个客户可以连不止一个邮箱（设置页上就有「再连一个邮箱」）。
 * 按 (客户, 平台) 取令牌永远只会拿到最新连的那一个 —— 较早连的那个邮箱
 * 一封信都读不到，而且不会报错。
 */
export async function getValidTokenForConnection(
  connectionId: string,
  opts?: { forceRefresh?: boolean; markErrorOnFailure?: boolean },
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('status', CONNECTION_STATUS.ACTIVE)
    .eq('purpose', 'legacy')
    .maybeSingle()

  if (error || !data) {
    throw new Error(`找不到这条连接（或已断开）: ${connectionId}`)
  }

  const row = data as PlatformOAuthConnectionRow
  if (!opts?.forceRefresh && !isTokenExpired(row.token_expiry)) {
    return decryptToken(row.access_token_enc)
  }

  let refreshed: RefreshResult
  try {
    refreshed = await callProviderRefresh(row.provider, decryptToken(row.refresh_token_enc))
  } catch (err) {
    // A read-only background reader (the triggered-send shadow run) passes `markErrorOnFailure: false`: a refresh that
    // fails once must not take the mailbox offline for the people who send from it. Every other caller keeps the default.
    if (opts?.markErrorOnFailure !== false && !isTransientRefreshFailure(err)) {
      await markConnectionError(row.id, err instanceof Error ? err.message : String(err))
    }
    throw err
  }

  await persistRefreshedToken(row.id, refreshed)
  return refreshed.accessToken
}
