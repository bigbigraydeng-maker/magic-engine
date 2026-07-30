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

import { createHmac } from 'crypto'

const GRAPH_VERSION = 'v21.0'
const AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

/** Ten minutes is plenty to click through a consent screen, short enough to be useless if leaked. */
const STATE_TTL_MS = 10 * 60 * 1000

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
] as const

export interface VerifiedState {
  clientId: string
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
export function buildState(clientId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ clientId, exp: Date.now() + STATE_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', appSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): VerifiedState | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null

  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = createHmac('sha256', appSecret()).update(payload).digest('base64url')
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

// ─── Consent URL ──────────────────────────────────────────────────────────────

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: META_PAGE_SCOPES.join(','),
    state,
  })
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
  const params = new URLSearchParams({
    client_id: appId(),
    client_secret: appSecret(),
    redirect_uri: redirectUri,
    code,
  })

  try {
    const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`)
    if (!res.ok) return null
    const body = (await res.json()) as { access_token?: string }
    return body.access_token ?? null
  } catch {
    return null
  }
}

/**
 * Short-lived (≈1 hour) → long-lived (≈60 day) user token.
 *
 * Page tokens derived from a long-lived user token do not themselves expire
 * while the grant stands, which is what lets the hourly sync keep working
 * without anyone touching it again.
 */
export async function exchangeForLongLivedToken(shortToken: string): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId(),
    client_secret: appSecret(),
    fb_exchange_token: shortToken,
  })

  try {
    const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`)
    if (!res.ok) return null
    const body = (await res.json()) as { access_token?: string }
    return body.access_token ?? null
  } catch {
    return null
  }
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
