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
import { identityFromUrl, matchProtected } from '@/lib/seo/protected-pages'
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
  /** Rough extra clicks/month if the primary reached the next tier, from the generic CTR curve. A sort key, not a forecast. */
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
const DIRECTIONAL = new Set(['to', 'from', 'vs', 'versus', 'into', 'between'])

export function tokenKey(keyword: string): string {
  // apostrophes join, not split: "xi'an" is the same word as "xian"
  const all = keyword.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(t => t.length > 0)
  // "A to B" and "B to A" are different searches: a phrase with a direction word keeps its order.
  if (all.some(t => DIRECTIONAL.has(t))) return `>${all.filter(t => !STOPWORDS.has(t) || DIRECTIONAL.has(t)).join(' ')}`
  const tokens = all.filter(t => !STOPWORDS.has(t))
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

const GENERIC_WORDS = ['travel', 'travels', 'tours', 'tour', 'trip', 'trips', 'holiday', 'holidays', 'guide', 'world', 'journeys', 'journey', 'newzealand', 'australia', 'china', 'asia', 'explore', 'adventure', 'discover', 'vacations', 'worldwide', 'group', 'the', 'and', 'of']

/** A domain root made ONLY of generic words ("worldjourneys", "newzealand") is not a brand marker. */
function isGenericRoot(root: string): boolean {
  let rest = root
  let progressed = true
  while (rest.length > 0 && progressed) {
    progressed = false
    for (const w of GENERIC_WORDS) {
      if (rest.startsWith(w)) {
        rest = rest.slice(w.length)
        progressed = true
        break
      }
    }
  }
  return rest.length === 0
}

/** The competitor root contained in the keyword (e.g. "wendywu" from wendywutours.co.nz), or null. */
export function competitorBrandMatch(keyword: string, competitorRoots: string[]): string | null {
  const flat = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return competitorRoots.find(root => root.length >= 6 && !isGenericRoot(root) && flat.includes(root)) ?? null
}

function nextTierCtr(position: number): number {
  if (position > 10) return ctrBenchmarkForPosition(10)
  if (position > 5) return ctrBenchmarkForPosition(5)
  return ctrBenchmarkForPosition(3)
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
  // A topic already ranking top-3 under another phrasing is covered — not a gap.
  const coveredKeys = new Set<string>()
  for (const row of rows) {
    if (row.position !== null && row.position <= 3) coveredKeys.add(tokenKey(row.keyword))
  }

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
    const competitor = competitorBrandMatch(row.keyword, competitorRoots)
    if (competitor) {
      skipped.push({ keyword: row.keyword, reason: `竞品品牌词（${competitor}）` })
      continue
    }
    const key = tokenKey(row.keyword)
    if (!key || key === '>') {
      skipped.push({ keyword: row.keyword, reason: '没有可识别的拉丁字符词，未处理' })
      continue
    }
    if (coveredKeys.has(key)) continue
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
    const potentialClicks = Math.round(primary.volume * gain)
    if (potentialClicks <= 0) continue
    candidates.push({ kind: 'near_miss', primary, members: sorted, potentialClicks })
  }
  candidates.sort((a, b) => b.potentialClicks - a.potentialClicks)
  return { candidates, skipped }
}

export interface DailyPageRow {
  page_url: string
  /** YYYY-MM-DD; present when the query selects it (used to check a window is fully loaded). */
  day?: string
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

/** URL excluded from the list: on the protected-page list, or changed by the meta-cycle recently. */
export function isExcludedUrl(
  url: string,
  protectedEntries: readonly string[],
  recentMetaUrls: ReadonlySet<string>,
): boolean {
  const canon = canonicalUrl(url)
  if (canon && recentMetaUrls.has(canon)) return true
  const identity = identityFromUrl(url)
  // Fail-closed: a URL we cannot normalise is never offered as an opportunity.
  if (identity.unresolved !== null) return true
  return matchProtected(protectedEntries, identity)
}

export interface SitePageRow {
  url: string
  path: string | null
  title: string | null
  h1: string | null
  word_count: number | null
  crawled_at?: string | null
  crawl_status?: string | null
}

/**
 * Own pages whose title / H1 / path mention EVERY token of the keyword.
 * A text match, not a rank fact — the item must label it 很可能, never 确认.
 */
// AU/NZ platform: a country code in a query is spelt out in page copy ("nz" ≈ "New Zealand(ers)").
// Aliases match a WHOLE page-text word by prefix; ordinary tokens match a whole word (plural-insensitive).
const TOKEN_ALIAS_PREFIXES: Record<string, string[]> = {
  nz: ['nz', 'zealand'],
  au: ['au', 'austral'],
}

function pageWords(p: SitePageRow): Set<string> {
  let path = p.path
  if (!path) {
    try {
      path = new URL(p.url).pathname // never the host: "co.nz" must not make every page an "nz" page
    } catch {
      path = ''
    }
  }
  return new Set(`${p.title ?? ''} ${p.h1 ?? ''} ${path}`.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean))
}

export function matchOwnPages(keyword: string, pages: SitePageRow[]): SitePageRow[] {
  const tokens = tokenKey(keyword).replace(/^>/, '').split(' ').filter(Boolean)
  if (tokens.length === 0) return []
  return pages.filter(p => {
    const words = pageWords(p)
    const list = Array.from(words)
    return tokens.every(t => {
      const prefixes = TOKEN_ALIAS_PREFIXES[t]
      if (prefixes) return list.some(w => w === t || prefixes.some(pre => w.startsWith(pre) && (pre.length > 2 || w === pre)))
      return words.has(t) || words.has(`${t}s`) || (t.endsWith('s') && words.has(t.slice(0, -1)))
    })
  })
}
