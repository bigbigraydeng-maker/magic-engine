/**
 * Ad-level Meta ads insights (P21.K.7).
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
 * One AD's metrics for one calendar day.
 *
 * Campaign-level rows can say "this campaign's CPL doubled on the 17th"; only
 * ad-level rows can say WHICH ad appeared that day and dragged it there. Oztop's
 * Lead Form Cold Broad is the case that forced this: campaign data showed the
 * form-fill rate halving with outbound clicks suddenly appearing, but proving a
 * new website-destination ad went live on 7/16–17 meant a human opening Ads
 * Manager. `campaign_id` rides along so an ad can be attributed to the campaign
 * whose numbers moved.
 */
export interface MetaAdDailyRow extends MetaCampaignDailyRow {
  ad_id:   string
  ad_name: string
}

interface GraphAdDailyRow extends GraphCampaignDailyRow {
  ad_id?:   string
  ad_name?: string
}

/**
 * Empty strings, not the ad's own id, when Meta omits campaign attribution:
 * a fabricated parent would silently mis-group the ad under a campaign that
 * does not exist. The caller stores '' as NULL.
 */
function parseAdDailyRow(row: GraphAdDailyRow): MetaAdDailyRow | null {
  if (!row.ad_id || !row.date_start) return null

  return {
    ad_id:         row.ad_id,
    ad_name:       row.ad_name ?? row.ad_id,
    campaign_id:   row.campaign_id ?? '',
    campaign_name: row.campaign_name ?? row.campaign_id ?? '',
    insight_date:  row.date_start,
    ...parseDailyMetrics(row),
  }
}

const AD_DAILY_FIELDS = [...DAILY_FIELD_LIST, 'ad_id', 'ad_name'].join(',')

/**
 * Fetch per-ad, per-day insights across a date range, following pagination.
 *
 * Same contract as `getCampaignDailyInsights` one level down. Row volume is
 * roughly ads × days, so this is the caller that actually paginates: a 30-day
 * backfill of ~17 ads already spills past one 500-row page, which is why the
 * walk reports whether it finished.
 */
export async function getAdDailyInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<InsightPageWalk<MetaAdDailyRow>> {
  const params = new URLSearchParams({
    fields: AD_DAILY_FIELDS,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'ad',
    time_increment: '1',
    limit: '500',
  })

  return fetchInsightPages<GraphAdDailyRow, MetaAdDailyRow>(
    `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`,
    'ad daily',
    parseAdDailyRow,
  )
}
