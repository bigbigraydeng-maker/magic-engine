/**
 * Meta (Facebook) OAuth client — the "连接 Meta" button's engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reading a client's Page inbox needs a Page access token, and Meta only hands
 * one to an identity that holds a role on that Page. Until now the only way to
 * supply that identity was an env var per Page
 * (META_SYSTEM_USER_TOKEN_PAGE_<id>) set by hand in Render — which CLAUDE.md
 * forbids for FDE configuration, and which nobody remembered to do.
 *
 * 30 Kiteroa is the case in point: Page bound, ads spending, hourly sync
 * skipping with `no_page_token`, zero conversations, because that env var was
 * never created. One click here replaces that step for every future client.
 *
 * Mirrors src/lib/google-oauth/client.ts deliberately — same signed-state
 * scheme, same shape — so the two flows stay readable side by side.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const GRAPH_VERSION = 'v21.0'
const AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

/** Ten minutes is plenty to click through a consent screen, short enough to be useless if leaked. */
export const META_STATE_TTL_SECS = 600
export const META_STATE_COOKIE = 'meta_page_oauth_state'
export const META_STATE_PATH = '/api/auth/facebook'

/**
 * What we ask the user to grant.
 *
 * `pages_show_list` is what makes the Page appear in /me/accounts at all —
 * without it the sync sees an empty list and reports `no_page_token` even
 * though the human can read the inbox in Business Suite. That mismatch is
 * exactly the bug this flow exists to end, so it is not optional.
 */
export const META_PAGE_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_read_engagement',
  // 读**别人写的**评论必须有这一条 —— pages_read_engagement 只够读我们自己发的
  // 东西。没有它,评论自动回复对每个帖子都拿到 Graph #10,客人的提问系统一条
  // 都看不见(2026-08-15 生产日志实测)。已经连过的客户要重新点一次「连接 Meta」。
  'pages_read_user_content',
  // 发内容到主页(Reel/贴文)必须有这一条。没有它,存下来的 token 只能读不能发——
  // 2026-08-04 讲课片发布就卡在「读得到、发不出去」。
  // 已经连过的客户(CTS/Roman)只做收件箱同步,不受影响;要发内容的客户重新点一次「连接 Meta」即可。
  'pages_manage_posts',
  // 读即时表单里的潜在客户必须有这一条。没有它,`meta-leads-sync` 每小时照跑,
  // 但 leadgen_forms 一个表单都列不出来 —— 2026-08-21 起 4 个客户(CTS/Roman/
  // Magic Lab Class/NZCPE)全线断供 9 天,CTS 一家就漏掉 45 条线索、NZ$736 白花。
  // `src/lib/meta/lead-forms.ts` 的注释 2026-07-30 就预见过「不保证已经有」,
  // 但这条权限一直没进过本清单,所以点「连接 Meta」永远修不好线索同步。
  // 已经连过的客户要重新点一次「连接 Meta」才能拿到它。
  'leads_retrieval',
  // 列出主页的即时表单必须有这一条。`lead-forms.ts` 的注释说 `pages_show_list`
  // 或 `pages_manage_ads` 二选一即可 —— **那句是错的**。2026-08-30 加完
  // leads_retrieval 重新授权后，生产 cron 报的仍是一字不变的
  // `(#200) Requires pages_manage_ads permission to manage the object`,
  // 而当时 token 已经带着 pages_show_list。Graph 要的就是这一条,没有替代品。
  // 教训:注释与生产报错冲突时,信报错。
  'pages_manage_ads',
  // 回复 / 隐藏主页上的评论必须有这一条 —— pages_read_engagement 只够读。
  // 没有它,评论自动回复读得到评论,但每一条回复都被 Meta 拒掉(2026-10-07 在 CTS
  // 存下来的主页 token 上实测,它就没有这一条)。已经连过的客户要重新点一次「连接 Meta」。
  // 加权限不会弄死已有的 Meta 连接:Meta 的主页 token 刷新时不重放 scope 清单
  // (见 src/lib/platform-oauth/connection-health.ts 的 SCOPE_REPLAYED_ON_REFRESH,META 在那里是 null)。
  'pages_manage_engagement',
] as const

