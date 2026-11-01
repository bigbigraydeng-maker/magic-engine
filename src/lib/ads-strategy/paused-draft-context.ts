/**
 * Reads the account label and budget cap for the paused-draft card.
 * Database only. No Meta calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import type { PausedDraftReview } from './paused-draft-facts'
import {
  spendFromSnapshots,
  spendRowsAreFresh,
  type SnapshotCaptureRow,
  type SnapshotSpendRow,
  type SpendRead,
} from './paused-draft-spend'

export interface PausedDraftContext {
  readonly accountLabel: string
  readonly review: PausedDraftReview
}

export async function loadPausedDraftContext(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<PausedDraftContext> {
  const [accounts, config, currency, clientName, spend] = await Promise.all([
    readAccounts(sb, clientId),
    readClientCap(sb, clientId),
    readCurrency(sb, clientId, adAccountId),
    readClientName(sb, clientId),
    readDeliveringSpend(sb, clientId, adAccountId),
  ])
  const label = accounts.rows.find((row) => row.ad_account_id === adAccountId)?.label
  return {
    accountLabel: label || clientName || '这位客户的广告账户',
    review: {
      adAccountId,
      accounts: accounts.ok ? accounts.rows.map((row) => toCap(row, adAccountId, currency)) : null,
      clientCapCents: config,
      liveDeliveringCents: spend.liveDeliveringCents,
      campaignShapes: spend.campaignShapes,
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

const LOOKBACK_MS = 4 * 86_400_000
const PAGE = 1000
const MAX_PAGES = 20
const SPEND_COLUMNS = 'ad_account_id, level, entity_id, campaign_id, budget_level, daily_budget_minor, effective_status, currency, capture_reason, captured_at, objective'

/** A short last page means the read finished. A full last page, or any failed page, did not. */
export function joinSpendPages<T>(pages: readonly (readonly T[] | null)[], pageSize: number): T[] | null {
  const out: T[] = []
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    if (!page || page.length > pageSize) return null
    out.push(...page)
    if (page.length < pageSize) return i === pages.length - 1 ? out : null
  }
  return null
}

export async function readPaged<T>(
  load: (from: number, to: number) => Promise<readonly T[] | null>,
  pageSize: number,
): Promise<T[] | null> {
  const pages: (readonly T[] | null)[] = []
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * pageSize
    const page = await load(from, from + pageSize - 1)
    pages.push(page)
    if (!page || page.length < pageSize) return joinSpendPages(pages, pageSize)
  }
  return null
}

async function readDeliveringSpend(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<SpendRead> {
  const now = Date.now()
  const since = new Date(now - LOOKBACK_MS).toISOString()
  const [rows, captures, foreign] = await Promise.all([
    readSpendRows(sb, clientId, adAccountId, since),
    readCaptureRows(sb, clientId, adAccountId, since),
    otherSpellingHasRows(sb, clientId, adAccountId, since),
  ])
  if (!rows || !captures || foreign !== false) return unreadSpend()
  if (rows.length > 0 && !spendRowsAreFresh(rows, now)) return unreadSpend()
  return spendFromSnapshots(rows, captures, now)
}

function unreadSpend(): SpendRead {
  return { liveDeliveringCents: null, campaignShapes: null }
}

function otherAccountIds(adAccountId: string): string[] {
  const bare = adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId
  if (!/^\d+$/.test(bare)) return []
  return [bare, `act_${bare}`].filter((id) => id !== adAccountId)
}

async function otherSpellingHasRows(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  since: string,
): Promise<boolean | null> {
  for (const other of otherAccountIds(adAccountId)) {
    const { data, error } = await sb
      .from('ad_entity_snapshots')
      .select('entity_id')
      .eq('client_id', clientId)
      .eq('ad_account_id', other)
      .in('level', ['campaign', 'adset'])
      .gte('captured_at', since)
      .limit(1)
    if (error) return null
    if ((data ?? []).length > 0) return true
  }
  return false
}

async function readSpendRows(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  since: string,
): Promise<SnapshotSpendRow[] | null> {
  return readPaged(async (from, to) => {
    const { data, error } = await sb
      .from('ad_entity_snapshots')
      .select(SPEND_COLUMNS)
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .in('level', ['campaign', 'adset'])
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .order('level', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, to)
    if (error) return null
    return (data ?? []) as SnapshotSpendRow[]
  }, PAGE)
}

async function readCaptureRows(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  since: string,
): Promise<SnapshotCaptureRow[] | null> {
  return readPaged(async (from, to) => {
    const { data, error } = await sb
      .from('ad_snapshot_captures')
      .select('level, complete, skipped_shared, error, captured_at')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .in('level', ['campaign', 'adset'])
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .order('level', { ascending: true })
      .range(from, to)
    if (error) return null
    return (data ?? []) as SnapshotCaptureRow[]
  }, PAGE)
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
