/**
 * Meta token manager — client-scoped Meta access token lookup.
 *
 * SOP declared per-client env naming: META_SYSTEM_USER_TOKEN_<CLIENT_KEY>
 * (e.g. META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ).
 * Previously the code only read the single-tenant META_SYSTEM_USER_TOKEN,
 * so per-client env vars set by PM were never picked up.
 *
 * The stored value is any Meta access token that has ads_management scope:
 *   - System User Token (from Business Manager)   — long-lived, preferred
 *   - User Access Token (from Graph API Explorer) — 60-day expire, fallback
 *     for clients on an individual ad account (no BM, e.g. CTS)
 *
 * Lookup order:
 *   1. META_SYSTEM_USER_TOKEN_<CLIENT_KEY>          (per-client by domain, preferred)
 *   2. META_SYSTEM_USER_TOKEN_PAGE_<FACEBOOK_PAGE_ID>  (per-client by Page — see below)
 *   3. META_SYSTEM_USER_TOKEN                       (legacy single-tenant fallback)
 *   4. null                                         (caller returns graceful 424)
 *
 * CLIENT_KEY derives from clients.domain (uppercased, non-alphanumeric → '_').
 * The `clients` table has no `slug` column, `domain` is stable + unique per client.
 *
 * WHY THE PAGE-KEYED LOOKUP (added 2026-07-29)
 * --------------------------------------------
 * Some clients legitimately have no `domain` — e.g. "30 Kiteroa Rothesay Bay"
 * is a single property campaign, not a business with a website. Those clients
 * fell straight through to the shared fallback token, which may not carry the
 * scopes their Page needs (this is exactly why Messenger sync returned zero
 * conversations for 30 Kiteroa while its inbox held real buyer threads).
 *
 * Setting a placeholder `domain` just to key a token is NOT an option: several
 * weekly crons select `WHERE domain IS NOT NULL` (keyword-snapshots-weekly,
 * flywheel-seo-weekly), so a fake domain would silently enrol the client in
 * paid DataForSEO keyword scans it never bought.
 *
 * Keying off `facebook_page_id` avoids both problems: no schema change, no
 * cron side effects, and the token is scoped to exactly the Page it serves.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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

/**
 * Resolve the Meta access token to use for a given client.
 * Returns null when nothing is configured (caller decides how to fail).
 */
export async function getMetaTokenForClient(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('domain, facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()

  const fallback = process.env.META_SYSTEM_USER_TOKEN ?? null
  if (error || !data) return fallback

  // 1. Per-client by domain — the original, most specific key.
  if (data.domain) {
    const scoped = process.env[`META_SYSTEM_USER_TOKEN_${domainToEnvKey(data.domain)}`]
    if (scoped) return scoped
  }

  // 2. Per-client by Page — for clients with no domain, or whose Page needs a
  //    token with different scopes than the domain-level one.
  if (data.facebook_page_id) {
    const byPage = process.env[pageIdToEnvVar(data.facebook_page_id)]
    if (byPage) return byPage
  }

  // 3. Shared fallback.
  return fallback
}
