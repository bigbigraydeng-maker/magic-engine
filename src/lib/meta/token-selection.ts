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
 *
 * `client_db`: the token was stored in platform_oauth_connections with
 * purpose='meta_client_token' — the preferred path after the env-var migration.
 */
export type MetaTokenSource = 'client_db' | ScopedTokenSource | 'shared_fallback'

export interface TokenOwnerRow {
  id: string
  domain: string | null
  facebook_page_id: string | null
  created_at: string | null
  /** clients.source — 'fde' (staff-created) | 'self_serve' (public signup). */
  source: string | null
  /** clients.name — only populated/used for the cron route's legacy per-name key. */
  name?: string | null
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

/**
 * Generic ownership rule: earliest-created, non-self_serve row wins whatever key
 * `keyOf` extracts. `ownsDomainKey` below is `keyOf = domain`; the cron route's
 * legacy per-name Meta token reuses this for `keyOf = name` — `clients.name` is
 * exactly as self-serve-writable and non-unique as `domain`, so it needs the
 * same rule rather than a hand-rolled copy.
 */
export function ownsKey(
  client: TokenOwnerRow,
  peers: TokenOwnerRow[],
  keyOf: (row: TokenOwnerRow) => string | null,
): boolean {
  const key = keyOf(client)
  if (!key || client.source === 'self_serve') return false
  return !peers.some((p) => {
    if (p.id === client.id || p.source === 'self_serve') return false
    return keyOf(p) === key && isOlder(p, client)
  })
}

/** Is `client` the owner of its domain key among `peers` (which may include itself)? */
export function ownsDomainKey(client: TokenOwnerRow, peers: TokenOwnerRow[]): boolean {
  return ownsKey(client, peers, (r) => {
    const d = present(r.domain)
    return d ? domainToEnvKey(d) : null
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
        .select('id, name, domain, facebook_page_id, created_at, source')
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
  preloadedPeers?: TokenOwnerRow[] | null,
): Promise<{ token: string; source: MetaTokenSource } | null> {
  const res = await resolveMetaTokenDetailed(supabase, clientId, env, preloadedPeers)
  return res === 'ownership_unknown' ? null : res
}

/**
 * Same as resolveMetaToken, but says when there is no token because the key's
 * ownership could not be read — gates treat that as a failed check, not as
 * "this client has no token".
 *
 * `preloadedPeers`: pass an already-loaded `loadTokenOwnerPeers` result (or its
 * `null` failure) to skip this call's own peer scan — a caller resolving many
 * clients in one run (e.g. a cron) should load the ownership snapshot ONCE and
 * reuse it, rather than have every scoped-token client repeat a full paginated
 * `clients` scan (chatgpt-codex-connector review, 2026-09-21). Omit it (the
 * default) to keep the old self-contained behavior.
 */
export async function resolveMetaTokenDetailed(
  supabase: SupabaseClient,
  clientId: string,
  env: Record<string, string | undefined>,
  preloadedPeers?: TokenOwnerRow[] | null,
): Promise<{ token: string; source: MetaTokenSource } | null | 'ownership_unknown'> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, domain, facebook_page_id, created_at, source')
    .eq('id', clientId)
    .maybeSingle()

  const fallbackToken = env.META_SYSTEM_USER_TOKEN
  const fallback = fallbackToken ? { token: fallbackToken, source: 'shared_fallback' as const } : null
  // A read ERROR is not the same as "this client doesn't exist" (`!data`, no
  // error): the row might carry a domain/Page key this client owns, we just
  // couldn't check. Falling back to the shared token here would swap that
  // client onto a token that sees MORE clients than intended — the exact
  // failure mode the peers-read-error branch below already fails closed on
  // (chatgpt-codex-connector review, 2026-09-21).
  if (error) return 'ownership_unknown'
  if (!data) return fallback

  // ── Step 0 (preferred): DB-stored per-client token ──────────────────────
  // After the env-var migration, per-client tokens live in
  // platform_oauth_connections with purpose='meta_client_token'. This is
  // checked FIRST so migrated clients use the DB path immediately; env vars
  // become a legacy fallback that disappears once Render vars are cleaned up.
  const dbToken = await loadStoredClientMetaToken(supabase, clientId)
  if (dbToken) return { token: dbToken, source: 'client_db' }

  // ── Steps 1–2 (legacy): scoped env vars ─────────────────────────────────
  // The ownership read is skipped when no scoped env var exists for this client's keys anyway.
  const row = data as TokenOwnerRow
  if (hasScopedEnvToken(row, env)) {
    const peers = preloadedPeers !== undefined ? preloadedPeers : await loadTokenOwnerPeers(supabase)
    // Cannot tell who owns the key → no token at all. Falling back to the shared
    // token here would silently swap a client onto a token that sees MORE clients.
    if (peers === null) return 'ownership_unknown'
    const scoped = pickScopedMetaToken(row, peers, env)
    if (scoped) return scoped
  }
  return fallback
}

/**
 * Per-client Meta token stored in platform_oauth_connections
 * (purpose='meta_client_token'). This is the preferred lookup path after the
 * env-var migration — it replaces META_SYSTEM_USER_TOKEN_<DOMAIN> and
 * META_SYSTEM_USER_TOKEN_PAGE_<id> env vars.
 *
 * Returns the decrypted access token or null.
 */
export async function loadStoredClientMetaToken(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('platform_oauth_connections')
    .select('access_token_enc, token_expiry')
    .eq('client_id', clientId)
    .eq('provider', 'meta')
    .eq('purpose', 'meta_client_token')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const enc = (data as { access_token_enc?: unknown }).access_token_enc
  if (typeof enc !== 'string' || enc.length === 0) return null

  try {
    return decryptToken(enc)
  } catch {
    return null
  }
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
