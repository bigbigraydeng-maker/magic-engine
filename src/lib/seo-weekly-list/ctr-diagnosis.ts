/**
 * CTR diagnosis for a page that ranks on page 1 but gets few clicks.
 *
 * Pure: takes the page's own Google search queries (fetched by the runner, free Google
 * read), the page title, and site data already in the DB. Every statement it produces is
 * mechanically checkable (title length, word overlap, shares computed from the rows) —
 * it never says WHY a human searcher did not click, only which known causes the data
 * supports. Output feeds the list item's "怎么做" so the person does not start from zero.
 */

import { ctrBenchmarkForPosition } from '@/lib/seo-patrol/rules'
import { isBrandedKeywordWithAliases } from '@/lib/seo-intelligence/intent-strategy'
import { canonicalUrl } from '@/lib/url/canonical-url'
import type { PageAggRow, SitePageRow } from './candidates'
import { snippetQuickFixes, type LiveSnippet } from './live-snippet'

export interface PageQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface QueryLine {
  query: string
  impressions: number
  clicks: number
  ctr: number
  position: number
  benchmark: number
  underperforming: boolean
  inTitle: boolean
}

export interface SiblingPage {
  url: string
  impressions: number
  clicks: number
  sharedTerms: string[]
}

export type CtrCause = 'siblings' | 'low_rank_queries' | 'title_mismatch' | 'title_truncated' | 'no_query_data' | 'unclear'

export interface CtrDiagnosis {
  cause: CtrCause
  queriesAvailable: boolean
  topQueries: QueryLine[]
  /** Share (0..1) of the fetched queries' impressions coming from queries ranking at 8 or worse. */
  lowRankShare: number | null
  brandedShare: number | null
  /** Top-3 queries by impressions whose words are not all in the page title. */
  titleMisses: string[]
  siblings: SiblingPage[]
  titleLength: number | null
  titleTruncated: boolean
  /** Where the title facts come from: the real <title> read live, or nothing trustworthy. */
  titleSource: 'live' | 'unavailable'
  /** Mechanical defects of the real search snippet (duplicate brand tail, over-long title …). */
  quickFixes: string[]
  liveTitle: string | null
}

const TITLE_TRUNCATION_CHARS = 60
const MIN_QUERY_IMPRESSIONS = 30
const STOP = new Set(['a', 'an', 'the', 'for', 'of', 'to', 'in', 'on', 'and', 'with', 'from', 'is', 'are', 'how', 'what', 'do', 'does', 'i', 'my'])

function words(text: string): string[] {
  return text.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 0)
}

function stem(w: string): string {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
}

function contentWords(text: string): string[] {
  return Array.from(new Set(words(text).filter(w => !STOP.has(w)).map(stem)))
}

function pagePath(p: SitePageRow): string {
  if (p.path) return p.path
  try {
    return new URL(p.url).pathname
  } catch {
    return ''
  }
}

function pageTerms(p: SitePageRow): string[] {
  return contentWords(`${p.title ?? ''} ${pagePath(p)}`)
}

export interface DiagnoseInput {
  page: { url: string; impressions: number }
  title: string | null
  queries: PageQueryRow[] | null
  /** The page's real <title>/description read from the live HTML; null when it could not be fetched. */
  live?: LiveSnippet | null
  sitePages: SitePageRow[]
  pageAgg: PageAggRow[]
  brandRoot: string
  brandAliases: string[] | null
}

/** Pages sharing ≥2 DISTINCTIVE words (document frequency ≤ 15% of the site) with this page, with real traffic. */
export function findSiblings(input: Pick<DiagnoseInput, 'page' | 'title' | 'sitePages' | 'pageAgg'>): SiblingPage[] {
  const self = input.sitePages.find(p => canonicalUrl(p.url) === canonicalUrl(input.page.url))
  const selfTerms = new Set(self ? pageTerms(self) : contentWords(`${input.title ?? ''} ${input.page.url}`))
  const df = new Map<string, number>()
  for (const p of input.sitePages) for (const t of pageTerms(p)) df.set(t, (df.get(t) ?? 0) + 1)
  const maxDf = Math.max(2, Math.floor(input.sitePages.length * 0.15))
  const distinctive = Array.from(selfTerms).filter(t => (df.get(t) ?? 0) <= maxDf)
  if (distinctive.length < 2) return []
  const agg = new Map<string, PageAggRow>()
  for (const a of input.pageAgg) {
    const c = canonicalUrl(a.url)
    if (c) agg.set(c, a)
  }
  const selfCanon = canonicalUrl(input.page.url)
  const out: SiblingPage[] = []
  for (const p of input.sitePages) {
    const c = canonicalUrl(p.url)
    if (!c || c === selfCanon) continue
    const terms = new Set(pageTerms(p))
    const shared = distinctive.filter(t => terms.has(t))
    const stats = agg.get(c)
    if (shared.length >= 2 && stats && stats.impressions >= 100) {
      out.push({ url: p.url, impressions: stats.impressions, clicks: stats.clicks, sharedTerms: shared })
    }
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, 4)
}

