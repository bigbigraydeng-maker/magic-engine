/**
 * Which staff-provisioned, client-scoped Meta token (if any) a client may use.
 * No Supabase client is created at import time (callers pass one in), so the
 * daily todo builder can reuse it.
 *
 * WHY (AD-SEC-4 · 2026-09-17)
 * ---------------------------
 * Scoped tokens are keyed by strings a client row carries, not by client id:
 *   META_SYSTEM_USER_TOKEN_<DOMAIN_KEY>  ← clients.domain
 *   META_SYSTEM_USER_TOKEN_PAGE_<id>     ← clients.facebook_page_id
 * `domain` is written by public self-serve signup and the onboarding wizard, so
 * anyone could register with an existing client's domain and be handed that
 * client's token for every Meta call made on their own client. Ownership rules:
 *
 *   domain key → only the EARLIEST-created staff-created client (source ≠
 *                'self_serve') carrying that key (tie: lowest id). Self-serve rows
 *                never own a key and never block the owner, so signing up with
 *                a real (or future) client's domain gets nothing and breaks nothing.
 *                Not "unique or nobody": that would let anyone knock a real client
 *                off its token. Staff-created rows come only from global admins
 *                (POST /api/clients, PATCH /api/clients/[id]); the onboarding
 *                domain route refuses keys that have a configured token.
 *   page key   → only when no other client carries the same Page id. Page ids
 *                are staff-only, and a Page on two clients already breaks
 *                Messenger webhook routing, so there is no legitimate collision.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { decryptToken } from '@/lib/platform-oauth/vocabulary'

export type ScopedTokenSource = 'client_domain' | 'client_page'

/**
 * Which lookup step produced the token. `shared_fallback` can see several
 * clients' ad accounts and Pages, so "this token can read X" proves nothing about
 * X belonging to the client — callers that audit or gate on ownership check this.
 */
export type MetaTokenSource = ScopedTokenSource | 'shared_fallback'

export interface TokenOwnerRow {
  id: string
  domain: string | null
  facebook_page_id: string | null
  created_at: string | null
  /** clients.source — 'fde' (staff-created) | 'self_serve' (public signup). */
  source: string | null
}

/**
 * Convert a client domain into an env-safe key.
 *   "ctstours.co.nz"       → "CTSTOURS_CO_NZ"
 *   "oztopbuildingsupplies.com.au" → "OZTOPBUILDINGSUPPLIES_COM_AU"
 */
