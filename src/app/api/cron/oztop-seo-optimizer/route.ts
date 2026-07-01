/**
 * POST /api/cron/oztop-seo-optimizer
 *
 * Oztop SEO Automation Loop — runs every Monday 05:00 UTC via render.yaml
 *
 * Two-mode loop:
 *
 *   PAGES mode  — service/location pages
 *     Trigger: position 4-20, impressions ≥ 10
 *     Cooldown: 30 days per slug
 *
 *   POSTS mode  — blog articles (written by ME blog system)
 *     Trigger: position 4-20, impressions ≥ 20, CTR < 2%, post age > 30 days
 *     Cooldown: 60 days per slug (more conservative — blog meta is intentional)
 *
 * Pipeline per item:
 *   1. GSC snapshot → opportunity keywords (pages + posts separately)
 *   2. Filter cooldown slugs from seo_meta_log
 *   3. Match keyword → WP content via GSC URL or slug tokens
 *   4. AI (Claude Haiku) → new title ≤60 chars, desc ≤155 chars
 *   5. PATCH WP REST API (requires OZTOP_WP_APP_PASSWORD)
 *   6. INSERT seo_meta_log with content_type field
 *   7. fde_work_logs summary
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Options:
 *   ?dry_run=true   — preview without writing
 *   ?max=N          — max items per mode (default 8 pages + 4 posts)
 *   ?force=true     — ignore cooldown
 *
 * Env vars: CRON_SECRET, SUPABASE_*, ANTHROPIC_API_KEY,
 *           OZTOP_WP_USERNAME, OZTOP_WP_APP_PASSWORD
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OZTOP_CLIENT_ID   = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const OZTOP_WP_BASE     = 'https://oztopbuildingsupplies.com.au/wp-json/wp/v2'
const FDE_EMAIL         = 'bigbigraydeng@gmail.com'
const PAGE_COOLDOWN     = 30   // days
const POST_COOLDOWN     = 60   // days — more conservative for blog content
const POST_MIN_AGE_DAYS = 30   // don't touch posts younger than this
const POST_MAX_CTR      = 0.02 // 2% — only fix posts with bad CTR

interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  page?: string
}

interface WpContent {
  id: number
  type: 'pages' | 'posts'
  slug: string
  link: string
  title: string
  yoast_title: string
  yoast_desc: string
  date?: string  // post publish date (ISO)
}

interface OptimisedResult {
  content_type: 'pages' | 'posts'
  keyword: string
  position: number
  ctr: number
  page_id: number
  page_slug: string
  page_url: string
  old_title: string
  old_desc: string
  new_title: string
  new_desc: string
  wp_updated: boolean
}

// ─── WP REST API ──────────────────────────────────────────────────────────────

function wpAuth(): string | null {
  const u = process.env.OZTOP_WP_USERNAME
  const p = process.env.OZTOP_WP_APP_PASSWORD
  if (!u || !p) return null
  return `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`
}

async function fetchWpContent(type: 'pages' | 'posts'): Promise<WpContent[]> {
  const auth = wpAuth()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
  }
  const fields = type === 'posts'
    ? 'id,slug,link,title,yoast_head_json,date'
    : 'id,slug,link,title,yoast_head_json'
  const results: WpContent[] = []
  let page = 1
  while (true) {
    const res = await fetch(
      `${OZTOP_WP_BASE}/${type}?per_page=50&page=${page}&_fields=${fields}`,
      { headers },
    )
    if (!res.ok) break
    const batch = await res.json() as Array<{
      id: number; slug: string; link: string
      title: { rendered: string }
      yoast_head_json?: { title?: string; description?: string }
      date?: string
    }>
    for (const item of batch) {
      results.push({
        id:          item.id,
        type,
        slug:        item.slug,
        link:        item.link,
        title:       item.title.rendered,
        yoast_title: item.yoast_head_json?.title ?? item.title.rendered ?? '',
        yoast_desc:  item.yoast_head_json?.description ?? '',
        date:        item.date,
      })
    }
    if (batch.length < 50) break
    page++
  }
  return results
}

async function patchWpMeta(content: WpContent, title: string, desc: string): Promise<boolean> {
  const auth = wpAuth()
  if (!auth) return false
  const res = await fetch(`${OZTOP_WP_BASE}/${content.type}/${content.id}`, {
    method:  'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ meta: { _yoast_wpseo_title: title, _yoast_wpseo_metadesc: desc } }),
  })
  return res.ok
}

// ─── Keyword → content matching ───────────────────────────────────────────────

function matchKeyword(keyword: string, allContent: WpContent[], gscPage?: string): WpContent | null {
  if (gscPage) {
    try {
      const slug = new URL(gscPage).pathname.replace(/^\/|\/$/g, '').split('/').pop() ?? ''
      const exact = allContent.find(c => c.slug === slug)
      if (exact) return exact
    } catch { /* fall through */ }
  }
  const tokens = keyword.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  let best: WpContent | null = null
  let bestScore = 0
  for (const item of allContent) {
    const score = tokens.filter(t => item.slug.includes(t)).length
    if (score > bestScore) { bestScore = score; best = item }
  }
  return bestScore >= 2 ? best : null
}

