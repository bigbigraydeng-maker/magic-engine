/**
 * Ad-set-level Meta ads insights, broken down by hour (ads IMPACT 阶段 1).
 *
 * Split out of adset-insights.ts. Shares the daily-row parser with
 * campaign-insights so the never-sum / never-fake-zero rules are stated once.
 *
 * The hourly breakdown is requested in the ADVERTISER's time zone
 * (`hourly_stats_aggregated_by_advertiser_time_zone`), which is the same day
 * boundary the daily series uses — so an hour bucket lines up with the day it
 * belongs to instead of drifting by the account's UTC offset.
 *
 * Meta does NOT return reach or frequency with the hourly breakdown, so those
 * columns are absent from the field list on purpose. Requesting them would
 * either error or come back empty; the daily series remains the source for
 * both.
 */

import { GRAPH_BASE, fetchInsightPages, type InsightPageWalk } from './graph-base'
import {
  parseDailyMetrics,
  type GraphCampaignDailyRow,
  type MetaCampaignDailyRow,
} from './campaign-insights'
import type { MetaAdsetDailyRow } from './adset-insights'

/**
 * 一个广告组一小时的指标。小时粒度用来回答「这一天里哪几个小时在烧钱」，
 * 日粒度回答不了——日行是 24 小时的合计，看不出投放时段。
 */
export interface MetaAdsetHourlyRow extends MetaAdsetDailyRow {
  hour: number
}

interface GraphAdsetHourlyRow extends GraphCampaignDailyRow {
  adset_id?:   string
  adset_name?: string
  hourly_stats_aggregated_by_advertiser_time_zone?: string
}

/**
 * Parse the hour out of a bucket label like "04:00:00 - 04:59:59".
 *
 * Returns null for anything that is not a clean 0..23 integer: a malformed
 * bucket must not be stored as hour 0, because hour 0 is a real bucket and the
 * two would be indistinguishable in the table.
 */
function parseHour(label: string | undefined): number | null {
  if (!label) return null
  const hour = Number(label.slice(0, 2))
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  return hour
}

export function parseAdsetHourlyRow(row: GraphAdsetHourlyRow): MetaAdsetHourlyRow | null {
  if (!row.adset_id || !row.date_start) return null
  const hour = parseHour(row.hourly_stats_aggregated_by_advertiser_time_zone)
  if (hour === null) return null
  return {
    adset_id:      row.adset_id,
    adset_name:    row.adset_name ?? row.adset_id,
    campaign_id:   row.campaign_id ?? '',
    campaign_name: row.campaign_name ?? row.campaign_id ?? '',
    insight_date:  row.date_start,
    hour,
    ...parseDailyMetrics(row),
  }
}

/**
 * Deliberately narrower than DAILY_FIELD_LIST: no reach, no frequency, no video
 * columns. Meta does not return reach/frequency with the hourly breakdown, and
 * the video fields are not needed at this grain.
 */
const ADSET_HOURLY_FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'spend',
  'impressions',
  'clicks',
  'cpm',
  'actions',
].join(',')

export async function getAdsetHourlyInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<InsightPageWalk<MetaAdsetHourlyRow>> {
  const params = new URLSearchParams({
    fields: ADSET_HOURLY_FIELDS,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'adset',
    time_increment: '1',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    limit: '500',
  })

  return fetchInsightPages<GraphAdsetHourlyRow, MetaAdsetHourlyRow>(
    `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`,
    'adset hourly',
    parseAdsetHourlyRow,
  )
}