export function domainToEnvKey(domain: string): string {
  return domain.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/**
 * Env var name for a Page-scoped token.
 *   "227633594573276" → "META_SYSTEM_USER_TOKEN_PAGE_227633594573276"
 */
export function pageIdToEnvVar(pageId: string): string {
  return `META_SYSTEM_USER_TOKEN_PAGE_${pageId.replace(/[^A-Za-z0-9]/g, '_')}`
}

/** Same truthiness the lookup always used — keys are derived from the raw value. */
const present = (v: string | null | undefined): string | null => (v ? v : null)

/** Earlier created_at first; unknown created_at sorts last; ties by id. */
function isOlder(a: TokenOwnerRow, b: TokenOwnerRow): boolean {
  // Unparseable must not become NaN: NaN compares false both ways, so two rows
  // would each think they are the older one and both get the token.
  const time = (r: TokenOwnerRow) => {
    const t = r.created_at ? Date.parse(r.created_at) : Number.NaN
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  const ta = time(a)
  const tb = time(b)
  if (ta !== tb) return ta < tb
  return a.id < b.id
}

/** Is `client` the owner of its domain key among `peers` (which may include itself)? */
export function ownsDomainKey(client: TokenOwnerRow, peers: TokenOwnerRow[]): boolean {
  const domain = present(client.domain)
  if (!domain || client.source === 'self_serve') return false
  const key = domainToEnvKey(domain)
  return !peers.some((p) => {
    if (p.id === client.id || p.source === 'self_serve') return false
    const other = present(p.domain)
    return other !== null && domainToEnvKey(other) === key && isOlder(p, client)
  })
}

/** Does any OTHER client carry the same page env key? */
export function pageKeyShared(client: TokenOwnerRow, peers: TokenOwnerRow[]): boolean {
  const page = present(client.facebook_page_id)
  if (!page) return false
  const key = pageIdToEnvVar(page)
  return peers.some((p) => {
    if (p.id === client.id) return false
    const other = present(p.facebook_page_id)
    return other !== null && pageIdToEnvVar(other) === key
  })
}

/** Steps 1–2 of the token lookup, given every client carrying a domain or Page id. */
export function pickScopedMetaToken(
  client: TokenOwnerRow,
  peers: TokenOwnerRow[],
  env: Record<string, string | undefined>,
): { token: string; source: ScopedTokenSource } | null {
  const domain = present(client.domain)
  if (domain) {
    const scoped = env[`META_SYSTEM_USER_TOKEN_${domainToEnvKey(domain)}`]
    if (scoped && ownsDomainKey(client, peers)) return { token: scoped, source: 'client_domain' }
  }

  const page = present(client.facebook_page_id)
  if (page) {
    const byPage = env[pageIdToEnvVar(page)]
    if (byPage && !pageKeyShared(client, peers)) return { token: byPage, source: 'client_page' }
  }

  return null
}

/** Is any scoped env token configured for this client's keys? (Ownership not checked.) */
export function hasScopedEnvToken(client: TokenOwnerRow, env: Record<string, string | undefined>): boolean {
  const domain = present(client.domain)
  const page = present(client.facebook_page_id)
  return Boolean(
    (domain && env[`META_SYSTEM_USER_TOKEN_${domainToEnvKey(domain)}`]) ||
      (page && env[pageIdToEnvVar(page)]),
  )
}

/**
 * Every client that carries a domain or a Page id — the set ownership is judged
 * against. Returns null on any read error (callers then hand out no scoped token).
 * Read in full: a truncated list would silently hide the older owner.
 */
export async function loadTokenOwnerPeers(supabase: SupabaseClient): Promise<TokenOwnerRow[] | null> {
  try {
    return await fetchAll<TokenOwnerRow>((from, to) =>
      supabase
        .from('clients')
        .select('id, domain, facebook_page_id, created_at, source')
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (err) {
    console.error('[token-selection] could not read client domains/pages:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Full lookup: owned scoped token (steps 1–2) → shared META_SYSTEM_USER_TOKEN → null.
 * token-manager wraps this with its own client; the daily todo passes its own.
 */
export async function resolveMetaToken(
  supabase: SupabaseClient,
  clientId: string,
  env: Record<string, string | undefined>,
): Promise<{ token: string; source: MetaTokenSource } | null> {
  const res = await resolveMetaTokenDetailed(supabase, clientId, env)
  return res === 'ownership_unknown' ? null : res
}

/**
 * Same as resolveMetaToken, but says when there is no token because the key's
 * ownership could not be read — gates treat that as a failed check, not as
 * "this client has no token".
 */
export async function resolveMetaTokenDetailed(
  supabase: SupabaseClient,
  clientId: string,
  env: Record<string, string | undefined>,
): Promise<{ token: string; source: MetaTokenSource } | null | 'ownership_unknown'> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, domain, facebook_page_id, created_at, source')
    .eq('id', clientId)
    .maybeSingle()

  const fallbackToken = env.META_SYSTEM_USER_TOKEN
  const fallback = fallbackToken ? { token: fallbackToken, source: 'shared_fallback' as const } : null
  if (error || !data) return fallback

  // The ownership read is skipped when no scoped env var exists for this client's keys anyway.
  const row = data as TokenOwnerRow
  if (hasScopedEnvToken(row, env)) {
    const peers = await loadTokenOwnerPeers(supabase)
    // Cannot tell who owns the key → no token at all. Falling back to the shared
    // token here would silently swap a client onto a token that sees MORE clients.
    if (peers === null) return 'ownership_unknown'
    const scoped = pickScopedMetaToken(row, peers, env)
    if (scoped) return scoped
  }
  return fallback
}

/**
 * Decrypted Page token stored by the "连接 Meta" OAuth flow for (client, Page),
 * or null. See token-manager.getStoredPageToken for why it is preferred.
 */
export async function loadStoredPageToken(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('platform_oauth_connections')
    .select('access_token_enc')
    .eq('client_id', clientId)
    .eq('provider', 'meta')
    .eq('account_id', pageId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const enc = (data as { access_token_enc?: unknown }).access_token_enc
  if (typeof enc !== 'string' || enc.length === 0) return null

  // A connection row that cannot be decrypted is worse than none: returning
  // junk would make Meta reject every call with an opaque error.
  try {
    return decryptToken(enc)
  } catch {
    return null
  }
}
