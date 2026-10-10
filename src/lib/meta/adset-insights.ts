/**
 * Ad-set-level Meta ads insights (ads IMPACT 阶段 1 §2.2).
 *
 * Split out of client.ts. Shares the daily-row parser with campaign-insights so
 * the never-sum / never-fake-zero rules are stated once.
 */

import { GRAPH_BASE, fetchInsightPages, type InsightPageWalk } from './graph-base'
import {
  DAILY_FIELD_LIST,
  parseDailyMetrics,
  type GraphCampaignDailyRow,
  type MetaCampaignDailyRow,
} from './campaign-insights'

/**
 * 一个广告组一天的指标。漏斗角色（破冰/获客/再营销）是按广告组的优化目标和受众判的，
 * ABO 预算也挂在广告组上——只有系列级和广告级数据时，D4/D5 拿不到判定单位的花费。
 */
export interface MetaAdsetDailyRow extends MetaCampaignDailyRow {
  adset_id:   string
  adset_name: string
}

interface GraphAdsetDailyRow extends GraphCampaignDailyRow {
  adset_id?:   string
  adset_name?: string
}

function parseAdsetDailyRow(row: GraphAdsetDailyRow): MetaAdsetDailyRow | null {
  if (!row.adset_id || !row.date_start) return null
  return {
    adset_id:      row.adset_id,
    adset_name:    row.adset_name ?? row.adset_id,
    campaign_id:   row.campaign_id ?? '',
    campaign_name: row.campaign_name ?? row.campaign_id ?? '',
    insight_date:  row.date_start,
    ...parseDailyMetrics(row),
  }
}

const ADSET_DAILY_FIELDS = [...DAILY_FIELD_LIST, 'adset_id', 'adset_name'].join(',')

export async function getAdsetDailyInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<InsightPageWalk<MetaAdsetDailyRow>> {
  const params = new URLSearchParams({
    fields: ADSET_DAILY_FIELDS,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'adset',
    time_increment: '1',
    limit: '500',
  })

  return fetchInsightPages<GraphAdsetDailyRow, MetaAdsetDailyRow>(
    `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`,
    'adset daily',
    parseAdsetDailyRow,
  )
}
