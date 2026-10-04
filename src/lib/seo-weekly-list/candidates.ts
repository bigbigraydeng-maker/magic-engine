/**
 * Pure candidate selection for the SEO weekly list.
 *
 * Inputs are rows the platform already stores (keyword_snapshots, gsc_page_daily,
 * client_site_pages). No I/O, no AI, no paid calls. Volumes / difficulty come from
 * the DataForSEO snapshot as stored — a keyword missing either is skipped with a
 * reason, never treated as zero.
 */

import { ctrBenchmarkForPosition } from '@/lib/seo-patrol/rules'
import { isBrandedKeywordWithAliases } from '@/lib/seo-intelligence/intent-strategy'
import { canonicalUrl } from '@/lib/url/canonical-url'
import type { SeoLoopConfig } from './config'

export interface SnapshotKeywordRow {
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string | null
}

export interface KeywordMember {
  keyword: string
  position: number
  volume: number
  kd: number
  intent: string | null
}

export interface NearMissCandidate {
  kind: 'near_miss'
  /** Highest-volume member of the cluster; the item is written about it. */
  primary: KeywordMember
  /** Same-intent phrasings merged into one item (includes primary). */
  members: KeywordMember[]
  /** Rough extra clicks/month if the primary reached the next tier. Estimate, unverified. */
  potentialClicks: number
}

export interface PageAggRow {
  url: string
  clicks: number
  impressions: number
  /** Impression-weighted average position. */
  position: number
}

export interface CtrGapCandidate {
  kind: 'ctr_gap'
  url: string
  clicks: number
  impressions: number
  position: number
  ctr: number
  benchmark: number
  /** Extra clicks over the window if CTR reached benchmark. Estimate, unverified. */
  potentialClicks: number
}

export interface SkippedKeyword {
  keyword: string
  reason: string
}

const STOPWORDS = new Set(['a', 'an', 'the', 'for', 'of', 'to', 'in', 'on', 'and', 'with', 'from'])

/** Order- and stopword-insensitive identity of a phrase: "nz visa china" ≡ "visa for china nz". */
export function tokenKey(keyword: string): string {
  const tokens = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
  return Array.from(new Set(tokens)).sort().join(' ')
}

export function domainRoot(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('.')[0]
}

/** True when the keyword contains a competitor's brand root (e.g. "wendywu" from wendywutours.co.nz). */
function isCompetitorBrand(keyword: string, competitorRoots: string[]): boolean {
  const flat = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return competitorRoots.some(root => root.length >= 5 && flat.includes(root))
}

function nextTierCtr(position: number): number {
  return position > 10 ? ctrBenchmarkForPosition(10) : ctrBenchmarkForPosition(5)
}

export interface NearMissOptions {
  config: SeoLoopConfig
  brandRoot: string
  brandAliases: string[] | null
  competitorDomains: string[]
}

export function buildNearMissCandidates(
  rows: SnapshotKeywordRow[],
  opts: NearMissOptions,
): { candidates: NearMissCandidate[]; skipped: SkippedKeyword[] } {
  const { config } = opts
  const competitorRoots = opts.competitorDomains.map(domainRoot)
  const skipped: SkippedKeyword[] = []
  const clusters = new Map<string, KeywordMember[]>()

  for (const row of rows) {
    const position = row.position
    if (position === null || position < config.nearMissMinRank || position > config.nearMissMaxRank) continue
    if (row.search_volume === null || row.keyword_difficulty === null) {
      skipped.push({ keyword: row.keyword, reason: '量或难度缺失（不当 0 放行）' })
      continue
    }
    if (row.search_volume < config.nearMissMinVolume) continue
    if (row.intent === 'navigational') continue
    if (isBrandedKeywordWithAliases(row.keyword, opts.brandRoot, opts.brandAliases)) {
      skipped.push({ keyword: row.keyword, reason: '品牌词' })
      continue
    }
    if (isCompetitorBrand(row.keyword, competitorRoots)) {
      skipped.push({ keyword: row.keyword, reason: '竞品品牌词' })
      continue
    }
    const key = tokenKey(row.keyword)
    if (!key) continue
    const member: KeywordMember = {
      keyword: row.keyword,
      position,
      volume: row.search_volume,
      kd: row.keyword_difficulty,
      intent: row.intent,
    }
    const group = clusters.get(key)
    if (group) group.push(member)
    else clusters.set(key, [member])
  }

  const candidates: NearMissCandidate[] = []
  for (const members of Array.from(clusters.values())) {
    const sorted = [...members].sort((a, b) => b.volume - a.volume || a.position - b.position)
    const primary = sorted[0]
    const gain = nextTierCtr(primary.position) - ctrBenchmarkForPosition(Math.round(primary.position))
    candidates.push({
      kind: 'near_miss',
      primary,
      members: sorted,
      potentialClicks: Math.max(0, Math.round(primary.volume * gain)),
    })
  }
  candidates.sort((a, b) => b.potentialClicks - a.potentialClicks)
  return { candidates, skipped }
}