export function diagnoseCtrGap(input: DiagnoseInput): CtrDiagnosis {
  // Title facts come ONLY from the live <title>. client_site_pages.title is the page heading (H1), not the
  // string Google shows, so it is never used for length / truncation / word-match checks.
  const liveTitle = input.live?.title ?? null
  const titleLength = liveTitle ? liveTitle.length : null
  const titleTruncated = titleLength !== null && titleLength > TITLE_TRUNCATION_CHARS
  const titleSource: CtrDiagnosis['titleSource'] = liveTitle ? 'live' : 'unavailable'
  const quickFixes = input.live ? snippetQuickFixes(input.live, input.brandAliases) : []
  const siblings = findSiblings(input)
  const titleWords = new Set(contentWords(liveTitle ?? ''))

  if (!input.queries || input.queries.length === 0) {
    return {
      cause: siblings.length > 0 ? 'siblings' : titleTruncated ? 'title_truncated' : 'no_query_data',
      queriesAvailable: false, topQueries: [], lowRankShare: null, brandedShare: null, titleMisses: [], siblings, titleLength, titleTruncated,
      titleSource, quickFixes, liveTitle,
    }
  }

  const rows = [...input.queries].sort((a, b) => b.impressions - a.impressions)
  const totalImp = rows.reduce((n, r) => n + r.impressions, 0)
  const lowRankImp = rows.filter(r => r.position >= 8).reduce((n, r) => n + r.impressions, 0)
  const brandedImp = rows.filter(r => isBrandedKeywordWithAliases(r.query, input.brandRoot, input.brandAliases)).reduce((n, r) => n + r.impressions, 0)
  const topQueries: QueryLine[] = rows.slice(0, 5).map(r => {
    const benchmark = ctrBenchmarkForPosition(Math.max(1, Math.round(r.position)))
    const qWords = contentWords(r.query)
    return {
      query: r.query, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position, benchmark,
      underperforming: r.impressions >= MIN_QUERY_IMPRESSIONS && r.ctr < benchmark * 0.6,
      inTitle: qWords.length > 0 && qWords.every(w => titleWords.has(w)),
    }
  })
  const titleMisses = !liveTitle ? [] : rows.slice(0, 3).filter(r => {
    const q = contentWords(r.query)
    return q.length > 0 && !q.every(w => titleWords.has(w)) && !isBrandedKeywordWithAliases(r.query, input.brandRoot, input.brandAliases)
  }).map(r => r.query)

  const lowRankShare = totalImp > 0 ? lowRankImp / totalImp : null
  const brandedShare = totalImp > 0 ? brandedImp / totalImp : null
  let cause: CtrCause = 'unclear'
  if (siblings.length > 0) cause = 'siblings'
  else if (lowRankShare !== null && lowRankShare >= 0.5) cause = 'low_rank_queries'
  else if (titleMisses.length > 0) cause = 'title_mismatch'
  else if (titleTruncated) cause = 'title_truncated'
  return { cause, queriesAvailable: true, topQueries, lowRankShare, brandedShare, titleMisses, siblings, titleLength, titleTruncated, titleSource, quickFixes, liveTitle }
}

export const CAUSE_LABEL: Record<CtrCause, string> = {
  siblings: '同主题有别的自家页面在分食曝光',
  low_rank_queries: '曝光主要来自排第 8 名及以后的词（名次问题，不是标题问题）',
  title_mismatch: '这页最大的搜索词没有出现在标题里',
  title_truncated: '标题过长，在谷歌里会被截断',
  no_query_data: '没取到这页的搜索词数据，只能做线上标题和同主题页面检查',
  unclear: '数据没有指向明确原因',
}
