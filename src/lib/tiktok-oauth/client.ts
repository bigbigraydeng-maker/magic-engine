/**
 * TikTok OAuth —— 「连接 TikTok」按钮的引擎。
 *
 * 跟 Meta / Google 那两套刻意长得一样(同样的签名 state、同样的形状),三条流程并排能对着读。
 *
 * 跟 Meta 最大的不同:**TikTok 的令牌会过期**。
 * access token 只活 24 小时,refresh token 活一年。所以每次要用之前都得看一眼过没过期,
 * 过了就拿 refresh token 换新的 —— Meta 的页 token 只要授权还在就一直有效,那套「存下来
 * 就不用管」的思路在这里不成立。存过期时间不是留给报表看的,是每次真的要读的。
 *
 * ⚠️ 未过审的应用发出去的片子一律只有作者自己可见(TikTok 官方规定)。
 * 这不是我们能绕的,只能先跑通全流程,等 TikTok 审过再变公开。
 */

import { createHmac } from 'crypto'

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const API_BASE = 'https://open.tiktokapis.com/v2'

/** 十分钟够点完授权,泄漏了也没用。 */
const STATE_TTL_MS = 10 * 60 * 1000

/**
 * 要授权哪些能力。
 * - user.info.basic:拿到账号名字,用来在界面上显示「连的是哪个号」并防误发
 * - video.publish:直接发布(过审后才能公开)
 * - video.upload:退一步的路——传进创作者的草稿箱,由本人在 App 里点最后一下
 * 两个都要:审核通过前用 upload 也能跑通,通过后 publish 才是真自动。
 */
export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.upload'] as const

export interface VerifiedState {
  clientId: string
}

function clientKey(): string {
  const v = process.env.TIKTOK_CLIENT_KEY
  if (!v) throw new Error('TIKTOK_CLIENT_KEY 没配 —— 先在 TikTok 开发者后台建应用')
  return v
}

function clientSecret(): string {
  const v = process.env.TIKTOK_CLIENT_SECRET
  if (!v) throw new Error('TIKTOK_CLIENT_SECRET 没配 —— 先在 TikTok 开发者后台建应用')
  return v
}

// ─── 签名 state ───────────────────────────────────────────────────────────────

/** state 带着「在连哪个客户」,签名防止回来的路上被换成别人的客户 id。 */
export function buildState(clientId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ clientId, exp: Date.now() + STATE_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): VerifiedState | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      clientId?: unknown
      exp?: unknown
    }
    if (typeof data.clientId !== 'string' || typeof data.exp !== 'number') return null
    if (Date.now() > data.exp) return null
    return { clientId: data.clientId }
  } catch {
    return null
  }
}

// ─── 同意页 ───────────────────────────────────────────────────────────────────

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_key: clientKey(),
    scope: TIKTOK_SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

// ─── 换令牌 ───────────────────────────────────────────────────────────────────

export interface TikTokTokens {
  accessToken: string
  refreshToken: string
  /** access token 还能活多少秒(TikTok 给的是 24 小时上下)。 */
  expiresIn: number
  openId: string
  scopes: string[]
}

interface RawTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  open_id?: string
  scope?: string
  error?: string
  error_description?: string
}

function parseTokens(body: RawTokenResponse): TikTokTokens | null {
  if (!body.access_token || !body.refresh_token) return null
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    // 拿不到有效期就按 24 小时算(TikTok 的默认值),别写成「永不过期」骗自己
    expiresIn: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 86400,
    openId: body.open_id ?? '',
    scopes: (body.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}

/** 同意码 → 令牌。失败返回 null,让调用方跳回去说人话,而不是甩个堆栈给点按钮的人。 */
export async function exchangeCode(code: string, redirectUri: string): Promise<TikTokTokens | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey(),
        client_secret: clientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    return parseTokens((await res.json()) as RawTokenResponse)
  } catch {
    return null
  }
}

/** 用 refresh token 换一套新的。TikTok 每次会返回新的 refresh token,必须存回去。 */
export async function refreshTokens(refreshToken: string): Promise<TikTokTokens | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey(),
        client_secret: clientSecret(),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })
    return parseTokens((await res.json()) as RawTokenResponse)
  } catch {
    return null
  }
}

/** 账号显示名 —— 存下来是为了在界面上说清「连的是哪个号」,也做防误发比对。 */
export async function fetchDisplayName(accessToken: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/user/info/?fields=display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const j = (await res.json()) as { data?: { user?: { display_name?: string } } }
    return j.data?.user?.display_name ?? ''
  } catch {
    return ''
  }
}

/**
 * 令牌快过期了就提前换。
 * 留 5 分钟余量:卡着秒数用,发到一半过期就是一次没法解释的失败。
 */
export function needsRefresh(expiry: Date | null | undefined, nowMs: number): boolean {
  if (!expiry) return true
  return expiry.getTime() - nowMs < 5 * 60 * 1000
}