// ─── AI meta generation ───────────────────────────────────────────────────────

async function generateMeta(
  keyword: string,
  currentTitle: string,
  currentDesc: string,
  pageUrl: string,
  contentType: 'pages' | 'posts',
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const context = contentType === 'posts'
    ? 'This is a blog article about flooring. The current meta is not generating enough clicks (low CTR). Rewrite to be more compelling and click-worthy while keeping it accurate.'
    : 'This is a service/location page for a flooring store.'
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: `You are an SEO specialist for an Australian flooring store in South Brisbane.

${context}

Target keyword: "${keyword}"
Page: ${pageUrl}
Current title: "${currentTitle}"
Current description: "${currentDesc}"

Rules:
- Title: max 60 chars, keyword near start, include "Brisbane", end "| Oztop" if space allows
- Description: max 155 chars, include keyword + Brisbane/South Brisbane + clear call to action
- Australian English, professional tone, no quotes inside the text

Respond ONLY with valid JSON: {"title":"...","desc":"..."}`,
    }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
  try {
    const p = JSON.parse(text) as { title: string; desc: string }
    return {
      title: (p.title ?? currentTitle).slice(0, 60),
      desc:  (p.desc ?? currentDesc).slice(0, 155),
    }
  } catch {
    return { title: currentTitle, desc: currentDesc }
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getRecentlyOptimised(daysBack: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString()
  const { data } = await supabaseAdmin
    .from('seo_meta_log')
    .select('page_slug')
    .eq('client_id', OZTOP_CLIENT_ID)
    .gte('optimised_at', cutoff)
  return new Set((data ?? []).map((r: { page_slug: string }) => r.page_slug))
}

async function logOptimisation(result: OptimisedResult): Promise<void> {
  await supabaseAdmin.from('seo_meta_log').insert({
    client_id:    OZTOP_CLIENT_ID,
    content_type: result.content_type,
    page_slug:    result.page_slug,
    page_url:     result.page_url,
    keyword:      result.keyword,
    old_title:    result.old_title,
    old_desc:     result.old_desc,
    new_title:    result.new_title,
    new_desc:     result.new_desc,
    wp_updated:   result.wp_updated,
    optimised_at: new Date().toISOString(),
  })
}

// ─── Process one batch (pages or posts) ──────────────────────────────────────

async function processBatch(
  opportunities: GscQueryRow[],
  wpContent: WpContent[],
  cooldownSlugs: Set<string>,
  maxItems: number,
  dryRun: boolean,
  contentType: 'pages' | 'posts',
): Promise<{ results: OptimisedResult[]; skipped: string[] }> {
  const results: OptimisedResult[] = []
  const skipped: string[] = []
  let processed = 0
  const nowMs = Date.now()

  for (const opp of opportunities) {
    if (processed >= maxItems) break

    // Posts extra guards
    if (contentType === 'posts') {
      if (opp.impressions < 20) { skipped.push(`"${opp.query}" — impressions < 20`); continue }
      if (opp.ctr >= POST_MAX_CTR) { skipped.push(`"${opp.query}" — CTR ${(opp.ctr * 100).toFixed(1)}% ≥ 2%, skip`); continue }
    }

    const matched = matchKeyword(opp.query, wpContent, opp.page)
    if (!matched) {
      skipped.push(`"${opp.query}" — no matching WP ${contentType === 'posts' ? 'post' : 'page'}`)
      continue
    }

    // Post age guard
    if (contentType === 'posts' && matched.date) {
      const ageMs = nowMs - new Date(matched.date).getTime()
      if (ageMs < POST_MIN_AGE_DAYS * 86_400_000) {
        skipped.push(`/${matched.slug} — published < ${POST_MIN_AGE_DAYS} days ago`)
        continue
      }
    }

    if (cooldownSlugs.has(matched.slug)) {
      skipped.push(`/${matched.slug} — in cooldown`)
      continue
    }

    const { title: newTitle, desc: newDesc } = await generateMeta(
      opp.query, matched.yoast_title, matched.yoast_desc, matched.link, contentType,
    )

    if (newTitle === matched.yoast_title && newDesc === matched.yoast_desc) {
      skipped.push(`"${opp.query}" — no change generated`)
      continue
    }

    let wpUpdated = false
    if (!dryRun) wpUpdated = await patchWpMeta(matched, newTitle, newDesc)

    const result: OptimisedResult = {
      content_type: contentType,
      keyword:      opp.query,
      position:     Math.round(opp.position * 10) / 10,
      ctr:          opp.ctr,
      page_id:      matched.id,
      page_slug:    matched.slug,
      page_url:     matched.link,
      old_title:    matched.yoast_title,
      old_desc:     matched.yoast_desc,
      new_title:    newTitle,
      new_desc:     newDesc,
      wp_updated:   wpUpdated,
    }
    results.push(result)
    cooldownSlugs.add(matched.slug)
    if (!dryRun) await logOptimisation(result)
    processed++
  }

  return { results, skipped }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params   = req.nextUrl.searchParams
  const dryRun   = params.get('dry_run') === 'true'
  const forceAll = params.get('force') === 'true'
  const maxPages = Math.min(parseInt(params.get('max') ?? '8'), 20)
  const maxPosts = Math.min(parseInt(params.get('max_posts') ?? '4'), 10)

  // GSC data
  const { data: snapshot, error: gscErr } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('top_queries, period_start, period_end')
    .eq('client_id', OZTOP_CLIENT_ID)
    .order('period_start', { ascending: false })
    .limit(1)
    .single()

  if (gscErr || !snapshot) {
    return NextResponse.json({ error: 'No GSC data for Oztop', detail: gscErr?.message }, { status: 404 })
  }

  const queries = (snapshot.top_queries ?? []) as GscQueryRow[]
  const baseOpportunities = queries
    .filter(q => q.position >= 4 && q.position <= 20 && q.impressions >= 10)
    .sort((a, b) => (b.impressions / b.position) - (a.impressions / a.position))

  // Cooldown sets (shared across pages + posts to avoid slug collisions)
  const pageCooldown = forceAll ? new Set<string>() : await getRecentlyOptimised(PAGE_COOLDOWN)
  const postCooldown = forceAll ? new Set<string>() : await getRecentlyOptimised(POST_COOLDOWN)

  // WP content (fetch in parallel)
  const [wpPages, wpPosts] = await Promise.all([
    fetchWpContent('pages'),
    fetchWpContent('posts'),
  ])

  // Run both modes
  const [pagesResult, postsResult] = await Promise.all([
    processBatch(baseOpportunities, wpPages, pageCooldown, maxPages, dryRun, 'pages'),
    processBatch(baseOpportunities, wpPosts,  postCooldown, maxPosts, dryRun, 'posts'),
  ])

  const allResults = [...pagesResult.results, ...postsResult.results]

  // Work log
  if (!dryRun && allResults.length > 0) {
    const pageLines = pagesResult.results.map(r =>
      `  · [页面] pos${r.position} "${r.keyword}" → /${r.page_slug} ${r.wp_updated ? '✓' : '⚠'}`)
    const postLines = postsResult.results.map(r =>
      `  · [博客] pos${r.position} CTR${(r.ctr * 100).toFixed(1)}% "${r.keyword}" → /${r.page_slug} ${r.wp_updated ? '✓' : '⚠'}`)
    const summary = [
      `【SEO】自动循环优化：${pagesResult.results.length} 个服务页 + ${postsResult.results.length} 篇博客 meta`,
      ...pageLines,
      ...postLines,
      `下一次运行：下周一 05:00 UTC`,
    ].filter(Boolean).join('\n')

    await supabaseAdmin.from('fde_work_logs').insert({
      client_id:    OZTOP_CLIENT_ID,
      log_date:     new Date().toISOString().slice(0, 10),
      summary,
      author_email: FDE_EMAIL,
    })
  }

  return NextResponse.json({
    success:    true,
    dry_run:    dryRun,
    wp_auth:    !!wpAuth(),
    period:     `${snapshot.period_start} → ${snapshot.period_end}`,
    pages:      { optimised: pagesResult.results, skipped: pagesResult.skipped.slice(0, 8) },
    posts:      { optimised: postsResult.results, skipped: postsResult.skipped.slice(0, 8) },
    schedule:   'Every Monday 05:00 UTC (render.yaml cron)',
  })
}
