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
