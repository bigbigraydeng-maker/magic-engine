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
 *   1. META_SYSTEM_USER_TOKEN_<CLIENT_KEY>   (per-client, preferred)
 *   2. META_SYSTEM_USER_TOKEN                (legacy single-tenant fallback)
 *   3. null                                  (caller returns graceful 424)
 *
 * CLIENT_KEY derives from clients.domain (uppercased, non-alphanumeric → '_').
 * The `clients` table has no `slug` column, `domain` is stable + unique per client.
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
 * Resolve the Meta access token to use for a given client.
 * Returns null when nothing is configured (caller decides how to fail).
 */
export async function getMetaTokenForClient(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data?.domain) return process.env.META_SYSTEM_USER_TOKEN ?? null

  const key = domainToEnvKey(data.domain)
  const scoped = process.env[`META_SYSTEM_USER_TOKEN_${key}`]
  if (scoped) return scoped

  return process.env.META_SYSTEM_USER_TOKEN ?? null
}
