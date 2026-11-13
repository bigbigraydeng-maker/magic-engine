import type { SupabaseClient } from '@supabase/supabase-js'
import { readClientDailyTotalCap } from '@/lib/approval-source/plan-cap'
import type { SpendDraft } from './sample'
import { pacingFromSamples, sinceDay, type PacingPayload } from './view'

const COLUMNS = 'client_id, ad_account_id, account_day, local_minute, entity_level, entity_id, spend_minor, impressions, currency, timezone, sampled_at'
const OUTCOME_COLUMNS = 'link_clicks, results'
const ROW_CAP = 20000

export async function samplesTableReady(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('ad_intraday_spend_samples').select('id').limit(1)
  if (!error) return true
  if (/does not exist|schema cache|Could not find/i.test(error.message)) return false
  throw new Error(error.message)
}
export async function readClientPacing(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<PacingPayload | null> {
  const rows = await loadRecentSamples(sb, clientId, sinceDay(now))
  if (rows === null) return null
  const cap = await readClientDailyTotalCap(sb, clientId)
  return pacingFromSamples(rows, cap.state === 'set' ? cap.cents : null, now)
}

/** True only when the nullable click/result columns exist. A missing column must not break spend reads. */
export async function outcomeColumnsReady(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('ad_intraday_spend_samples').select('link_clicks').limit(1)
  if (!error) return true
  if (/does not exist|schema cache|Could not find/i.test(error.message)) return false
  throw new Error(error.message)
}

export async function loadRecentSamples(
  sb: SupabaseClient,
  clientId: string,
  since: string,
): Promise<SpendDraft[] | null> {
  const outcomes = await outcomeColumnsReady(sb)
  const { data, error } = await sb
    .from('ad_intraday_spend_samples')
    .select(outcomes ? `${COLUMNS}, ${OUTCOME_COLUMNS}` : COLUMNS)
    .eq('client_id', clientId)
    .gte('account_day', since)
    .limit(ROW_CAP)
  if (error) return null
  const raw = (data ?? []) as Record<string, unknown>[]
  if (raw.length >= ROW_CAP) return null
  return raw.map(mapRow).filter((row): row is SpendDraft => row !== null)
}
export async function upsertSamples(sb: SupabaseClient, drafts: readonly SpendDraft[]): Promise<void> {
  const outcomes = await outcomeColumnsReady(sb)
  for (let i = 0; i < drafts.length; i += 400) {
    const chunk = drafts.slice(i, i + 400).map((draft) => toRow(draft, outcomes))
    const { error } = await sb.from('ad_intraday_spend_samples').upsert(chunk, {
      onConflict: 'client_id,ad_account_id,account_day,local_minute,entity_level,entity_id',
    })
    if (error) throw new Error(error.message)
  }
}
export async function purgeSamplesBefore(sb: SupabaseClient, beforeIso: string): Promise<number> {
  const { error, count } = await sb
    .from('ad_intraday_spend_samples')
    .delete({ count: 'exact' })
    .lt('sampled_at', beforeIso)
  if (error) throw new Error(error.message)
  return count ?? 0
}
function toRow(draft: SpendDraft, outcomes: boolean): Record<string, unknown> {
  return {
    client_id: draft.clientId,
    ad_account_id: draft.adAccountId,
    account_day: draft.accountDay,
    sampled_at: draft.sampledAt,
    local_minute: draft.localMinute,
    entity_level: draft.entityLevel,
    entity_id: draft.entityId,
    spend_minor: draft.spendMinor,
    impressions: draft.impressions,
    currency: draft.currency,
    timezone: draft.timezone,
    ...(outcomes ? { link_clicks: draft.linkClicks, results: draft.results } : {}),
  }
}
function mapRow(raw: Record<string, unknown>): SpendDraft | null {
  if (raw.entity_level !== 'campaign' && raw.entity_level !== 'adset') return null
  const spend = asInt(raw.spend_minor)
  const minute = asInt(raw.local_minute)
  if (spend === null || minute === null) return null
  if (typeof raw.client_id !== 'string' || typeof raw.ad_account_id !== 'string') return null
  if (typeof raw.account_day !== 'string' || typeof raw.entity_id !== 'string') return null
  if (typeof raw.timezone !== 'string' || typeof raw.sampled_at !== 'string') return null
  return {
    clientId: raw.client_id,
    adAccountId: raw.ad_account_id,
    accountDay: raw.account_day.slice(0, 10),
    localMinute: minute,
    entityLevel: raw.entity_level,
    entityId: raw.entity_id,
    spendMinor: spend,
    impressions: asInt(raw.impressions) ?? 0,
    linkClicks: asNullableCount(raw.link_clicks),
    results: asNullableCount(raw.results),
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    timezone: raw.timezone,
    sampledAt: raw.sampled_at,
  }
}
function asNullableCount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = asInt(value)
  if (n === null || n < 0) return null
  return n
}
function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}
