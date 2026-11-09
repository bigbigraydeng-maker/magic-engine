/**
 * Traffic-decay candidates for the SEO weekly list: pages whose Google clicks fell clearly
 * more than the site as a whole between the previous 28 days and the latest 28 days.
 *
 * Pure: rows in, candidates out. No I/O, no AI, no paid calls. A page missing from the
 * latest window counts as 0 clicks (it vanished from Google results), never as "unknown".
 * The cause is a mechanical reading of impressions / position, not a verdict.
 */

import type { PageAggRow } from './candidates'
import type { SeoLoopConfig } from './config'

export type DecayCause = 'rank_loss' | 'visibility_down' | 'ctr_drop' | 'mixed'

export const DECAY_CAUSE_LABEL: Record<DecayCause, string> = {
  rank_loss: '排名下滑：曝光少了、平均排名也变差',
  visibility_down: '曝光少了但排名没怎么变：可能是搜的人少了、季节，或少了几个能露出的搜索词',
  ctr_drop: '曝光没少但点的人少了：看标题描述，或页面上方被新的搜索板块压住',
  mixed: '曝光和点击都降但不属于上面三种：多个因素叠加，需要人看',
}

export interface DecayCandidate {
  kind: 'traffic_decay'
  url: string
  priorClicks: number
  recentClicks: number
  priorImpressions: number
  recentImpressions: number
  priorPosition: number
  /** null when the page had no impressions at all in the latest window. */
  recentPosition: number | null
  /** recent / prior clicks for this page. */
  pageRatio: number
  /** recent / prior clicks for the whole site (all pages with data in either window). */
  siteRatio: number
  cause: DecayCause
  /** Clicks lost versus the previous window. A sort key, not a forecast. */
  potentialClicks: number
}

export interface DecayResult {
  candidates: DecayCandidate[]
  /** Whole-site clicks, latest vs previous window; null when the previous window has none. */
  siteRatio: number | null
}

function causeOf(prior: PageAggRow, recent: PageAggRow | undefined): DecayCause {
  if (!recent || recent.impressions === 0) return 'visibility_down'
  const impressionRatio = recent.impressions / Math.max(1, prior.impressions)
  const positionWorse = recent.position - prior.position
  if (impressionRatio <= 0.7) return positionWorse >= 2 ? 'rank_loss' : 'visibility_down'
  if (impressionRatio >= 0.8) return 'ctr_drop'
  return 'mixed'
}

export function buildDecayCandidates(
  recentPages: PageAggRow[],
  priorPages: PageAggRow[],
  config: SeoLoopConfig,
): DecayResult {
  const sum = (rows: PageAggRow[]) => rows.reduce((s, r) => s + r.clicks, 0)
  const sitePrior = sum(priorPages)
  const siteRecent = sum(recentPages)
  if (sitePrior <= 0) return { candidates: [], siteRatio: null }
  const siteRatio = siteRecent / sitePrior

  const recentByUrl = new Map(recentPages.map(p => [p.url, p]))
  const out: DecayCandidate[] = []
  for (const prior of priorPages) {
    if (prior.clicks < config.decayMinPriorClicks) continue
    const recent = recentByUrl.get(prior.url)
    const recentClicks = recent?.clicks ?? 0
    const lost = prior.clicks - recentClicks
    if (lost < config.decayMinAbsDrop) continue
    // Click counts are Poisson-like: a loss inside ~sigma·√prior is ordinary wobble, not a decline.
    if (lost < config.decaySigma * Math.sqrt(prior.clicks)) continue
    const pageRatio = recentClicks / prior.clicks
    if (pageRatio > 1 - config.decayMinDropRatio) continue
    // The page must fall clearly more than the site: a site-wide dip is not a page problem.
    if (siteRatio > 0 && pageRatio / siteRatio > config.decayVsSiteRatio) continue
    out.push({
      kind: 'traffic_decay',
      url: prior.url,
      priorClicks: prior.clicks,
      recentClicks,
      priorImpressions: prior.impressions,
      recentImpressions: recent?.impressions ?? 0,
      priorPosition: prior.position,
      recentPosition: recent && recent.impressions > 0 ? recent.position : null,
      pageRatio,
      siteRatio,
      cause: causeOf(prior, recent),
      potentialClicks: lost,
    })
  }
  out.sort((a, b) => b.potentialClicks - a.potentialClicks)
  return { candidates: out, siteRatio }
}
