/**
 * Content Auditor — checks if the client's site already has content
 * covering a given topic before generating a new blog post.
 *
 * Strategy:
 *  1. Fetch the client's blog index / sitemap via Jina.ai Reader
 *  2. Extract candidate article titles + URLs
 *  3. Use GPT-4o mini to compare intent between the target topic and existing articles
 *  4. Return: 'upgrade' (same intent, should enhance existing) | 'new' (safe to create)
 *
 * Reference: ROADMAP.md P7.3 content strategy
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { supabaseAdmin } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditAction = 'upgrade' | 'new'

export interface ContentAuditResult {
  action: AuditAction
  /** URL of the existing article if action === 'upgrade' */
  existing_url: string | null
  /** Title of the existing article if action === 'upgrade' */
  existing_title: string | null
  /** Human-readable explanation for UI display */
  reason: string
  /** 0–1: how confident the model is in this recommendation */
  confidence: number
  /** All blog URLs discovered on the site (for reference) */
  discovered_urls: string[]
}

interface CandidateArticle {
  url: string
  title: string
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetch all pages for a client from client_site_pages and convert to CandidateArticle[].
 * Returns [] on any error so callers can always safely fall through.
 *
 * Phase 8.2.3 — extends audit scope beyond web-crawled blog paths.
 */
export async function fetchSitePagesAsCandidates(clientId: string): Promise<CandidateArticle[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_site_pages')
      .select('id, url, title, page_type, topics, primary_keyword')
      .eq('client_id', clientId)

    if (error || !data) return []

    return (data as Array<{
      id: string
      url: string
      title: string | null
      page_type: string
      topics: string[]
      primary_keyword: string | null
    }>).map(page => ({
      url: page.url,
      title: page.title ?? slugToTitle(page.url),
    }))
  } catch {
    return []
  }
}

/**
 * Audit whether the client already has content matching the given topic.
 *
 * @param domain    - e.g. "https://www.ctstours.co.nz" (with or without trailing slash)
 * @param topic     - the proposed blog topic string
 * @param queryText - the AI Tracker question being targeted (optional, enriches comparison)
 * @param clientId  - when provided, also checks client_site_pages DB records (Phase 8.2.3)
 */
export async function auditExistingContent(
  domain: string,
  topic: string,
  queryText?: string,
  clientId?: string
): Promise<ContentAuditResult> {
  const base = domain.replace(/\/$/, '')

  // 1a. Discover existing blog articles via web crawl
  const webCandidates = await discoverBlogArticles(base)

  // 1b. Merge DB-sourced pages when clientId is provided (Phase 8.2.3)
  const dbCandidates = clientId ? await fetchSitePagesAsCandidates(clientId).catch(() => []) : []

  // Deduplicate by URL (DB may overlap with web crawl)
  const seen = new Set(webCandidates.map(c => c.url))
  const uniqueDbCandidates = dbCandidates.filter(c => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })

  const candidates = [...webCandidates, ...uniqueDbCandidates]

  if (candidates.length === 0) {
    return {
      action: 'new',
      existing_url: null,
      existing_title: null,
      reason: 'No existing blog articles found on the site — safe to create new content.',
      confidence: 0.9,
      discovered_urls: [],
    }
  }

  // 2. Quick keyword pre-filter — only send plausibly related articles to GPT
  const filtered = preFilterByKeyword(candidates, topic, queryText)

  if (filtered.length === 0) {
    return {
      action: 'new',
      existing_url: null,
      existing_title: null,
      reason: `Found ${candidates.length} existing articles but none appear related to this topic.`,
      confidence: 0.85,
      discovered_urls: candidates.map(c => c.url),
    }
  }

  // 3. GPT-4o mini intent comparison
  if (!process.env.OPENAI_API_KEY) {
    // Graceful fallback: can't audit without OpenAI — don't block generation
    return {
      action: 'new',
      existing_url: null,
      existing_title: null,
      reason: 'Content audit skipped (OPENAI_API_KEY not available).',
      confidence: 0,
      discovered_urls: candidates.map(c => c.url),
    }
  }

  return compareIntentWithGPT({
    topic,
    queryText,
    candidates: filtered,
    allDiscovered: candidates,
  })
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Try to discover blog articles from the domain.
 * Tries: /sitemap.xml → /blog → /news → /articles (first success wins)
 */
async function discoverBlogArticles(base: string): Promise<CandidateArticle[]> {
  const discoveryUrls = [
    `${base}/sitemap.xml`,
    `${base}/blog`,
    `${base}/news`,
    `${base}/articles`,
  ]

  for (const url of discoveryUrls) {
    try {
      const { markdown } = await fetchUrlAsMarkdown(url)
      const articles = extractArticlesFromMarkdown(markdown, base)
      if (articles.length > 0) return articles
    } catch {
      // try next source
    }
  }

  return []
}

/**
 * Extract article URLs + titles from Jina-fetched markdown.
 * Handles both sitemap XML (converted to markdown) and blog index pages.
 */