export interface DailyPageRow {
  page_url: string
  clicks: number | null
  impressions: number | null
  position: number | null
}

/** Collapse gsc_page_daily rows into one impression-weighted row per page. */
export function aggregatePageRows(rows: DailyPageRow[]): PageAggRow[] {
  const byUrl = new Map<string, { clicks: number; impressions: number; posWeighted: number; posWeight: number }>()
  for (const r of rows) {
    if (!r.page_url) continue
    const acc = byUrl.get(r.page_url) ?? { clicks: 0, impressions: 0, posWeighted: 0, posWeight: 0 }
    const imp = r.impressions ?? 0
    acc.clicks += r.clicks ?? 0
    acc.impressions += imp
    if (r.position !== null && imp > 0) {
      acc.posWeighted += r.position * imp
      acc.posWeight += imp
    }
    byUrl.set(r.page_url, acc)
  }
  const out: PageAggRow[] = []
  for (const [url, a] of Array.from(byUrl.entries())) {
    if (a.posWeight === 0) continue
    out.push({ url, clicks: a.clicks, impressions: a.impressions, position: a.posWeighted / a.posWeight })
  }
  return out
}

export function buildCtrGapCandidates(pages: PageAggRow[], config: SeoLoopConfig): CtrGapCandidate[] {
  const out: CtrGapCandidate[] = []
  for (const p of pages) {
    if (p.impressions < config.ctrGapMinImpressions) continue
    if (p.position > config.ctrGapMaxPosition) continue
    const benchmark = ctrBenchmarkForPosition(Math.max(1, Math.round(p.position)))
    const ctr = p.clicks / p.impressions
    if (ctr >= benchmark * config.ctrGapRatio) continue
    out.push({
      kind: 'ctr_gap',
      url: p.url,
      clicks: p.clicks,
      impressions: p.impressions,
      position: p.position,
      ctr,
      benchmark,
      potentialClicks: Math.max(0, Math.round(p.impressions * (benchmark - ctr))),
    })
  }
  out.sort((a, b) => b.potentialClicks - a.potentialClicks)
  return out
}

/** Last path segment of a URL, lowercased ('' for the homepage). */
export function slugOf(url: string): string {
  const canon = canonicalUrl(url)
  if (!canon) return ''
  const path = canon.slice(canon.indexOf('/'))
  const segs = path.split('/').filter(Boolean)
  return (segs[segs.length - 1] ?? '').toLowerCase()
}

/** URL excluded from the list: on the meta-cycle protected list, or changed by it recently. */
export function isExcludedUrl(
  url: string,
  protectedSlugs: string[],
  recentMetaUrls: ReadonlySet<string>,
): boolean {
  const canon = canonicalUrl(url)
  if (canon && recentMetaUrls.has(canon)) return true
  const slug = slugOf(url)
  return slug !== '' && protectedSlugs.map(s => s.toLowerCase()).includes(slug)
}

export interface SitePageRow {
  url: string
  path: string | null
  title: string | null
  h1: string | null
  word_count: number | null
}

/**
 * Own pages whose title / H1 / path mention EVERY token of the keyword.
 * A text match, not a rank fact — the item must label it 很可能, never 确认.
 */
// AU/NZ platform: a country code in a query is spelt out in page copy ("nz" ≈ "New Zealand(ers)").
const TOKEN_ALIASES: Record<string, string[]> = {
  nz: ['nz', 'zealand'],
  au: ['au', 'australia', 'australian'],
}

export function matchOwnPages(keyword: string, pages: SitePageRow[]): SitePageRow[] {
  const tokens = tokenKey(keyword).split(' ').filter(Boolean)
  if (tokens.length === 0) return []
  return pages.filter(p => {
    const hay = `${p.title ?? ''} ${p.h1 ?? ''} ${p.path ?? p.url}`.toLowerCase()
    return tokens.every(t => (TOKEN_ALIASES[t] ?? [t]).some(alias => hay.includes(alias)))
  })
}
