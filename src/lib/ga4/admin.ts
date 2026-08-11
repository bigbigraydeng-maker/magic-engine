/**
 * GA4 Admin API — list the properties a connected Google account can see.
 *
 * Separate from ga4/client.ts (that one is the Data API — pulling traffic
 * numbers for an already-known propertyId). This module answers a different
 * question: "which properties does this OAuth grant even have access to?" —
 * used once, right after the merged Google OAuth callback, to populate the
 * "pick your GA4 property" selector (docs/specs/
 * 2026-08-11-onboarding-integrations-unify-v1.md §2.1).
 *
 * Deliberately NOT reusing gbp/location.ts's cross-client-exclusivity guard:
 * a GA4 property visible to two different ME clients (e.g. shared agency
 * access) is a normal business-structure fact, not a data-integrity risk the
 * way two clients posting to the same GBP storefront would be. See spec §2.4.
 */

const GA4_ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta'

export interface Ga4PropertyCandidate {
  /** e.g. "properties/123456789" */
  property: string
  displayName: string
}

export type Ga4ListFailure = 'api_failed'

export type Ga4ListResult =
  | { ok: true; properties: Ga4PropertyCandidate[] }
  | { ok: false; reason: Ga4ListFailure }

interface AccountSummary {
  propertySummaries?: Array<{ property: string; displayName: string }>
}

/**
 * Lists every GA4 property the access token's Google account can see,
 * across all of that account's GA4 accounts (accountSummaries already
 * flattens accounts → properties in one paginated call).
 *
 * Returns `{ ok: false }` only on a genuine API failure (network error,
 * non-2xx response) — a real empty result set is `{ ok: true, properties: [] }`.
 * Callers must not conflate the two: "the account has zero properties" is a
 * normal, expected state for a customer who's never set up GA4; "the API
 * call failed" means something is actually broken and needs surfacing, not
 * silently treating like the customer just doesn't have GA4 (see spec §2.6).
 */
export async function listGa4Properties(accessToken: string): Promise<Ga4ListResult> {
  const properties: Ga4PropertyCandidate[] = []
  let pageToken: string | undefined

  for (let page = 0; page < 10; page++) {
    const url =
      `${GA4_ADMIN_API}/accountSummaries?pageSize=200` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)')
        console.error('[ga4/admin] accountSummaries failed:', res.status, body.slice(0, 300))
        return { ok: false, reason: 'api_failed' }
      }
      const json = (await res.json()) as {
        accountSummaries?: AccountSummary[]
        nextPageToken?: string
      }
      for (const account of json.accountSummaries ?? []) {
        for (const prop of account.propertySummaries ?? []) {
          properties.push({ property: prop.property, displayName: prop.displayName })
        }
      }
      if (!json.nextPageToken) return { ok: true, properties }
      pageToken = json.nextPageToken
    } catch (err) {
      console.error('[ga4/admin] accountSummaries call failed:', err instanceof Error ? err.message : err)
      return { ok: false, reason: 'api_failed' }
    }
  }
  return { ok: true, properties }
}