function extractArticlesFromMarkdown(markdown: string, base: string): CandidateArticle[] {
  const articles: CandidateArticle[] = []
  const seen = new Set<string>()

  // Pattern 1: Markdown links — [Title](URL)
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(markdown)) !== null) {
    const title = match[1].trim()
    const url = match[2].trim()
    if (isBlogUrl(url, base) && !seen.has(url) && title.length > 5) {
      seen.add(url)
      articles.push({ url, title })
    }
  }

  // Pattern 2: Bare URLs in sitemaps (loc tags converted to text)
  const urlPattern = /(https?:\/\/[^\s<>"]+\/blog\/[^\s<>"]+)/g
  while ((match = urlPattern.exec(markdown)) !== null) {
    const url = match[1].trim().replace(/\/$/, '')
    if (!seen.has(url)) {
      seen.add(url)
      // Use slug as title fallback
      const slug = url.split('/').pop() ?? ''
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      if (title.length > 3) articles.push({ url, title })
    }
  }

  return articles.slice(0, 50) // cap at 50 to prevent token explosion
}

function isBlogUrl(url: string, base: string): boolean {
  if (!url.startsWith(base)) return false
  return /\/(blog|news|articles|insights|posts)\//i.test(url)
}

// ─── Pre-filter ───────────────────────────────────────────────────────────────

/**
 * Cheap keyword overlap filter before calling GPT.
 * Keeps only articles whose title/URL shares ≥1 significant word with the topic.
 */
function preFilterByKeyword(
  candidates: CandidateArticle[],
  topic: string,
  queryText?: string
): CandidateArticle[] {
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','are','was','were','be','been','how','what','why','when','who',
    'do','does','did','will','would','can','could','should','may','might',
    'your','my','our','their','its','this','that','these','those',
    'from','by','about','which','get','have','has','had','not','no','yes',
    'new','zealand','nz','australia','au','travellers','travelers','travel',
    'china','chinese',
  ])

  const topicWords = extractSignificantWords(`${topic} ${queryText ?? ''}`, stopWords)
  if (topicWords.size === 0) return candidates // no filter possible

  return candidates.filter(c => {
    const articleWords = extractSignificantWords(`${c.title} ${c.url}`, stopWords)
    const overlap = Array.from(topicWords).filter(w => articleWords.has(w))
    return overlap.length >= 1
  })
}

function extractSignificantWords(text: string, stopWords: Set<string>): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
  )
}

function slugToTitle(url: string): string {
  const slug = url.split('/').filter(Boolean).pop() ?? url
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

// ─── GPT Intent Comparison ────────────────────────────────────────────────────

async function compareIntentWithGPT(params: {
  topic: string
  queryText?: string
  candidates: CandidateArticle[]
  allDiscovered: CandidateArticle[]
}): Promise<ContentAuditResult> {
  const { topic, queryText, candidates, allDiscovered } = params

  const openai = getOpenAIClient()

  const articleList = candidates
    .map((c, i) => `${i + 1}. "${c.title}" — ${c.url}`)
    .join('\n')

  const prompt = `You are a content strategy expert. Determine whether any of the existing articles on a website cover the SAME search intent as a proposed new blog topic.

PROPOSED TOPIC: "${topic}"
${queryText ? `TARGET QUERY: "${queryText}"` : ''}

EXISTING ARTICLES ON SITE:
${articleList}

Analyse INTENT, not just keywords. Two articles share intent if:
- They target the same question/problem
- A reader searching for one would be satisfied by the other
- Publishing both would cause keyword cannibalization

Respond with valid JSON only:
{
  "action": "upgrade" | "new",
  "matching_index": <1-based index of best matching article, or null if action="new">,
  "confidence": <0.0 to 1.0>,
  "reason": "<one sentence explanation for a non-technical user>"
}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 256,
    temperature: 0.1, // low temp for consistency
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'

  type GPTResponse = {
    action?: string
    matching_index?: number | null
    confidence?: number
    reason?: string
  }
  const parsed = JSON.parse(raw) as GPTResponse

  const action: AuditAction = parsed.action === 'upgrade' ? 'upgrade' : 'new'
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5

  // Only recommend upgrade if confidence is high enough
  const effectiveAction: AuditAction =
    action === 'upgrade' && confidence >= 0.7 ? 'upgrade' : 'new'

  let existingUrl: string | null = null
  let existingTitle: string | null = null

  if (effectiveAction === 'upgrade' && typeof parsed.matching_index === 'number') {
    const match = candidates[parsed.matching_index - 1]
    if (match) {
      existingUrl = match.url
      existingTitle = match.title
    }
  }

  return {
    action: effectiveAction,
    existing_url: existingUrl,
    existing_title: existingTitle,
    reason: parsed.reason ?? (
      effectiveAction === 'upgrade'
        ? 'An existing article already covers this topic — recommend upgrading it instead.'
        : 'No conflicting content found — safe to create a new article.'
    ),
    confidence,
    discovered_urls: allDiscovered.map(c => c.url),
  }
}