/**
 * The one Meta permission that lets a stored Page token publish (Reel/贴文) —
 * everything else in META_PAGE_SCOPES is read/inbox. Publishing readiness keys
 * on this single name, so it lives here as the shared source of truth rather
 * than a string literal repeated across the callback and the settings UI.
 */
export const META_PUBLISH_SCOPE = 'pages_manage_posts'

/**
 * Why a connect flow was started. `publishing` marks the "Reauthorize Meta
 * Publishing" path so the callback can fail closed with a publishing-specific,
 * actionable message when Meta declines `pages_manage_posts`. Absent = the
 * existing inbox-sync connect, whose outcomes are unchanged.
 */
export type MetaConnectIntent = 'publishing'

export interface VerifiedState {
  clientId: string
  userId: string
  targetPageId: string | null
  nonce: string
  intent?: MetaConnectIntent
}

function appSecret(): string {
  const secret = process.env.FACEBOOK_APP_SECRET
  if (!secret) throw new Error('FACEBOOK_APP_SECRET is not configured')
  return secret
}

function appId(): string {
  const id = process.env.FACEBOOK_APP_ID
  if (!id) throw new Error('FACEBOOK_APP_ID is not configured')
  return id
}

// ─── Signed state ─────────────────────────────────────────────────────────────

/**
 * The state parameter carries which client we are connecting, signed so a
 * caller cannot swap in another client's id on the way back and attach their
 * token to someone else's account.
 */
export function buildState(input: Omit<VerifiedState, 'nonce'>): string {
  const payload = Buffer.from(
    JSON.stringify({ ...input, nonce: randomBytes(16).toString('hex'), exp: Date.now() + META_STATE_TTL_SECS * 1000 }),
  ).toString('base64url')
  const sig = createHmac('sha256', appSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): VerifiedState | null {
  try {
    const dot = state.lastIndexOf('.')
    if (dot === -1) return null
    const payload = state.slice(0, dot)
    const sig = Buffer.from(state.slice(dot + 1), 'utf8')
    const expected = Buffer.from(createHmac('sha256', appSecret()).update(payload).digest('base64url'), 'utf8')
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      clientId?: unknown
      userId?: unknown
      targetPageId?: unknown
      nonce?: unknown
      exp?: unknown
      intent?: unknown
    }
    if (typeof data.clientId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.clientId)) return null
    if (typeof data.userId !== 'string' || !data.userId) return null
    if (typeof data.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(data.nonce)) return null
    if (data.targetPageId !== null && (typeof data.targetPageId !== 'string' || !/^\d+$/.test(data.targetPageId))) return null
    if (typeof data.exp !== 'number' || !Number.isFinite(data.exp) || Date.now() >= data.exp || data.exp > Date.now() + META_STATE_TTL_SECS * 1000) return null
    if (data.intent !== undefined && data.intent !== 'publishing') return null
    if (data.intent === 'publishing' && !data.targetPageId) return null
    return { clientId: data.clientId, userId: data.userId, targetPageId: data.targetPageId,
      nonce: data.nonce, ...(data.intent ? { intent: data.intent } : {}) }
  } catch {
    return null
  }
}

// ─── Consent URL ──────────────────────────────────────────────────────────────

/**
 * @param rerequest When true, adds `auth_type=rerequest`. Meta suppresses a
 *   permission the user already declined once — the consent screen simply omits
 *   it — so a plain re-consent can never recover `pages_manage_posts`. Only
 *   `rerequest` forces Meta to show the declined permission again. Reserved for
 *   the publishing reauthorisation path; the ordinary connect never sets it.
 */
export function buildAuthUrl(state: string, redirectUri: string, rerequest = false): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: META_PAGE_SCOPES.join(','),
    state,
  })
  if (rerequest) params.set('auth_type', 'rerequest')
  return `${AUTH_URL}?${params.toString()}`
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export interface MetaPageToken {
  pageId: string
  pageName: string
  pageToken: string
}

/**
 * Consent code → short-lived user token.
 * Returns null rather than throwing so the callback can redirect with a
 * readable message instead of showing a stack trace to whoever clicked.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  return (await exchangeMetaTokenFields({ redirect_uri:redirectUri,code }))?.token ?? null
}

/**
 * Short-lived (≈1 hour) → long-lived (≈60 day) user token.
 *
 * Page tokens derived from a long-lived user token do not themselves expire
 * while the grant stands, which is what lets the hourly sync keep working
 * without anyone touching it again.
 */
