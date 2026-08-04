/**
 * Resolve which GBP location a client's posts should go to.
 *
 * The OAuth callback stores the ACCOUNT (accounts/{id}) but not the location —
 * the location picker was deferred when the flow was built. Posting needs the
 * full `accounts/{a}/locations/{l}` resource name, so this module resolves it
 * once and caches it on `platform_oauth_connections.location_name`.
 *
 * MATCHING IS DELIBERATELY STRICT
 * -------------------------------
 * Posting to the wrong location publishes a client's content on someone else's
 * storefront. When the match is ambiguous this returns a typed failure and the
 * caller surfaces "needs a human to pick" — it never guesses.
 *
 * Two Google APIs are involved (Google never migrated posts off v4):
 *   - list locations: mybusinessbusinessinformation.googleapis.com/v1
 *   - create posts:   mybusiness.googleapis.com/v4
 * v1 returns `name: "locations/{id}"` — the v4 post path needs the account
 * prefix, hence composeLocationResource().
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getGbpAccessToken, type GbpAuthFailure } from './auth'

const BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const LOCATION_READ_MASK = 'name,title,websiteUri'

export interface GbpLocationCandidate {
  /** v1 resource name, e.g. "locations/12345" */
  name: string
  title: string | null
  websiteUri: string | null
}

export type GbpLocationFailure =
  | GbpAuthFailure
  | 'api_failed'          // Google rejected the list call (API not enabled / no access)
  | 'no_locations'        // account has zero locations
  | 'ambiguous'           // several locations and none matches the client
  | 'taken_by_other'      // the matched storefront already belongs to another ME client

export type GbpLocationResult =
  | { ok: true; locationName: string; cached: boolean }
  | { ok: false; reason: GbpLocationFailure; candidates?: GbpLocationCandidate[] }

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** "https://www.ctstours.co.nz/x" → "ctstours.co.nz" */
export function hostRoot(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim()
}

const normaliseName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * v1 `locations/{id}` + `accounts/{a}` → `accounts/{a}/locations/{id}`.
 * Already-qualified names pass through unchanged.
 */
