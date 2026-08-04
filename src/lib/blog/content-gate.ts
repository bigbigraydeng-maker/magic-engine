/**
 * Content duplicate gate — the ONE authority every blog-generation path
 * consults before writing a word (2026-08-01 root fix).
 *
 * Incident: the weekly cron drafted "How to plan your first trip to China
 * from NZ" for CTS while the client's site already had a near-identical
 * published article. Two path-specific dedup patches both missed it: the
 * cron's topic blocklist only looked back 60 days (the live article was 64
 * days old) and the site-content audit had no crawl data to compare against.
 *
 * Root cause: no single source of truth for "what does this client already
 * have". This gate is that source. It checks a candidate topic against:
 *
 *   1. blog_posts — PERMANENT for anything published or on its way
 *      (published / pr_open / approved), plus any live draft/generating row
 *      (a duplicate draft is still a duplicate). No time windows: published
 *      content never stops being a duplicate.
 *   2. client_site_pages — the crawled site inventory (weekly-refreshed by
 *      site-audit-weekly), catching content that predates ME entirely.
 *
 * Matching is deterministic and cheap (slug equality, exact keyword,
 * title-token Jaccard) — it runs on every generation. The AI-powered
 * auditExistingContent remains a SECOND opinion after this gate passes.
 *
 * Callers: manual route (POST /api/clients/[id]/blog), weekly-blog cron.
 * Patrol R4 stays covered by its own keyword-coverage check.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

/** Jaccard similarity at/above this = same topic. */
const DUPLICATE_THRESHOLD = 0.6

/** Statuses that make a blog_posts row a permanent duplicate source. */
const PERMANENT_STATUSES = ['published', 'pr_open', 'approved'] as const
/** Live in-flight rows — also duplicates while they exist. */
const LIVE_STATUSES = ['draft', 'generating'] as const

export interface GateCandidate {
  topic: string
  primary_keyword?: string | null
  slug?: string | null
}

export type GateVerdict =
  | { verdict: 'new' }
  | {
      verdict: 'duplicate'
      source: 'blog_post' | 'site_page'
      existing_title: string | null
      existing_ref: string
    }

// ── Pure text matching ──────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'from', 'with',
  'is', 'are', 'what', 'whats', 'which', 'who', 'how', 'do', 'does', 'i',
  'my', 'your', 'can', 'best', 'near', 'me',
])

export function topicTokens(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  )
}

export function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of Array.from(a)) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

export function normalizeSlug(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toLowerCase().replace(/^\/+|\/+$/g, '').split('/').pop() ?? ''
  return s.replace(/\.(md|html?)$/, '') || null
}

/** Slug → token set ("how-to-plan-first-trip" behaves like a title). */
function slugTokens(slug: string | null): Set<string> {
  return slug ? topicTokens(slug.replace(/-/g, ' ')) : new Set()
}

export interface ExistingContent {
  source: 'blog_post' | 'site_page'
  title: string | null
  slug: string | null
  ref: string
  keyword: string | null
}

/** Pure core: does the candidate duplicate any existing item? */
export function findDuplicate(
  candidate: GateCandidate,
  existing: ExistingContent[],
): ExistingContent | null {
  const candTokens = topicTokens(candidate.topic)
  const candSlug = normalizeSlug(candidate.slug)
  const candKeyword = candidate.primary_keyword?.toLowerCase().trim() || null

  for (const item of existing) {
    const itemSlug = normalizeSlug(item.slug)

    if (candSlug && itemSlug && candSlug === itemSlug) return item
    if (candKeyword && item.keyword && candKeyword === item.keyword.toLowerCase().trim()) {
      return item
    }

    const itemTokens = item.title ? topicTokens(item.title) : slugTokens(itemSlug)
    if (tokenJaccard(candTokens, itemTokens) >= DUPLICATE_THRESHOLD) return item

    // Slug carries the topic when titles diverge (site pages often do).
    const itemSlugTokens = slugTokens(itemSlug)
    if (itemSlugTokens.size > 0 && tokenJaccard(candTokens, itemSlugTokens) >= DUPLICATE_THRESHOLD) {
      return item
    }
  }
  return null
}

// ── Gate (DB-backed) ────────────────────────────────────────────────────────────

export async function checkContentDuplicate(
  clientId: string,
  candidate: GateCandidate,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<GateVerdict> {
  const [{ data: posts }, { data: pages }] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('title, topic, slug, status, primary_keyword')
      .eq('client_id', clientId)
      .in('status', [...PERMANENT_STATUSES, ...LIVE_STATUSES]),
    supabase
      .from('client_site_pages')
      .select('url, title, primary_keyword')
      .eq('client_id', clientId)
      .eq('crawl_status', 'crawled'),
  ])

  const existing: ExistingContent[] = [
    ...((posts ?? []) as Array<{
      title: string | null
      topic: string | null
      slug: string | null
      status: string
      primary_keyword: string | null
    }>).map((p) => ({
      source: 'blog_post' as const,
      title: p.title ?? p.topic,
      slug: p.slug,
      ref: p.slug ?? p.title ?? p.topic ?? 'blog post',
      keyword: p.primary_keyword,
    })),
    ...((pages ?? []) as Array<{
      url: string
      title: string | null
      primary_keyword: string | null
    }>).map((p) => ({
      source: 'site_page' as const,
      title: p.title,
      slug: p.url,
      ref: p.url,
      keyword: p.primary_keyword,
    })),
  ]

  const hit = findDuplicate(candidate, existing)
  if (!hit) return { verdict: 'new' }

  return {
    verdict: 'duplicate',
    source: hit.source,
    existing_title: hit.title,
    existing_ref: hit.ref,
  }
}
