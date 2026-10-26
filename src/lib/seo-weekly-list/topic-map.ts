/**
 * Pure topic map for the SEO weekly list.
 *
 * Groups near-miss keywords onto the own pages whose title / H1 / path mention
 * every token of the keyword, and flags topics where two or more own pages both
 * carry a real share of the impressions. No I/O, no async, no AI.
 *
 * The page match is a text match on titles, not proof of which page ranks, so
 * every entry is labelled 很可能 and the hub is only a suggestion for a human.
 */

import { canonicalUrl } from '@/lib/url/canonical-url'
import { matchOwnPages, tokenKey } from './candidates'
import type { KeywordMember, PageAggRow, SitePageRow } from './candidates'

export interface TopicMapPage {
  url: string
  impressions: number
  clicks: number
  share: number
}

export interface TopicMapEntry {
  keyword: string
  position: number
  volume: number
  /** Own pages whose title/H1/path contain every token of the keyword AND have enough Google impressions, highest impressions first. */
  pages: TopicMapPage[]
  /** True when at least two own pages both carry a real share of the impressions for this topic. */
  overlap: boolean
  /** Suggested main page = the page with the most impressions (null when no page). A suggestion for a human, never an action. */
  hubUrl: string | null
  /** Always '很可能': the match is a text match on titles, not proof of which page ranks. */
  confidence: '很可能'
}

export interface TopicMapOptions {
  minPageImpressions: number
  overlapMinShare: number
  maxEntries: number
}

export const DEFAULT_TOPIC_MAP_OPTIONS: TopicMapOptions = {
  minPageImpressions: 30,
  overlapMinShare: 0.25,
  maxEntries: 15,
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function buildTopicMap(
  keywords: KeywordMember[],
  sitePages: SitePageRow[],
  pageAgg: PageAggRow[],
  opts: TopicMapOptions = DEFAULT_TOPIC_MAP_OPTIONS,
): TopicMapEntry[] {
  if (keywords.length === 0 || sitePages.length === 0 || pageAgg.length === 0) return []

  // Canonical page key -> aggregated row. Rows without a canonical URL are unusable.
  const aggByCanon = new Map<string, PageAggRow>()
  for (const row of pageAgg) {
    const canon = canonicalUrl(row.url)
    if (!canon) continue
    aggByCanon.set(canon, row)
  }

  const sorted = [...keywords].sort((a, b) => b.volume - a.volume || a.position - b.position)

  const seenKeys = new Set<string>()
  const entries: TopicMapEntry[] = []

  for (const kw of sorted) {
    const key = tokenKey(kw.keyword)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const matched = matchOwnPages(kw.keyword, sitePages)

    // Keep only pages with a canonical URL and enough impressions.
    const kept: { url: string; impressions: number; clicks: number }[] = []
    for (const page of matched) {
      const canon = canonicalUrl(page.url)
      if (!canon) continue
      const agg = aggByCanon.get(canon)
      if (!agg) continue
      if (agg.impressions < opts.minPageImpressions) continue
      kept.push({ url: page.url, impressions: agg.impressions, clicks: agg.clicks })
    }

    if (kept.length === 0) continue

    kept.sort((a, b) => b.impressions - a.impressions)

    const total = kept.reduce((sum, p) => sum + p.impressions, 0)
    if (total <= 0) continue

    const pages: TopicMapPage[] = kept.map(p => ({
      url: p.url,
      impressions: p.impressions,
      clicks: p.clicks,
      share: round2(p.impressions / total),
    }))

    const overlap = pages.length >= 2 && pages[1].share >= opts.overlapMinShare

    entries.push({
      keyword: kw.keyword,
      position: kw.position,
      volume: kw.volume,
      pages,
      overlap,
      hubUrl: pages[0].url,
      confidence: '很可能',
    })
  }

  // Overlap topics first; each group keeps the volume-desc order it was built in.
  const overlapping = entries.filter(e => e.overlap)
  const rest = entries.filter(e => !e.overlap)
  return [...overlapping, ...rest].slice(0, opts.maxEntries)
}
