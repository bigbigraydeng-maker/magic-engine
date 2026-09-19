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
 * The `clients` table has no `slug` column. `domain` is NOT unique (public
 * self-serve signup writes it), so steps 1–2 only serve the client that owns the
 * key — earliest-created for a domain, sole holder for a Page (AD-SEC-4,
 * rules in token-selection.ts).
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
import {
  domainToEnvKey, pageIdToEnvVar, resolveMetaToken, loadStoredPageToken, type MetaTokenSource,
} from './token-selection'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Lookup rules live in token-selection.ts (no client at import time, so the daily
// todo can reuse them); re-exported here for existing callers.
export { domainToEnvKey, pageIdToEnvVar, type MetaTokenSource }

/**
 * Resolve the Meta access token to use for a given client.
 * Returns null when nothing is configured (caller decides how to fail).
 */
export async function getMetaTokenForClient(clientId: string): Promise<string | null> {
  return (await resolveMetaTokenForClient(clientId))?.token ?? null
}

/** Same lookup as getMetaTokenForClient, plus where the token came from. */
export async function resolveMetaTokenForClient(
  clientId: string,
): Promise<{ token: string; source: MetaTokenSource } | null> {
  return resolveMetaToken(supabaseAdmin, clientId, process.env)
}

/**
 * The Page access token to use for a client's Page, or null when we have none.
 *
 * Preferred source is a stored connection from the "连接 Meta" button: someone
 * with a role on the Page granted consent, and we kept the resulting Page token.
 *
 * WHY THIS COMES FIRST (added 2026-07-31)
 * ---------------------------------------
 * The older path derives a Page token from a *user* token held in an env var.
 * That only works when the identity behind that env var happens to hold a role
 * on the Page — otherwise Meta returns nothing and the sync skips with
 * `no_page_token`, which is precisely how 30 Kiteroa ran for weeks: ads
 * spending, inbox full on Meta's side, zero conversations in ME, and no env var
 * because nobody knew one was owed.
 *
 * The env-var path stays as the fallback so clients configured that way (CTS)
 * keep working untouched.
 */
export async function getStoredPageToken(
  clientId: string,
  pageId: string,
): Promise<string | null> {
  return loadStoredPageToken(supabaseAdmin, clientId, pageId)
}
