// Supabase-backed I/O layer for ad breakdown stats.
// Reads: client_meta_ad_accounts, ad_breakdown_stats (read-only).
// Writes: ad_breakdown_stats (upsert only).
// English code/comments.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BreakdownKey, BreakdownStatRow } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BoundAccount {
  adAccountId: string;
  hidden: boolean;
}

export interface BreakdownStore {
  listAccounts(clientId: string): Promise<BoundAccount[]>;
  earliestStatDate(
    adAccountId: string,
    key: BreakdownKey,
  ): Promise<string | null>;
  upsertRows(rows: readonly BreakdownStatRow[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BreakdownTableMissingError extends Error {
  constructor(message = 'ad_breakdown_stats table is missing') {
    super(message);
    this.name = 'BreakdownTableMissingError';
  }
}

export function isTableMissing(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  if (err.code === '42P01') return true;
  const msg = err.message ?? '';
  return msg.includes('does not exist') || msg.includes('Could not find the table');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABLE = 'ad_breakdown_stats';

export const UPSERT_CHUNK = 500;

export const CONFLICT_KEY =
  'ad_account_id,level,entity_id,stat_date,breakdown_key,breakdown_sig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function withActPrefix(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

function throwIfTableMissing(err: unknown): void {
  const e = err as { code?: string; message?: string } | null | undefined;
  if (isTableMissing(e ?? null)) {
    throw new BreakdownTableMissingError(e?.message);
  }
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AccountRow {
  ad_account_id: string;
  hidden_from_ad_health: boolean | null;
}

interface StatDateRow {
  stat_date: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listAccountsImpl(
  supabase: SupabaseClient,
  clientId: string,
): Promise<BoundAccount[]> {
  const { data, error } = await supabase
    .from('client_meta_ad_accounts')
    .select('ad_account_id, hidden_from_ad_health')
    .eq('client_id', clientId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AccountRow[];
  return rows.map((r) => ({
    adAccountId: withActPrefix(r.ad_account_id),
    hidden: r.hidden_from_ad_health === true,
  }));
}

async function earliestStatDateImpl(
  supabase: SupabaseClient,
  adAccountId: string,
  key: BreakdownKey,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('stat_date')
    .eq('ad_account_id', adAccountId)
    .eq('breakdown_key', key)
    .order('stat_date', { ascending: true })
    .limit(1);
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as StatDateRow[];
  return rows.length > 0 ? rows[0].stat_date : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function sortNewestFirst(
  rows: readonly BreakdownStatRow[],
): BreakdownStatRow[] {
  return [...rows].sort((a, b) => (a.stat_date < b.stat_date ? 1 : -1));
}

async function upsertRowsImpl(
  supabase: SupabaseClient,
  rows: readonly BreakdownStatRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const sorted = sortNewestFirst(rows);
  for (let i = 0; i < sorted.length; i += UPSERT_CHUNK) {
    const chunk = sorted.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from(TABLE)
      .upsert(chunk, { onConflict: CONFLICT_KEY });
    if (error) {
      throwIfTableMissing(error);
      throw new Error(error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBreakdownStore(
  supabase: SupabaseClient,
): BreakdownStore {
  return {
    listAccounts: (clientId) => listAccountsImpl(supabase, clientId),
    earliestStatDate: (adAccountId, key) =>
      earliestStatDateImpl(supabase, adAccountId, key),
    upsertRows: (rows) => upsertRowsImpl(supabase, rows),
  };
}
