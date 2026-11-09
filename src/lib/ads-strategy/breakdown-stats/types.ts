/**
 * Ad breakdown stats — shared contract (design: docs/specs/2026-10-29-ads-opportunity-mining-design-v0.2.md
 * §4.2 + v0.3 §3).
 *
 * One long table holds every Meta breakdown ("切法") at ad level, per account-timezone day.
 * This is the data floor of the Check-stage opportunity mining; it never writes to Meta.
 */

/** Breakdown keys stored in `ad_breakdown_stats.breakdown_key`. Adding a key = adding a spec, no migration. */
export type BreakdownKey = 'hour_account_tz' | 'placement_device' | 'age_gender' | 'region'

/** One breakdown value, e.g. `{ hour: 21 }` or `{ platform: 'facebook', position: 'feed', device: 'iphone' }`. */
export type BreakdownValue = Record<string, string | number>

export interface BreakdownSpec {
  key: BreakdownKey
  /** Value for the Graph `breakdowns` param, comma-separated. */
  graphBreakdowns: string
  /**
   * Whether Meta reports lead / messaging actions under this breakdown.
   * Verified 2026-10-29: hourly and region return no lead counts → store null, never 0.
   */
  metaActionsAvailable: boolean
  /** Extract the breakdown value from a raw Graph row; null when the row lacks the breakdown fields. */
  valueOf: (row: GraphBreakdownRow) => BreakdownValue | null
}

/** Raw Graph insights row at level=ad with time_increment=1 and one breakdown spec applied. */
export interface GraphBreakdownRow {
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  date_start?: string
  spend?: string
  impressions?: string
  clicks?: string
  inline_link_clicks?: string
  actions?: Array<{ action_type: string; value: string }>
  account_currency?: string
  hourly_stats_aggregated_by_advertiser_time_zone?: string
  publisher_platform?: string
  platform_position?: string
  impression_device?: string
  age?: string
  gender?: string
  region?: string
}

/** One row of `ad_breakdown_stats` (snake_case = column names). */
export interface BreakdownStatRow {
  client_id: string
  ad_account_id: string
  level: 'ad'
  entity_id: string
  campaign_id: string | null
  adset_id: string | null
  stat_date: string
  breakdown_key: BreakdownKey
  breakdown_value: BreakdownValue
  breakdown_sig: string
  spend: number
  currency: string | null
  impressions: number
  clicks: number
  link_clicks: number | null
  /** Meta-reported leads (LEAD_ACTION_PRIORITY, never summed); null when the breakdown cannot report it. */
  meta_leads: number | null
  /** Meta-reported messaging conversations (MESSAGING_ACTION_PRIORITY, never summed); null likewise. */
  meta_messaging: number | null
  fetched_at: string
}

/** Spend reconciliation for one account-day and one breakdown key. */
export interface SpendReconciliation {
  stat_date: string
  breakdown_key: BreakdownKey
  breakdown_spend: number
  account_spend: number
  /** |breakdown - account| / account; 0 when both are 0; null when account spend is 0 but breakdown is not. */
  relative_gap: number | null
  ok: boolean
}

export type CaptureMode = 'dry' | 'live'

export interface AccountCaptureReceipt {
  client_id: string
  ad_account_id: string
  /**
   * `partial`: some breakdown read incomplete, or spend reconciliation failed / was skipped — the data is not trustworthy.
   * `skipped`: account hidden from ad health (`hidden_from_ad_health`), not read.
   */
  status: 'ok' | 'partial' | 'skipped' | 'read_failed' | 'no_token' | 'write_failed' | 'error'
  since: string | null
  until: string | null
  backfill: boolean
  /** Rows built per breakdown key. In live mode only keys whose read was complete are written. */
  rows_by_key: Partial<Record<BreakdownKey, number>>
  /** Raw Graph rows that could not be mapped (missing ad id / date / breakdown value). */
  rows_skipped: number
  /** Raw Graph rows folded into another row with the same conflict key. */
  rows_merged: number
  reconciliation_failures: SpendReconciliation[]
  error: string | null
}

export interface CaptureReceipt {
  request_id: string
  mode: CaptureMode
  started_at: string
  finished_at: string
  clients_requested: number
  accounts_checked: number
  accounts: AccountCaptureReceipt[]
  /** Reading Meta costs nothing; kept explicit per CLAUDE.md receipt rules. */
  cost: 0
  no_publish: true
  problems: string[]
}
