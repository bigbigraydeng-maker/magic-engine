/**
 * POST /api/cron/oztop-seo-optimizer
 *
 * Oztop SEO Automation Loop — runs every Monday 05:00 UTC via render.yaml
 *
 * True loop behaviour:
 *   - Each run reads GSC position 4-20 keywords (easy win zone)
 *   - Skips pages already optimised in the last 30 days (avoids churn)
 *   - AI generates optimised meta → writes to WP → records result in seo_meta_log
 *   - Next run picks up NEW opportunities and pages that have aged out of cooldown
 *
 * Pipeline per run:
 *   1. Read latest GSC snapshot → position 4-20 keywords with ≥10 impressions
 *   2. Filter out slugs optimised in the last 30 days (from seo_meta_log)
 *   3. For remaining: match keyword → WP page/post via slug
 *   4. Fetch current Yoast meta via WP REST API
 *   5. Claude Haiku generates title (≤60 chars) + desc (≤155 chars)
 *   6. PATCH to WP REST API (requires OZTOP_WP_APP_PASSWORD env)
 *   7. INSERT into seo_meta_log (tracks what was changed + when)
 *   8. Write fde_work_logs summary
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Options:
 *   ?dry_run=true   — preview without writing to WP or DB
 *   ?max=N          — max pages to optimise per run (default 8)
 *   ?force=true     — ignore 30-day cooldown (re-optimise all)
 *
 * Env vars required:
 *   CRON_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   ANTHROPIC_API_KEY,
 *   OZTOP_WP_USERNAME       — WP login username
 *   OZTOP_WP_APP_PASSWORD   — WP Application Password (spaces OK)
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OZTOP_CLIENT_ID = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const OZTOP_WP_BASE  = 'https://oztopbuildingsupplies.com.au/wp-json/wp/v2'
const FDE_EMAIL      = 'bigbigraydeng@gmail.com'
const COOLDOWN_DAYS  = 30

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
}

interface OptimisedResult {
  keyword: string
  position: number
  page_id: number
  page_slug: string
  page_url: string
  old_title: string
  old_desc: string
  new_title: string
  new_desc: string
  wp_updated: boolean
}

// ─── WP REST API ─────────────────────────────────────────────────────────────

function wpAuth(): string | null {
  const u = process.env.OZTOP_WP_USERNAME
  const p = process.env.OZTOP_WP_APP_PASSWORD
  if (!u || !p) return null
  return `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`
}

async function fetchAllContent(): Promise<WpContent[]> {
  const auth = wpAuth()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
  }
  const results: WpContent[] = []
  for (const type of ['pages', 'posts'] as const) {
    let page = 1
    while (true) {
      const res = await fetch(
        `${OZTOP_WP_BASE}/${type}?per_page=50&page=${page}&_fields=id,slug,link,title,yoast_head_json`,
        { headers },
      )
      if (!res.ok) break
      const batch = await res.json() as Array<{
        id: number
        slug: string
        link: string
        title: { rendered: string }
        yoast_head_json?: { title?: string; description?: string }
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
        })
      }
      if (batch.length < 50) break
      page++
    }
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

// ─── Keyword → page matching ──────────────────────────────────────────────────

function matchKeyword(keyword: string, allContent: WpContent[], gscPage?: string): WpContent | null {
  if (gscPage) {
    try {
      const slug = new URL(gscPage).pathname.replace(/^\/|\/$/g, '').split('/').pop() ?? ''
      const exact = allContent.find(c => c.slug === slug)
      if (exact) return exact
    } catch { /* invalid URL, fall through */ }
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
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: `You are an SEO specialist for an Australian flooring store in South Brisbane.

Target keyword: "${keyword}"
Page: ${pageUrl}
Current title: "${currentTitle}"
Current description: "${currentDesc}"

Write optimised meta. Rules:
- Title: max 60 chars, keyword near start, include "Brisbane", end "| Oztop" if space allows
- Description: max 155 chars, keyword + Brisbane/South Brisbane + call to action
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

// ─── DB: cooldown tracking ────────────────────────────────────────────────────

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

  // 1. GSC: opportunity keywords
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
  const allOpportunities = queries
    .filter(q => q.position >= 4 && q.position <= 20 && q.impressions >= 10)
    .sort((a, b) => (b.impressions / b.position) - (a.impressions / a.position))

  // 2. Cooldown filter
  const recentSlugs = forceAll ? new Set<string>() : await getRecentlyOptimised(COOLDOWN_DAYS)

  // 3. WP content
  const allContent = await fetchAllContent()

  // 4-7. Loop: match → AI → patch → log
  const results: OptimisedResult[] = []
  const skipped: string[] = []
  let processed = 0

  for (const opp of allOpportunities) {
    if (processed >= maxPages) break

    const matched = matchKeyword(opp.query, allContent, opp.page)
    if (!matched) {
      skipped.push(`"${opp.query}" — no matching WP page`)
      continue
    }

    if (recentSlugs.has(matched.slug)) {
      skipped.push(`/${matched.slug} — in ${COOLDOWN_DAYS}-day cooldown`)
      continue
    }

    const { title: newTitle, desc: newDesc } = await generateMeta(
      opp.query, matched.yoast_title, matched.yoast_desc, matched.link,
    )

    if (newTitle === matched.yoast_title && newDesc === matched.yoast_desc) {
      skipped.push(`"${opp.query}" — no change`)
      continue
    }

    let wpUpdated = false
    if (!dryRun) {
      wpUpdated = await patchWpMeta(matched, newTitle, newDesc)
    }

    const result: OptimisedResult = {
      keyword:    opp.query,
      position:   Math.round(opp.position * 10) / 10,
      page_id:    matched.id,
      page_slug:  matched.slug,
      page_url:   matched.link,
      old_title:  matched.yoast_title,
      old_desc:   matched.yoast_desc,
      new_title:  newTitle,
      new_desc:   newDesc,
      wp_updated: wpUpdated,
    }
    results.push(result)

    // Add to cooldown set so same slug isn't processed twice this run
    recentSlugs.add(matched.slug)

    if (!dryRun) await logOptimisation(result)
    processed++
  }

  // 8. Work log
  if (!dryRun && results.length > 0) {
    const lines = [
      `【SEO】自动循环优化 ${results.length} 个页面 meta（GSC pos 4-20，impressions≥10）`,
      ...results.map(r => `  · pos${r.position} "${r.keyword}" → /${r.page_slug} ${r.wp_updated ? '✓写入WP' : '⚠未写入(无WP密码)'}`),
      skipped.length > 0 ? `  跳过 ${skipped.length} 项（冷却期/无匹配）` : '',
      `下一次自动运行：下周一 05:00 UTC`,
    ]
    await supabaseAdmin.from('fde_work_logs').insert({
      client_id:    OZTOP_CLIENT_ID,
      log_date:     new Date().toISOString().slice(0, 10),
      summary:      lines.filter(Boolean).join('\n'),
      author_email: FDE_EMAIL,
    })
  }

  return NextResponse.json({
    success:           true,
    dry_run:           dryRun,
    wp_auth:           !!wpAuth(),
    period:            `${snapshot.period_start} → ${snapshot.period_end}`,
    total_opportunity: allOpportunities.length,
    cooldown_skip:     recentSlugs.size - (forceAll ? 0 : recentSlugs.size),
    optimised:         results,
    skipped:           skipped.slice(0, 10),
    schedule:          'Every Monday 05:00 UTC (render.yaml cron)',
  })
}
