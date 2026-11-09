import type {
  BreakdownSpec,
  BreakdownStatRow,
  GraphBreakdownRow,
} from './types'
import { breakdownSig } from './sig'
import {
  pickAction,
  LEAD_ACTION_PRIORITY,
  MESSAGING_ACTION_PRIORITY,
} from '@/lib/meta/objective-metrics'

/** Context shared by every row of one capture run. */
export interface MapContext {
  clientId: string
  adAccountId: string
  fetchedAt: string
}

/** Parse a numeric string; NaN → 0. */
function num(value: string | undefined): number {
  const parsed = parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

/** Parse an integer string; NaN → 0. */
function int(value: string | undefined): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Round to 2 decimals (spend precision). */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Map one raw Graph row to a `ad_breakdown_stats` row.
 * Returns null when the row lacks the ad id, date, or breakdown value.
 */
export function mapBreakdownRow(
  row: GraphBreakdownRow,
  spec: BreakdownSpec,
  ctx: MapContext,
): BreakdownStatRow | null {
  if (!row.ad_id || !row.date_start) return null
  const value = spec.valueOf(row)
  if (value === null) return null

  const metaLeads = spec.metaActionsAvailable
    ? pickAction(row.actions, LEAD_ACTION_PRIORITY)
    : null
  const metaMessaging = spec.metaActionsAvailable
    ? pickAction(row.actions, MESSAGING_ACTION_PRIORITY)
    : null

  return {
    client_id: ctx.clientId,
    ad_account_id: ctx.adAccountId,
    level: 'ad',
    entity_id: row.ad_id,
    campaign_id: row.campaign_id ?? null,
    adset_id: row.adset_id ?? null,
    stat_date: row.date_start,
    breakdown_key: spec.key,
    breakdown_value: value,
    breakdown_sig: breakdownSig(value),
    spend: num(row.spend),
    currency: row.account_currency ?? null,
    impressions: int(row.impressions),
    clicks: int(row.clicks),
    link_clicks:
      row.inline_link_clicks === undefined ? null : int(row.inline_link_clicks),
    meta_leads: metaLeads,
    meta_messaging: metaMessaging,
    fetched_at: ctx.fetchedAt,
  }
}

/** Sum two nullable counts: null + null = null, otherwise null counts as 0. */
function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

/** Merge `next` into `prev` (same conflict key). */
function mergeRow(prev: BreakdownStatRow, next: BreakdownStatRow): BreakdownStatRow {
  return {
    ...prev,
    spend: round2(prev.spend + next.spend),
    impressions: prev.impressions + next.impressions,
    clicks: prev.clicks + next.clicks,
    link_clicks: sumNullable(prev.link_clicks, next.link_clicks),
    meta_leads: sumNullable(prev.meta_leads, next.meta_leads),
    meta_messaging: sumNullable(prev.meta_messaging, next.meta_messaging),
  }
}

/** Conflict key of a row — one upsert batch must not repeat it. */
function conflictKey(row: BreakdownStatRow): string {
  return `${row.entity_id}|${row.stat_date}|${row.breakdown_key}|${row.breakdown_sig}`
}

/**
 * Map every raw row and merge duplicates that share a conflict key.
 * `skipped` counts unmappable rows; `merged` counts extra rows folded in.
 */
export function mapBreakdownRows(
  rows: readonly GraphBreakdownRow[],
  spec: BreakdownSpec,
  ctx: MapContext,
): { rows: BreakdownStatRow[]; skipped: number; merged: number } {
  const byKey = new Map<string, BreakdownStatRow>()
  let skipped = 0
  let merged = 0

  for (const raw of rows) {
    const mapped = mapBreakdownRow(raw, spec, ctx)
    if (mapped === null) {
      skipped++
      continue
    }
    const key = conflictKey(mapped)
    const existing = byKey.get(key)
    if (existing) {
      byKey.set(key, mergeRow(existing, mapped))
      merged++
    } else {
      byKey.set(key, mapped)
    }
  }

  return { rows: Array.from(byKey.values()), skipped, merged }
}
