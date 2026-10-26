// Supabase-backed I/O layer for the ad heartbeat.
// Reads: client_meta_ad_accounts, ad_entity_snapshots, ad_daily_insights (read-only).
// Writes: ad_heartbeat_alarms (state + alarm rows).
// English code/comments; short Chinese reason strings only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlarmCandidate, HeartbeatState } from './evaluate';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BoundAccount {
  adAccountId: string;
  hidden: boolean;
  dailyCapCents: number | null;
}

export interface OpenAlarm {
  key: string;
  alarmType: string;
  objectId: string | null;
  occurrences: number;
}

export interface HeartbeatStore {
  listAccounts(clientId: string): Promise<BoundAccount[]>;
  hasActiveCampaigns(
    clientId: string,
    adAccountId: string,
  ): Promise<boolean | null>;
  /**
   * Account-currency major units per 1000 impressions over the last 14 days.
   * Returns null when there are no impressions or the read failed.
   */
  cpmMajor14d(
    clientId: string,
    adAccountId: string,
    now: Date,
  ): Promise<number | null>;
  getState(
    clientId: string,
    adAccountId: string,
  ): Promise<HeartbeatState | null>;
  upsertState(
    clientId: string,
    adAccountId: string,
    state: HeartbeatState,
    evidence: Record<string, unknown>,
    now: Date,
  ): Promise<void>;
  listOpenAlarms(
    clientId: string,
    adAccountId: string,
  ): Promise<OpenAlarm[]>;
  upsertAlarm(
    clientId: string,
    adAccountId: string,
    alarm: AlarmCandidate,
    now: Date,
  ): Promise<'inserted' | 'updated'>;
  resolveAlarms(
    clientId: string,
    keys: string[],
    now: Date,
  ): Promise<number>;
  purgeResolved(now: Date, olderThanDays: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HeartbeatTableMissingError extends Error {
  constructor(message = 'ad_heartbeat_alarms table is missing') {
    super(message);
    this.name = 'HeartbeatTableMissingError';
  }
}

export function isTableMissingError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  // Message fallback only when it names OUR table. A bare "does not exist" also appears in Graph
  // errors ("Object with ID ... does not exist") and for missing columns: those are real faults.
  const msg = err.message ?? '';
  if (!msg.includes('ad_heartbeat_alarms')) return false;
  return (
    msg.includes('does not exist') || msg.includes('Could not find the table')
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function stateKey(clientId: string, adAccountId: string): string {
  return `${clientId}|${adAccountId}|state`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE = 'ad_heartbeat_alarms';
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeAccountId(raw: string): string {
  const digits = raw.replace(/^act_/i, '').trim();
  return `act_${digits}`;
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  return new Error('unknown error');
}

function throwIfTableMissing(err: unknown): void {
  const e = err as { code?: string; message?: string } | null | undefined;
  if (isTableMissingError(e)) {
    throw new HeartbeatTableMissingError(e?.message);
  }
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AccountRow {
  ad_account_id: string;
  hidden_from_ad_health: boolean | null;
  daily_budget_cap_cents: number | null;
  client_id: string;
}

interface SnapshotRow {
  entity_id: string;
  effective_status: string | null;
  capture_reason: string | null;
  captured_at: string;
}

interface InsightRow {
  spend: number | string | null;
  impressions: number | string | null;
}

interface AlarmRow {
  id: string;
  dedupe_key: string;
  alarm_type: string | null;
  object_id: string | null;
  severity: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  occurrences: number;
  last_state: unknown;
  evidence: unknown;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Not getClientAdAccounts (src/lib/meta/client-ad-accounts.ts): that one swallows read errors into
// an empty list (a monitor must see the failure) and does not carry hidden_from_ad_health / the cap.
async function listAccountsImpl(
  supabase: SupabaseClient,
  clientId: string,
): Promise<BoundAccount[]> {
  const { data, error } = await supabase
    .from('client_meta_ad_accounts')
    .select('ad_account_id, hidden_from_ad_health, daily_budget_cap_cents, client_id')
    .eq('client_id', clientId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AccountRow[];
  return rows.map((r) => ({
    adAccountId: normalizeAccountId(r.ad_account_id),
    hidden: r.hidden_from_ad_health === true,
    dailyCapCents:
      typeof r.daily_budget_cap_cents === 'number'
        ? r.daily_budget_cap_cents
        : null,
  }));
}

async function hasActiveCampaignsImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  now: Date,
): Promise<boolean | null> {
  const since = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('ad_entity_snapshots')
    .select('entity_id, effective_status, capture_reason, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'campaign')
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(500);
  if (error) return null;

  const rows = (data ?? []) as SnapshotRow[];
  const latest = new Map<string, SnapshotRow>();
  for (const r of rows) {
    if (!latest.has(r.entity_id)) latest.set(r.entity_id, r);
  }
  for (const r of latest.values()) {
    if (r.effective_status === 'ACTIVE' && r.capture_reason !== 'disappeared') {
      return true;
    }
  }
  return false;
}

function toNumber(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function cpmMajor14dImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  now: Date,
): Promise<number | null> {
  const since = utcDateString(new Date(now.getTime() - 14 * DAY_MS));
  const { data, error } = await supabase
    .from('ad_daily_insights')
    .select('spend, impressions')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'adset')
    .gte('insight_date', since);
  if (error) return null;

  const rows = (data ?? []) as InsightRow[];
  let spend = 0;
  let impressions = 0;
  for (const r of rows) {
    const s = toNumber(r.spend);
    const i = toNumber(r.impressions);
    if (s !== null) spend += s;
    if (i !== null) impressions += i;
  }
  if (impressions <= 0) return null;
  return (spend / impressions) * 1000;
}

async function getStateImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<HeartbeatState | null> {
  const key = stateKey(clientId, adAccountId);
  const { data, error } = await supabase
    .from(TABLE)
    .select('last_state')
    .eq('client_id', clientId)
    .eq('dedupe_key', key)
    .eq('row_kind', 'state')
    .maybeSingle();
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  if (!data) return null;
  const row = data as { last_state: unknown };
  if (row.last_state === null || row.last_state === undefined) return null;
  return row.last_state as HeartbeatState;
}

async function listOpenAlarmsImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<OpenAlarm[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('dedupe_key, alarm_type, object_id, occurrences')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('row_kind', 'alarm')
    .is('resolved_at', null);
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{
    dedupe_key: string;
    alarm_type: string | null;
    object_id: string | null;
    occurrences: number;
  }>;
  return rows.map((r) => ({
    key: r.dedupe_key,
    alarmType: r.alarm_type ?? '',
    objectId: r.object_id,
    occurrences: r.occurrences,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function upsertStateImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  state: HeartbeatState,
  evidence: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const key = stateKey(clientId, adAccountId);
  const nowIso = now.toISOString();
  const { error } = await supabase.from(TABLE).upsert(
    {
      client_id: clientId,
      ad_account_id: adAccountId,
      row_kind: 'state',
      dedupe_key: key,
      alarm_type: null,
      object_id: null,
      severity: null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      resolved_at: null,
      occurrences: 1,
      last_state: state,
      evidence,
    },
    { onConflict: 'client_id,dedupe_key' },
  );
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
}

async function findAlarmRow(
  supabase: SupabaseClient,
  clientId: string,
  key: string,
): Promise<AlarmRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      'id, dedupe_key, alarm_type, object_id, severity, first_seen_at, last_seen_at, resolved_at, occurrences, last_state, evidence',
    )
    .eq('client_id', clientId)
    .eq('dedupe_key', key)
    .eq('row_kind', 'alarm')
    .maybeSingle();
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  return (data as AlarmRow | null) ?? null;
}

async function insertAlarm(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  alarm: AlarmCandidate,
  now: Date,
): Promise<'inserted' | 'conflict'> {
  const nowIso = now.toISOString();
  const { error } = await supabase.from(TABLE).insert({
    client_id: clientId,
    ad_account_id: adAccountId,
    row_kind: 'alarm',
    dedupe_key: alarm.key,
    alarm_type: alarm.type,
    object_id: alarm.objectId,
    severity: alarm.severity,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    resolved_at: null,
    occurrences: 1,
    last_state: {},
    evidence: alarm.evidence,
  });
  if (error) {
    throwIfTableMissing(error);
    if (error.code === '23505') return 'conflict';
    throw new Error(error.message);
  }
  return 'inserted';
}

async function updateAlarmOpen(
  supabase: SupabaseClient,
  row: AlarmRow,
  alarm: AlarmCandidate,
  now: Date,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      occurrences: row.occurrences + 1,
      last_seen_at: now.toISOString(),
      severity: alarm.severity,
      evidence: alarm.evidence,
    })
    .eq('id', row.id);
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
}

async function updateAlarmReopen(
  supabase: SupabaseClient,
  row: AlarmRow,
  alarm: AlarmCandidate,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from(TABLE)
    .update({
      resolved_at: null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      occurrences: 1,
      severity: alarm.severity,
      evidence: alarm.evidence,
    })
    .eq('id', row.id);
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
}

async function upsertAlarmImpl(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  alarm: AlarmCandidate,
  now: Date,
): Promise<'inserted' | 'updated'> {
  const existing = await findAlarmRow(supabase, clientId, alarm.key);
  let row = existing;
  if (row === null) {
    const inserted = await insertAlarm(supabase, clientId, adAccountId, alarm, now);
    if (inserted === 'inserted') return 'inserted';
    // Unique-key race (23505): another writer inserted between our read and insert. Update that row.
    row = await findAlarmRow(supabase, clientId, alarm.key);
    if (row === null) throw new Error('alarm insert conflicted but the row cannot be read back');
  }
  const existingRow: AlarmRow = row;
  if (existingRow.resolved_at === null) {
    await updateAlarmOpen(supabase, existingRow, alarm, now);
  } else {
    await updateAlarmReopen(supabase, existingRow, alarm, now);
  }
  return 'updated';
}

async function resolveAlarmsImpl(
  supabase: SupabaseClient,
  clientId: string,
  keys: string[],
  now: Date,
): Promise<number> {
  if (keys.length === 0) return 0;
  const { data, error } = await supabase
    .from(TABLE)
    .update({ resolved_at: now.toISOString() })
    .eq('client_id', clientId)
    .eq('row_kind', 'alarm')
    .in('dedupe_key', keys)
    .is('resolved_at', null)
    .select('id');
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  return (data ?? []).length;
}

async function purgeResolvedImpl(
  supabase: SupabaseClient,
  now: Date,
  olderThanDays: number,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - olderThanDays * DAY_MS,
  ).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq('row_kind', 'alarm')
    .lt('resolved_at', cutoff)
    .select('id');
  if (error) {
    throwIfTableMissing(error);
    throw new Error(error.message);
  }
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSupabaseStore(
  supabase: SupabaseClient,
): HeartbeatStore {
  return {
    listAccounts: (clientId) => listAccountsImpl(supabase, clientId),
    hasActiveCampaigns: (clientId, adAccountId) =>
      hasActiveCampaignsImpl(supabase, clientId, adAccountId, new Date()),
    cpmMajor14d: (clientId, adAccountId, now) =>
      cpmMajor14dImpl(supabase, clientId, adAccountId, now),
    getState: (clientId, adAccountId) =>
      getStateImpl(supabase, clientId, adAccountId),
    upsertState: (clientId, adAccountId, state, evidence, now) =>
      upsertStateImpl(supabase, clientId, adAccountId, state, evidence, now),
    listOpenAlarms: (clientId, adAccountId) =>
      listOpenAlarmsImpl(supabase, clientId, adAccountId),
    upsertAlarm: (clientId, adAccountId, alarm, now) =>
      upsertAlarmImpl(supabase, clientId, adAccountId, alarm, now),
    resolveAlarms: (clientId, keys, now) =>
      resolveAlarmsImpl(supabase, clientId, keys, now),
    purgeResolved: (now, olderThanDays) =>
      purgeResolvedImpl(supabase, now, olderThanDays),
  };
}

// Re-exported for callers that want to surface the raw error message.
export { toError as toHeartbeatError };
