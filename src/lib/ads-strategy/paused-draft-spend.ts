/**
 * Turn stored ad snapshots into the two numbers the paused-draft card needs:
 * delivering daily budget, and each campaign's objective / budget mode.
 * No network, no database.
 */

import { sumDeliveringDailyMinor, type HeadroomRow } from './launch-budget-headroom'
import type { CampaignShape } from './paused-draft-facts'

const CAPTURE = new Set(['first_seen', 'changed', 'daily', 'disappeared', 'kernel_pre', 'kernel_post'])

export interface SnapshotSpendRow {
  ad_account_id: unknown
  level: unknown
  entity_id: unknown
  campaign_id: unknown
  budget_level: unknown
  daily_budget_minor: unknown
  effective_status: unknown
  currency: unknown
  capture_reason: unknown
  captured_at: unknown
  objective: unknown
}

export interface SpendRead {
  readonly liveDeliveringCents: number | null
  readonly campaignShapes: readonly CampaignShape[] | null
}

/** null rows = the snapshot query failed. An empty list was read and is empty. */
export function spendFromSnapshots(rows: readonly SnapshotSpendRow[] | null): SpendRead {
  if (!rows) return { liveDeliveringCents: null, campaignShapes: null }
  const parsed: HeadroomRow[] = []
  for (const row of rows) {
    const one = toHeadroom(row)
    if (one === 'bad') return { liveDeliveringCents: null, campaignShapes: null }
    if (one) parsed.push(one)
  }
  return {
    liveDeliveringCents: sumDeliveringDailyMinor(parsed),
    campaignShapes: campaignShapes(rows),
  }
}

function campaignShapes(rows: readonly SnapshotSpendRow[]): CampaignShape[] {
  const latest = new Map<string, { at: string; shape: CampaignShape }>()
  for (const row of rows) {
    if (row.level !== 'campaign' || typeof row.entity_id !== 'string' || typeof row.captured_at !== 'string') continue
    const shape: CampaignShape = {
      entityId: row.entity_id,
      objective: typeof row.objective === 'string' && row.objective.trim() ? row.objective.trim() : null,
      budgetLevel: row.budget_level === 'cbo' || row.budget_level === 'abo' ? row.budget_level : null,
    }
    const prev = latest.get(row.entity_id)
    if (!prev || Date.parse(row.captured_at) > Date.parse(prev.at)) latest.set(row.entity_id, { at: row.captured_at, shape })
  }
  return [...latest.values()].map((row) => row.shape)
}

function toHeadroom(row: SnapshotSpendRow): HeadroomRow | null | 'bad' {
  if (row.level !== 'campaign' && row.level !== 'adset') return null
  if (typeof row.entity_id !== 'string' || typeof row.captured_at !== 'string') return 'bad'
  if (row.budget_level !== 'cbo' && row.budget_level !== 'abo' && row.budget_level !== null) return 'bad'
  if (typeof row.capture_reason !== 'string' || !CAPTURE.has(row.capture_reason)) return 'bad'
  const daily = minor(row.daily_budget_minor)
  if (daily === 'bad') return 'bad'
  return {
    ad_account_id: typeof row.ad_account_id === 'string' ? row.ad_account_id : '',
    level: row.level,
    entity_id: row.entity_id,
    campaign_id: typeof row.campaign_id === 'string' ? row.campaign_id : null,
    budget_level: row.budget_level,
    daily_budget_minor: daily,
    effective_status: typeof row.effective_status === 'string' ? row.effective_status : null,
    currency: typeof row.currency === 'string' ? row.currency : null,
    capture_reason: row.capture_reason as HeadroomRow['capture_reason'],
    captured_at: row.captured_at,
  }
}

function minor(value: unknown): number | null | 'bad' {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(n) || n < 0) return 'bad'
  return n
}
