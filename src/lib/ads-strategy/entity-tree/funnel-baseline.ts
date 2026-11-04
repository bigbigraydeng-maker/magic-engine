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

/** Entity rows carry `ctr: null` when link clicks were never stored. A plain 0 is a real zero. */
function recordedLinkCtr(m: FunnelMetrics): number | null | undefined {
  if (!('ctr' in m)) return undefined
  const ctr = (m as FunnelMetrics & { ctr?: number | null }).ctr
  return ctr === undefined ? undefined : ctr
}

export function ratesFromMetrics(m: FunnelMetrics): FunnelRates {
  const recorded = recordedLinkCtr(m)
  const linkKnown = recorded === undefined || recorded !== null
  const cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null
  const linkCtr = recorded !== undefined ? recorded : (m.impressions > 0 ? m.linkClicks / m.impressions : null)
  const completion = linkKnown && m.linkClicks > 0 ? m.leads / m.linkClicks : null
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