export async function exchangeForLongLivedToken(shortToken: string): Promise<string | null> {
  return (await exchangeMetaTokenFields({ grant_type:'fb_exchange_token',fb_exchange_token:shortToken }))?.token ?? null
}

/**
 * Every Page this token holds a role on, each with its own Page token.
 * Empty array means the grant carried no Pages — worth saying out loud in the
 * UI, because it looks identical to success otherwise.
 */
export async function listPagesWithTokens(userToken: string): Promise<MetaPageToken[]> {
  const url = `${GRAPH_BASE}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`

  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const body = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; access_token?: string }>
    }
    return (body.data ?? [])
      .filter(
        (p): p is { id: string; name?: string; access_token: string } =>
          typeof p.id === 'string' && typeof p.access_token === 'string',
      )
      .map((p) => ({ pageId: p.id, pageName: p.name ?? p.id, pageToken: p.access_token }))
  } catch {
    return []
  }
}

/**
 * The scopes Meta *actually granted* for this token, straight from the provider.
 *
 * The user can approve a subset on the consent screen — decline publishing,
 * keep inbox — and the only authoritative record of what came back is
 * `/me/permissions`, where each row carries `status: granted | declined`. We
 * return the granted names only.
 *
 * WHY THIS MATTERS: the callback previously stored the *requested* scope
 * constant, which records a grant the user may never have given — a token that
 * cannot publish looks publish-ready in the database. Reading the granted set
 * here is what lets persistence stay honest and publishing readiness fail
 * closed.
 *
 * Returns `null` (not `[]`) when the permissions call itself fails, so the
 * caller can tell "provider says zero permissions" apart from "we could not
 * ask" and avoid clobbering a good connection's scopes on a transient error.
 */
export async function listGrantedScopes(userToken: string): Promise<string[] | null> {
  const url = `${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(userToken)}`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = (await res.json()) as {
      data?: Array<{ permission?: string; status?: string }>
    }
    if (!Array.isArray(body.data)) return null
    return body.data
      .filter(
        (p): p is { permission: string; status: string } =>
          typeof p.permission === 'string' && p.status === 'granted',
      )
      .map((p) => p.permission)
  } catch {
    return null
  }
}

/** Metadata-preserving exchange for new consent purposes. Existing Page callers keep their contract. */
export async function exchangeMetaTokenFields(params: Record<string,string>, version=GRAPH_VERSION): Promise<{ token:string; seconds:number|null } | null> {
  if (!/^v\d+\.0$/.test(version)) return null
  const query=new URLSearchParams({ client_id:appId(),client_secret:appSecret(),...params })
  try {
    const res=await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${query}`,{
      method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      // Never log the query (carries client_secret) or the body (may echo request params) — only
      // the status, so a 2026-09-21 production mystery (both exchanges succeeded with a token but
      // neither had a usable expires_in) doesn't repeat as another unexplained failure.
      console.warn('[meta-oauth] token exchange non-OK response',{ version,grantType:params.grant_type ?? 'authorization_code',status:res.status })
      return null
    }
    const body=await res.json() as { access_token?:unknown; expires_in?:unknown }
    if(typeof body.access_token!=='string') {
      console.warn('[meta-oauth] token exchange missing access_token',{ version,grantType:params.grant_type ?? 'authorization_code',responseKeys:Object.keys(body) })
      return null
    }
    const seconds=Number(body.expires_in)
    // Meta returns expires_in:0 to mean "this token does not expire" (documented for some
    // long-lived exchanges) — that is a real signal, not a missing value, so 0 must pass through
    // rather than collapse to null alongside genuinely absent/invalid values.
    const usable=Number.isFinite(seconds) && seconds>=0
    if(!usable) {
      console.warn('[meta-oauth] token exchange expires_in unusable',{ version,grantType:params.grant_type ?? 'authorization_code',
        responseKeys:Object.keys(body),hasExpiresInKey:'expires_in' in body,expiresInType:typeof body.expires_in,expiresInRaw:body.expires_in })
    }
    return { token:body.access_token,seconds:usable ? seconds : null }
  } catch { return null }
}
