/**
 * POST /api/cron/oztop-seo-optimizer
 *
 * Oztop SEO Automation Loop — Phase 22.E extension
 *
 * Pipeline:
 *   1. Read GSC snapshots → find keywords at position 4-15 ("easy win zone")
 *   2. Match keywords to WordPress pages via URL slug analysis
 *   3. Fetch current meta (title, description) from WP REST API
 *   4. AI-generate optimised meta using Claude (60-char title / 155-char desc)
 *   5. PATCH changes back to WP via REST API (requires WP_APP_PASSWORD env)
 *   6. Write fde_work_logs entry with summary
 *
 * Auth: POST with Authorization: Bearer $CRON_SECRET
 *       OR pass ?dry_run=true to preview without writing to WP
 *
 * Env vars required:
 *   CRON_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   ANTHROPIC_API_KEY,
 *   OZTOP_WP_USERNAME  (WP user login, e.g. "admin")
 *   OZTOP_WP_APP_PASSWORD  (WP Application Password, spaces OK)
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OZTOP_CLIENT_ID = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const OZTOP_WP_BASE = 'https://oztopbuildingsupplies.com.au/wp-json/wp/v2'
const FDE_EMAIL = 'bigbigraydeng@gmail.com'

// GSC query row stored in gsc_performance_snapshots.top_queries
interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  page?: string
}

interface WpPage {
  id: number
  slug: string
  link: string
  title: { rendered: string }
  meta?: Record<string, unknown>
  yoast_head_json?: {
    title?: string
    description?: string
  }
}

interface OpportunityKeyword {
  query: string
  position: number
  impressions: number
  clicks: number
  page?: string
}

interface OptimisedMeta {
  keyword: string
  page_id: number
  page_slug: string
  page_url: string
  old_title: string
  old_desc: string
  new_title: string
  new_desc: string
}

// ─── WP REST API helpers ──────────────────────────────────────────────────────

function wpAuthHeader(): string | null {
  const user = process.env.OZTOP_WP_USERNAME
  const pass = process.env.OZTOP_WP_APP_PASSWORD
  if (!user || !pass) return null
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

async function wpFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = wpAuthHeader()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
  }
  return fetch(`${OZTOP_WP_BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> ?? {}) } })
}

async function getWpPages(perPage = 50): Promise<WpPage[]> {
  const pages: WpPage[] = []
  let page = 1
  while (true) {
    const res = await wpFetch(`/pages?per_page=${perPage}&page=${page}&_fields=id,slug,link,title,yoast_head_json`)
    if (!res.ok) break
    const batch = await res.json() as WpPage[]
    pages.push(...batch)
    if (batch.length < perPage) break
    page++
  }
  return pages
}

async function getWpPosts(perPage = 50): Promise<WpPage[]> {
  const posts: WpPage[] = []
  let page = 1
  while (true) {
    const res = await wpFetch(`/posts?per_page=${perPage}&page=${page}&_fields=id,slug,link,title,yoast_head_json`)
    if (!res.ok) break
    const batch = await res.json() as WpPage[]
    posts.push(...batch)
    if (batch.length < perPage) break
    page++
  }
  return posts
}

async function patchWpMeta(type: 'pages' | 'posts', id: number, title: string, desc: string): Promise<boolean> {
  const res = await wpFetch(`/${type}/${id}`, {
    method: 'POST',
    body: JSON.stringify({
      meta: {
        _yoast_wpseo_title: title,
        _yoast_wpseo_metadesc: desc,
      },
    }),
  })
  return res.ok
}

// ─── Keyword → page matching ──────────────────────────────────────────────────

/**
 * Find the best matching WP page/post for a keyword.
 * Matches keyword tokens against the URL slug.
 */
function matchKeywordToPage(
  keyword: string,
  allContent: Array<WpPage & { _type: 'pages' | 'posts' }>,
  gscPage?: string,
): (WpPage & { _type: 'pages' | 'posts' }) | null {
  // If GSC recorded which URL, try exact slug match first
  if (gscPage) {
    const slugFromUrl = gscPage.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '')
    const exact = allContent.find(c => c.slug === slugFromUrl || c.link.includes(slugFromUrl))
    if (exact) return exact
  }

  // Fuzzy: count keyword tokens present in slug
  const tokens = keyword.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  let best: (WpPage & { _type: 'pages' | 'posts' }) | null = null
  let bestScore = 0

  for (const item of allContent) {
    const slug = item.slug.toLowerCase()
    const score = tokens.filter(t => slug.includes(t)).length
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }

  return bestScore >= 2 ? best : null
}

// ─── AI meta generation ───────────────────────────────────────────────────────