export function composeLocationResource(accountId: string, locationName: string): string {
  if (locationName.startsWith('accounts/')) return locationName
  const bare = locationName.replace(/^locations\//, '')
  return `${accountId.replace(/\/$/, '')}/locations/${bare}`
}

/**
 * Pick the client's own location out of the account's list.
 *
 * Order: website host match → exact title match → single location fallback.
 * Anything else is ambiguous (caller must ask a human).
 *
 * Note on the host rule: several locations sharing the client's website host
 * are all branches of the SAME business, so taking the first is safe — the
 * failure mode this whole module guards against is posting to a DIFFERENT
 * business, which a host match rules out. A title match, by contrast, must be
 * unique: two different businesses can carry the same trading name.
 */
export function pickClientLocation(
  candidates: GbpLocationCandidate[],
  client: { domain: string | null; name: string },
): { match: GbpLocationCandidate | null; reason?: 'no_locations' | 'ambiguous' } {
  if (candidates.length === 0) return { match: null, reason: 'no_locations' }

  const clientHost = hostRoot(client.domain)
  if (clientHost) {
    const byHost = candidates.filter(c => hostRoot(c.websiteUri) === clientHost)
    if (byHost.length === 1) return { match: byHost[0] }
  }

  const clientName = normaliseName(client.name)
  if (clientName) {
    const byName = candidates.filter(c => normaliseName(c.title ?? '') === clientName)
    if (byName.length === 1) return { match: byName[0] }
  }

  // Single-location fallback, but ONLY without counter-evidence.
  //
  // 魏征 🔴1: CTS and oztop are authorised from the SAME Google account. If
  // that account happens to expose one location when oztop connects, a naive
  // "only one, take it" would bind oztop's weekly posts to CTS's storefront.
  // So the lone candidate must not visibly belong to someone else: either it
  // carries no website at all, or its website is the client's own.
  if (candidates.length === 1) {
    const only = candidates[0]
    const onlyHost = hostRoot(only.websiteUri)
    if (!onlyHost || (clientHost && onlyHost === clientHost)) return { match: only }
    return { match: null, reason: 'ambiguous' }
  }

  return { match: null, reason: 'ambiguous' }
}

// ── Orchestration ───────────────────────────────────────────────────────────────

export async function listGbpLocations(
  accountId: string,
  accessToken: string,
): Promise<GbpLocationCandidate[] | null> {
  const all: GbpLocationCandidate[] = []
  let pageToken: string | undefined
  // Paging matters for correctness, not just completeness: a truncated list
  // can make a genuinely ambiguous account look like it has one clear match.
  for (let page = 0; page < 10; page++) {
    const url =
      `${BUSINESS_INFO_API}/${accountId}/locations?readMask=${LOCATION_READ_MASK}&pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    try {
      // Hard timeout: without it a hung Google call leaves the user staring at
      // a blank OAuth callback, cookie uncleared, redirect never reached.
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)')
        console.error('[gbp/location] list failed:', res.status, body.slice(0, 300))
        return null
      }
      const json = (await res.json()) as {
        locations?: GbpLocationCandidate[]
        nextPageToken?: string
      }
      all.push(...(json.locations ?? []))
      if (!json.nextPageToken) return all
      pageToken = json.nextPageToken
    } catch (err) {
      console.error('[gbp/location] list call failed:', err instanceof Error ? err.message : err)
      return null
    }
  }
  return all
}

/**
 * The client's `accounts/{a}/locations/{l}`, resolving + caching on first use.
 * Pass `force` to re-resolve (e.g. after the client adds/renames a location).
 */
export async function resolveGbpLocation(
  client: { id: string; name: string; domain: string | null },
  options: { force?: boolean } = {},
): Promise<GbpLocationResult> {
  const auth = await getGbpAccessToken(client.id)
  if (!auth.ok) return { ok: false, reason: auth.reason }

  if (!options.force && auth.connection.location_name) {
    return { ok: true, locationName: auth.connection.location_name, cached: true }
  }

  const candidates = await listGbpLocations(auth.connection.account_id, auth.accessToken)
  if (candidates === null) return { ok: false, reason: 'api_failed' }

  const { match, reason } = pickClientLocation(candidates, client)
  if (!match) {
    return { ok: false, reason: reason ?? 'ambiguous', candidates }
  }

  const locationName = composeLocationResource(auth.connection.account_id, match.name)

  // Second guard on the same hazard (魏征 🔴1): several ME clients are
  // authorised from one Google account, so a storefront already claimed by
  // another client must never be re-used — that would publish two clients'
  // content onto one business page.
  const { data: clash } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id')
    .eq('provider', 'google_gbp')
    .eq('location_name', locationName)
    .neq('client_id', client.id)
    .limit(1)

  if ((clash ?? []).length > 0) {
    console.error(
      `[gbp/location] ${locationName} is already bound to another client — refusing to share it`,
    )
    return { ok: false, reason: 'taken_by_other', candidates }
  }

  await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ location_name: locationName, updated_at: new Date().toISOString() })
    .eq('id', auth.connection.id)

  return { ok: true, locationName, cached: false }
}

/**
 * Bind a specific storefront chosen by a human (Settings picker).
 * Same cross-client guard as the automatic path.
 */
export async function setGbpLocation(
  clientId: string,
  locationName: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_connected' | 'taken_by_other' | 'invalid' }> {
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(locationName)) {
    return { ok: false, reason: 'invalid' }
  }

  const { data: conn } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'google_gbp')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!conn) return { ok: false, reason: 'not_connected' }

  const { data: clash } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id')
    .eq('provider', 'google_gbp')
    .eq('location_name', locationName)
    .neq('client_id', clientId)
    .limit(1)

  if ((clash ?? []).length > 0) return { ok: false, reason: 'taken_by_other' }

  await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ location_name: locationName, updated_at: new Date().toISOString() })
    .eq('id', (conn as { id: string }).id)

  return { ok: true }
}
