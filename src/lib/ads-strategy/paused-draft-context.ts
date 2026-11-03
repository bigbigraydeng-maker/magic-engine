/**
 * Reads the account label and budget cap for the paused-draft card.
 * Database only. No Meta calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import type { PausedDraftReview } from './paused-draft-facts'

export interface PausedDraftContext {
  readonly accountLabel: string
  readonly review: PausedDraftReview
}

export async function loadPausedDraftContext(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<PausedDraftContext> {
  const [accounts, config, currency, clientName] = await Promise.all([
    readAccounts(sb, clientId),
    readClientCap(sb, clientId),
    readCurrency(sb, clientId, adAccountId),
    readClientName(sb, clientId),
  ])
  const label = accounts.rows.find((row) => row.ad_account_id === adAccountId)?.label
  return {
    accountLabel: label || clientName || '这位客户的广告账户',
    review: {
      adAccountId,
      accounts: accounts.ok ? accounts.rows.map((row) => toCap(row, adAccountId, currency)) : null,
      clientCapCents: config,
    },
  }
}

interface AccountRow {
  ad_account_id: string
  label: string | null
  daily_budget_cap_cents: number | null
}

async function readAccounts(
  sb: SupabaseClient,
  clientId: string,
): Promise<{ ok: boolean; rows: AccountRow[] }> {
  const { data, error } = await sb
    .from('client_meta_ad_accounts')
    .select('ad_account_id, label, daily_budget_cap_cents')
    .eq('client_id', clientId)
  if (error) return { ok: false, rows: [] }
  return { ok: true, rows: (data ?? []) as AccountRow[] }
}

async function readClientCap(sb: SupabaseClient, clientId: string): Promise<number | null> {
  const { data, error } = await sb
    .from('ad_strategy_configs')
    .select('daily_budget_cap_cents')
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const cap = (data as { daily_budget_cap_cents?: unknown }).daily_budget_cap_cents
  return typeof cap === 'number' ? cap : null
}

async function readCurrency(sb: SupabaseClient, clientId: string, adAccountId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('ad_entity_snapshots')
    .select('currency')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'account')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const currency = (data as { currency?: unknown }).currency
  return typeof currency === 'string' && currency.trim() ? currency.trim() : null
}

async function readClientName(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const name = (data as { name?: unknown }).name
  return typeof name === 'string' ? name : null
}

function toCap(row: AccountRow, adAccountId: string, currency: string | null): AccountCapFacts {
  return {
    ad_account_id: row.ad_account_id,
    currency: row.ad_account_id === adAccountId ? currency : null,
    daily_cap_cents: typeof row.daily_budget_cap_cents === 'number' ? row.daily_budget_cap_cents : null,
    owned_by_client: true,
  }
}