async function generateOptimisedMeta(
  keyword: string,
  currentTitle: string,
  currentDesc: string,
  pageUrl: string,
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are an SEO specialist optimising meta tags for an Australian flooring store in South Brisbane.

Target keyword: "${keyword}"
Page URL: ${pageUrl}
Current meta title: "${currentTitle}"
Current meta description: "${currentDesc}"

Rules:
- Title: max 60 characters, include the keyword naturally, include "Brisbane" if not already there, end with "| Oztop" if space allows
- Description: max 155 characters, include the keyword, mention Brisbane/South Brisbane, include a call to action
- Use Australian English spelling
- Sound natural and professional, not spammy
- Do NOT use quotation marks inside the title or description

Respond with ONLY valid JSON (no markdown), exactly:
{"title": "...", "desc": "..."}`

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  try {
    const parsed = JSON.parse(text) as { title: string; desc: string }
    return {
      title: parsed.title.slice(0, 60),
      desc:  parsed.desc.slice(0, 155),
    }
  } catch {
    return { title: currentTitle, desc: currentDesc }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true'
  const maxKeywords = parseInt(req.nextUrl.searchParams.get('max') ?? '5')

  // ── Step 1: Read GSC opportunity keywords ──────────────────────────────────
  const { data: snapshots, error: gscError } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('top_queries, period_start, period_end')
    .eq('client_id', OZTOP_CLIENT_ID)
    .order('period_start', { ascending: false })
    .limit(1)
    .single()

  if (gscError || !snapshots) {
    return NextResponse.json({ error: 'No GSC data found for Oztop', detail: gscError?.message }, { status: 404 })
  }

  const allQueries = (snapshots.top_queries ?? []) as GscQueryRow[]
  const opportunities: OpportunityKeyword[] = allQueries
    .filter(q => q.position >= 4 && q.position <= 20 && q.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, maxKeywords)

  if (opportunities.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No opportunity keywords found (position 4-20, ≥10 impressions)',
      period: `${snapshots.period_start} → ${snapshots.period_end}`,
    })
  }

  // ── Step 2: Fetch WP content ───────────────────────────────────────────────
  const [wpPages, wpPosts] = await Promise.all([getWpPages(), getWpPosts()])
  const allContent: Array<WpPage & { _type: 'pages' | 'posts' }> = [
    ...wpPages.map(p => ({ ...p, _type: 'pages' as const })),
    ...wpPosts.map(p => ({ ...p, _type: 'posts' as const })),
  ]

  // ── Steps 3-5: Match → AI → Patch ─────────────────────────────────────────
  const results: OptimisedMeta[] = []
  const skipped: string[] = []
  const hasWpAuth = !!wpAuthHeader()

  for (const opp of opportunities) {
    const matched = matchKeywordToPage(opp.query, allContent, opp.page)
    if (!matched) {
      skipped.push(`"${opp.query}" — no matching page`)
      continue
    }

    const currentTitle = matched.yoast_head_json?.title ?? matched.title.rendered ?? ''
    const currentDesc  = matched.yoast_head_json?.description ?? ''

    const { title: newTitle, desc: newDesc } = await generateOptimisedMeta(
      opp.query, currentTitle, currentDesc, matched.link,
    )

    // Skip if AI didn't improve anything meaningful
    if (newTitle === currentTitle && newDesc === currentDesc) {
      skipped.push(`"${opp.query}" — no change generated`)
      continue
    }

    const optimised: OptimisedMeta = {
      keyword:   opp.query,
      page_id:   matched.id,
      page_slug: matched.slug,
      page_url:  matched.link,
      old_title: currentTitle,
      old_desc:  currentDesc,
      new_title: newTitle,
      new_desc:  newDesc,
    }
    results.push(optimised)

    if (!dryRun && hasWpAuth) {
      await patchWpMeta(matched._type, matched.id, newTitle, newDesc)
    }
  }

  // ── Step 6: Write work log ─────────────────────────────────────────────────
  if (!dryRun && results.length > 0) {
    const summary = [
      `【SEO】自动优化 ${results.length} 个页面 meta（GSC 机会区 position 4-20）`,
      ...results.map(r => `  · "${r.keyword}" → ${r.page_slug}`),
      skipped.length > 0 ? `跳过 ${skipped.length} 个：${skipped.slice(0, 3).join('，')}` : '',
      `下一步：在 WP 后台验证 meta 更新是否生效`,
    ].filter(Boolean).join('\n')

    await supabaseAdmin.from('fde_work_logs').insert({
      client_id:    OZTOP_CLIENT_ID,
      log_date:     new Date().toISOString().slice(0, 10),
      summary,
      author_email: FDE_EMAIL,
    })
  }

  return NextResponse.json({
    success:   true,
    dry_run:   dryRun,
    wp_auth:   hasWpAuth,
    period:    `${snapshots.period_start} → ${snapshots.period_end}`,
    opportunities: opportunities.length,
    optimised: results,
    skipped,
    message:   dryRun
      ? `Dry run: ${results.length} pages would be updated`
      : hasWpAuth
        ? `Updated ${results.length} pages in WordPress`
        : `WP_APP_PASSWORD not set — optimised meta generated but NOT written to WordPress`,
  })
}
