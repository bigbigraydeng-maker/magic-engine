import { fetchNewsFeedItemsSafe } from './intake-news-feed-url'
import type { RawFeedItem } from '@/lib/market-intel/types'
import type { ViralRef } from './topic-agent'

const DEFAULT_WINDOW_HOURS = 72

type FetchFeedFn = (feedUrl: string, windowHours?: number) => Promise<RawFeedItem[]>

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const hay = text.toLowerCase()
  return keywords.some((k) => k.trim().length > 0 && hay.includes(k.trim().toLowerCase()))
}

function mapNewsItem(item: RawFeedItem): ViralRef {
  const when = item.publishedAt ? item.publishedAt.slice(0, 10) : '近期'
  return {
    title: item.title,
    transcript: item.excerpt || item.title,
    engagement: `新闻热点·${when}`,
  }
}

function sortByPublishedDesc(items: RawFeedItem[]): RawFeedItem[] {
  return [...items].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return tb - ta
  })
}

function dedupeByTitle(items: RawFeedItem[]): RawFeedItem[] {
  const seen = new Set<string>()
  const out: RawFeedItem[] = []
  for (const item of items) {
    const key = item.title.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export interface FetchNewsViralsOptions {
  keywords: string[]
  maxItems: number
  feedUrls: readonly string[]
  windowHours?: number
  fetchFeedFn?: FetchFeedFn
}

/** Fetch RSS news into ViralRef shape. Never throws; logs via warnings array. */
export async function fetchNewsViralsForIntake(
  opts: FetchNewsViralsOptions,
): Promise<{ items: ViralRef[]; warnings: string[] }> {
  const warnings: string[] = []
  if (opts.feedUrls.length === 0) {
    return { items: [], warnings }
  }
  const fetchFeedFn = opts.fetchFeedFn ?? fetchNewsFeedItemsSafe
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS
  const maxItems = Math.max(1, opts.maxItems)

  const batches = await Promise.all(
    opts.feedUrls.map(async (url) => {
      try {
        return await fetchFeedFn(url, windowHours)
      } catch (e) {
        warnings.push(`新闻 RSS 跳过 ${url}：${e instanceof Error ? e.message : String(e)}`)
        return [] as RawFeedItem[]
      }
    }),
  )

  const merged = dedupeByTitle(sortByPublishedDesc(batches.flat()))
  const keywordHits = merged.filter((item) =>
    matchesKeywords(`${item.title} ${item.excerpt}`, opts.keywords),
  )
  const picked = (keywordHits.length > 0 ? keywordHits : merged).slice(0, maxItems)
  return { items: picked.map(mapNewsItem), warnings }
}
