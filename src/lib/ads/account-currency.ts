/**
 * Ad currency comes from the ad account snapshot, then the client's country.
 * Server-only: it reads the database. Display formatting stays in spend-figures.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { accountSpendReading, currencyFromCountry, type SpendTileReading } from './spend-figures'

export async function resolveClientAdCurrency(
  clientId: string,
  adAccountId?: string | null,
): Promise<string | null> {
  const fromAccount = await readAccountCurrency(clientId, adAccountId)
  if (fromAccount) return fromAccount
  return readClientCountryCurrency(clientId)
}

/** The same meta_ads_snapshots row the data tab shows: spend, dates, and currency together. */
export async function readLatestAccountSpendWindow(clientId: string): Promise<SpendTileReading> {
  const { data } = await supabaseAdmin
    .from('meta_ads_snapshots')
    .select('ad_account_id, spend, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as {
    ad_account_id?: string | null
    spend?: number | string | null
    period_start?: string | null
    period_end?: string | null
  } | null
  const currency = await resolveClientAdCurrency(clientId, row?.ad_account_id ?? null)
  return accountSpendReading(row, currency)
}

async function readAccountCurrency(clientId: string, adAccountId?: string | null): Promise<string | null> {
  let query = supabaseAdmin
    .from('ad_entity_snapshots')
    .select('currency')
    .eq('client_id', clientId)
    .eq('level', 'account')
  if (adAccountId) query = query.eq('ad_account_id', adAccountId)
  const { data, error } = await query.order('captured_at', { ascending: false }).limit(1)
  if (error) return null
  const currency = (data as { currency: string | null }[] | null)?.[0]?.currency
  const trimmed = currency?.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

async function readClientCountryCurrency(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('country, semrush_db')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { country?: string | null; semrush_db?: string | null }
  const country = row.country ?? (row.semrush_db === 'nz' ? 'NZ' : row.semrush_db === 'au' ? 'AU' : null)
  return currencyFromCountry(country)
}
