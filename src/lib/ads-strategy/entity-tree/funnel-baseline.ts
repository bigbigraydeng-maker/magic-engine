/** Winner baseline for the four-step ad funnel. A winner needs at least this many leads. */
export const ACCOUNT_WINNER_MIN_LEADS = 20

export interface FunnelRates {
  cpm: number | null
  linkCtr: number | null
  completion: number | null
  hook: number | null
}

export interface FunnelMetrics {
  spend: number
  impressions: number
  linkClicks: number
  leads: number
  video3sViews: number
  costPerLead: number | null
}

export function ratesFromMetrics(m: FunnelMetrics): FunnelRates {
  const cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null
  const linkCtr = m.impressions > 0 ? m.linkClicks / m.impressions : null
  const completion = m.linkClicks > 0 ? m.leads / m.linkClicks : null
  const hook = m.impressions > 0 ? m.video3sViews / m.impressions : null
  return { cpm, linkCtr, completion, hook }
}

/** Lowest cost per lead among ads with enough leads. Null means the account has no winner yet. */
export function pickWinnerBaseline(ads: readonly FunnelMetrics[]): FunnelRates | null {
  let best: FunnelMetrics | null = null
  for (const ad of ads) {
    if (ad.leads < ACCOUNT_WINNER_MIN_LEADS || ad.costPerLead === null) continue
    if (best === null || ad.costPerLead < (best.costPerLead ?? Infinity)) best = ad
    else if (ad.costPerLead === best.costPerLead && ad.leads > best.leads) best = ad
  }
  return best === null ? null : ratesFromMetrics(best)
}
