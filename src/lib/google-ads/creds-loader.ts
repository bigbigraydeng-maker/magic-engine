/**
 * Per-client Google Ads credential resolver (P18.B.2).
 *
 * Sits between the raw env-var loader (`client.ts#loadGoogleAdsCreds`) and the
 * cron / execute / settings callers, so a single chain decides where the
 * customer_id comes from for a given client. Lookup order (first hit wins):
 *
 *   1. `clients.google_ads_customer_id`             — primary, FDE-set in the UI
 *   2. `platform_oauth_connections.account_id`      — set by the OAuth flow
 *   3. `flywheel_actions.payload->>'customer_id'`   — legacy, most recent action
 *
 * Why a separate file: `client.ts` should stay DB-agnostic (it's a Google Ads
 * REST wrapper). Putting Supabase calls in there would force every consumer of
 * the API wrappers to drag a Supabase dependency along. This file is the seam
 * for any "where is this client's customer_id?" question.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGoogleAdsCreds, type GoogleAdsCreds } from './client'

export type CustomerIdSource =
  | 'clients_table'
  | 'platform_oauth_connections'
  | 'flywheel_actions_payload'
  | 'none'

export interface CustomerIdLookupResult {
  customer_id: string | null
  source: CustomerIdSource
}

/**
 * Resolve the customer_id without yet building credentials. Useful for the
 * settings UI / debug tooling that wants to show *where* the value came
 * from (so an operator can tell "yes, the FDE set it" vs "the OAuth flow
 * supplied it").
 *
 * `supabase` is injected (not imported) so the cron's `supabaseAdmin`, the
 * route handler's request-scoped client, and unit-test stubs can all share
 * one implementation.
 */
export async function resolveCustomerId(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CustomerIdLookupResult> {
  // 1. Primary: clients.google_ads_customer_id
  try {
    const { data } = await supabase
      .from('clients')
      .select('google_ads_customer_id')
      .eq('id', clientId)
      .maybeSingle()
    const direct = (data as { google_ads_customer_id?: string | null } | null)?.google_ads_customer_id?.trim()
    if (direct) return { customer_id: direct, source: 'clients_table' }
  } catch (err) {
    console.error('[google-ads/creds-loader] clients lookup failed (non-fatal):', err)
  }

  // 2. OAuth-flow source: platform_oauth_connections.account_id
  try {
    const { data } = await supabase
      .from('platform_oauth_connections')
      .select('account_id')
      .eq('client_id', clientId)
      .eq('provider', 'google_ads')
      .eq('status', 'active')
      .not('account_id', 'is', null)
      .limit(1)
      .maybeSingle()
    const acc = (data as { account_id?: string | null } | null)?.account_id?.trim()
    if (acc) return { customer_id: acc, source: 'platform_oauth_connections' }
  } catch (err) {
    console.error('[google-ads/creds-loader] platform_oauth_connections lookup failed (non-fatal):', err)
  }

  // 3. Legacy: flywheel_actions.payload->>customer_id, most recent action.
  // The payload column is JSONB; Postgres comparisons live inside Supabase
  // JS as a chained `.filter()` against `payload->>customer_id`. Done as a
  // best-effort lookup; failure here just falls through to "none".
  try {
    const { data } = await supabase
      .from('flywheel_actions')
      .select('payload')
      .eq('client_id', clientId)
      .eq('platform', 'google_ads')
      .not('payload', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const legacy = String((data as { payload?: Record<string, unknown> | null } | null)?.payload?.customer_id ?? '').trim()
    if (legacy) return { customer_id: legacy, source: 'flywheel_actions_payload' }
  } catch (err) {
    console.error('[google-ads/creds-loader] flywheel_actions legacy lookup failed (non-fatal):', err)
  }

  return { customer_id: null, source: 'none' }
}

/**
 * Resolve + build creds in one call. Returns null when either the customer_id
 * lookup fails (no connection wired up yet) or the GOOGLE_ADS_* env vars are
 * missing. Caller should pre-check with `resolveCustomerId` if they need to
 * distinguish "client not connected" from "service not configured".
 */
export async function loadGoogleAdsCredsForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<GoogleAdsCreds | null> {
  const { customer_id } = await resolveCustomerId(supabase, clientId)
  if (!customer_id) return null
  return loadGoogleAdsCreds(customer_id)
}

/**
 * Digits-only Google Ads customer id, or null when the value is not one.
 * Accepts the "123-456-7890" display form.
 */
export function normaliseGoogleAdsCustomerId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[-\s]/g, '')
  return /^\d{1,15}$/.test(digits) ? digits : null
}

/**
 * Tenant check for every Google Ads call made on behalf of a client.
 *
 * All clients share ONE manager-account credential and are told apart only by
 * customer id, so a caller-supplied id is the whole isolation boundary: without
 * this check any signed-in client user could read or change another client's
 * campaigns by passing that client's id.
 *
 * Only `clients.google_ads_customer_id` counts as proof, and only when this
 * client is the SOLE holder of the id. That column is written by internal staff
 * alone (see the google-ads-customer-id route). The OAuth row and the legacy
 * flywheel_actions payload that resolveCustomerId() falls back to can originate
 * from caller input, so they are deliberately not accepted here.
 * Fails closed: lookup error, no registration, or an id held by more than one
 * client → false.
 */
export async function clientOwnsGoogleAdsAccount(
  supabase: SupabaseClient,
  clientId: string,
  customerId: unknown,
): Promise<boolean> {
  const wanted = normaliseGoogleAdsCustomerId(customerId)
  if (!wanted) return false
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .eq('google_ads_customer_id', wanted)
    if (error || !Array.isArray(data)) return false
    const holders = (data as Array<{ id?: string }>).map(row => row.id)
    return holders.length === 1 && holders[0] === clientId
  } catch (err) {
    console.error('[google-ads/creds-loader] ownership lookup failed (denying):', err)
    return false
  }
}

/**
 * One Google Ads account per client for the daily cron. `clients.google_ads_customer_id`
 * wins over a `platform_oauth_connections` row, matching resolveCustomerId() above.
 * Values that are not a customer id are dropped rather than sent to the API, and
 * so is any id claimed by more than one client: pulling it would store one
 * client's figures under another's name, and there is no way to tell here which
 * claim is the true one.
 */
export function mergeGoogleAdsAccounts(
  clientColumnRows: ReadonlyArray<{ id?: string; google_ads_customer_id?: string | null }>,
  oauthRows: ReadonlyArray<{ client_id: string; account_id: string }>,
): Array<{ client_id: string; account_id: string }> {
  const byClient = new Map<string, string>()
  for (const row of oauthRows) {
    const account = normaliseGoogleAdsCustomerId(row.account_id)
    if (row.client_id && account) byClient.set(row.client_id, account)
  }
  for (const row of clientColumnRows) {
    const account = normaliseGoogleAdsCustomerId(row.google_ads_customer_id)
    if (row.id && account) byClient.set(row.id, account)
  }
  const claims = new Map<string, number>()
  for (const account of byClient.values()) claims.set(account, (claims.get(account) ?? 0) + 1)
  const sharedCount = Array.from(claims.values()).filter(count => count > 1).length
  if (sharedCount > 0) {
    console.error(
      `[google-ads/creds-loader] ${sharedCount} Google Ads customer id(s) are registered to more than one client — skipped`,
    )
  }
  return Array.from(byClient, ([client_id, account_id]) => ({ client_id, account_id }))
    .filter(entry => claims.get(entry.account_id) === 1)
}
