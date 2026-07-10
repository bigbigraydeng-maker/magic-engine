/**
 * Meta token manager — client-scoped Meta access token lookup.
 *
 * SOP declared per-client env naming: META_SYSTEM_USER_TOKEN_<CLIENT_KEY>
 * (e.g. META_SYSTEM_USER_TOKEN_CTS, META_SYSTEM_USER_TOKEN_OZTOP).
 * Previously the code only read the single-tenant META_SYSTEM_USER_TOKEN,
 * so per-client env vars set by PM were never picked up.
 *
 * Lookup order:
 *   1. META_SYSTEM_USER_TOKEN_<CLIENT_KEY>   (per-client, preferred)
 *   2. META_SYSTEM_USER_TOKEN                (legacy single-tenant fallback)
 *   3. null                                  (caller returns graceful 424)
 *
 * CLIENT_KEY comes from clients.slug (uppercased, non-alphanumeric → '_').
 */

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Convert a client slug into an env-safe key.
 *   "cts-tours-nz" → "CTS_TOURS_NZ"
 *   "oztop"        → "OZTOP"
 */
export function slugToEnvKey(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/**
 * Resolve the Meta access token to use for a given client.
 * Returns null when nothing is configured (caller decides how to fail).
 */
export async function getMetaTokenForClient(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('slug')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data?.slug) return process.env.META_SYSTEM_USER_TOKEN ?? null

  const key = slugToEnvKey(data.slug)
  const scoped = process.env[`META_SYSTEM_USER_TOKEN_${key}`]
  if (scoped) return scoped

  return process.env.META_SYSTEM_USER_TOKEN ?? null
}
