/**
 * Link-click rate from `ad_daily_insights.actions`.
 * Meta's stored `ctr` counts every click (profile, comments, likes). The ads-health
 * page shows link clicks only. Missing actions stay unknown — never fall back to all-clicks.
 */

export function countAction(actions: unknown, actionType: string): number | null {
  if (!Array.isArray(actions)) return null
  let total = 0
  for (const item of actions) {
    if (!item || typeof item !== 'object') continue
    const row = item as { action_type?: unknown; value?: unknown }
    if (row.action_type !== actionType) continue
    const n = typeof row.value === 'number' ? row.value : Number(row.value)
    if (Number.isFinite(n)) total += n
  }
  return total
}

/** Link clicks ÷ impressions. Null when impressions are missing or actions were not stored. */
export function linkClickRate(actions: unknown, impressions: number | null | undefined): number | null {
  const clicks = countAction(actions, 'link_click')
  if (clicks === null || impressions == null || !(impressions > 0)) return null
  return clicks / impressions
}

export interface LinkCtrPoint {
  date: string
  ctr: number | null
}

export interface LinkCtrCampaign {
  campaign_id: string
  ctr_series: LinkCtrPoint[]
}

export interface LinkCtrInsight {
  entity_id: string
  insight_date: string
  impressions: number | null
  actions: unknown
}

/** Replace each shown day with link clicks ÷ impressions. A day with no stored row becomes unknown. */
export function overlayLinkCtrSeries<T extends LinkCtrCampaign>(campaigns: T[], rows: readonly LinkCtrInsight[]): T[] {
  const byKey = new Map<string, number | null>()
  for (const row of rows) {
    byKey.set(`${row.entity_id}|${row.insight_date}`, linkClickRate(row.actions, row.impressions))
  }
  return campaigns.map((campaign) => ({
    ...campaign,
    ctr_series: campaign.ctr_series.map((point) => {
      const key = `${campaign.campaign_id}|${point.date}`
      const ctr = byKey.has(key) ? (byKey.get(key) ?? null) : null
      return { ...point, date: point.date, ctr }
    }),
  }))
}
