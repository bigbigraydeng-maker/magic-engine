/**
 * Related Site Pages — Phase 8.D.2.1
 *
 * Finds the top-N existing pages on a client domain that share content
 * with a proposed new piece, so the blog generator can be told
 * "do not duplicate; differentiate from these".
 *
 * Reference: ROADMAP.md P8.D.2.1
 */

import { listSitePages } from '@/lib/db/site-pages'
import type { SitePage } from '@/types/magic-engine'

const SUMMARY_CHARS = 240
const DEFAULT_LIMIT = 5
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','how','what','why','when','who',
  'do','does','did','will','would','can','could','should','best','top',
  'your','my','our','their','its','this','that','these','those','from',
  'by','about','which','get','have','has','had','not','no','yes','new',
])

export interface RelatedPagesQuery {
  topic?: string
  primary_keyword?: string
  topics?: string[]
}

export interface RelatedPageSummary {
  url: string
  title: string | null
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
  content_summary: string | null
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
  )
}

function scorePage(p: SitePage, q: RelatedPagesQuery): number {
  let score = 0

  // 1. Topic tag overlap (strongest)
  if (q.topics && q.topics.length > 0 && p.topics?.length > 0) {
    const queryTopics = new Set(q.topics.map((t) => t.toLowerCase()))
    const overlap = p.topics.filter((t) => queryTopics.has(t.toLowerCase())).length
    score += overlap * 10
  }

  // 2. Primary keyword exact match
  if (q.primary_keyword && p.primary_keyword) {
    if (p.primary_keyword.toLowerCase() === q.primary_keyword.toLowerCase()) {
      score += 20
    }
  }

  // 3. Title / topic word overlap
  const queryText = [q.topic, q.primary_keyword, ...(q.topics ?? [])]
    .filter(Boolean)
    .join(' ')
  if (queryText.length > 0) {
    const qTokens = tokens(queryText)
    if (qTokens.size > 0) {
      const pageText = [p.title, p.h1, p.primary_keyword, ...p.topics].filter(Boolean).join(' ')
      const pTokens = tokens(pageText)
      let shared = 0
      Array.from(qTokens).forEach((t) => {
        if (pTokens.has(t)) shared++
      })
      score += shared * 2
    }
  }

  return score
}

export async function findRelatedPages(
  clientId: string,
  query: RelatedPagesQuery,
  limit: number = DEFAULT_LIMIT
): Promise<RelatedPageSummary[]> {
  const pages = await listSitePages(clientId, { crawl_status: 'crawled' })

  const scored = pages
    .map((p) => ({ page: p, score: scorePage(p, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored.map(({ page: p }) => ({
    url: p.url,
    title: p.title,
    topics: p.topics ?? [],
    primary_keyword: p.primary_keyword,
    word_count: p.word_count,
    has_geo_block: p.has_geo_block,
    content_summary: p.content_summary
      ? p.content_summary.slice(0, SUMMARY_CHARS)
      : null,
  }))
}

export function formatPagesForPrompt(pages: RelatedPageSummary[]): string {
  if (!pages || pages.length === 0) {
    return 'EXISTING PAGES ON SITE: (no existing pages match this topic — write a fresh, comprehensive article)'
  }
  const lines = pages.map((p, i) => {
    const flags = [
      p.word_count != null ? `${p.word_count}w` : null,
      p.has_geo_block ? 'GEO✓' : 'no-GEO',
    ]
      .filter(Boolean)
      .join(', ')
    const topics = p.topics.length > 0 ? ` topics:[${p.topics.join(', ')}]` : ''
    const summary = p.content_summary ? `\n     summary: ${p.content_summary}` : ''
    return `  ${i + 1}. "${p.title ?? '(untitled)'}" — ${p.url} (${flags})${topics}${summary}`
  })
  return [
    'EXISTING PAGES ON SITE COVERING RELATED TOPICS — DO NOT DUPLICATE; differentiate the new article from these:',
    ...lines,
  ].join('\n')
}
