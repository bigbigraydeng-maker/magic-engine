/**
 * POST /api/cron/oztop-seo-optimizer
 *
 * Oztop SEO Automation Loop — runs every Monday 05:00 UTC via render.yaml
 *
 * Architecture (v2 — WP plugin approach):
 *   Render cron does NOT touch WP REST API (SiteGround blocks Render IPs).
 *   Instead:
 *     1. Read GSC top_pages → filter position 4-20, impressions ≥ 10
 *     2. Match best keyword from top_queries via slug tokens
 *     3. AI (Claude Haiku) generates new title + desc
 *     4. INSERT into seo_meta_log with wp_updated=false (pending queue)
 *     5. WP plugin (installed on Oztop WP) polls Supabase hourly,
 *        applies via update_post_meta(), marks wp_updated=true
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Options:
 *   ?dry_run=true   — preview without writing to Supabase
 *   ?max=N          — max items to queue (default 8)
 *   ?force=true     — ignore cooldown
 *
 * Env vars: CRON_SECRET, SUPABASE_*, ANTHROPIC_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OZTOP_CLIENT_ID   = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const FDE_EMAIL         = 'bigbigraydeng@gmail.com'
const PAGE_COOLDOWN     = 30   // days before re-optimising same slug

interface GscRow {
  query?: string
  page?:  string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface QueuedItem {
  page_slug:  string
  page_url:   string
  keyword:    string
  new_title:  string
  new_desc:   string
}

// ─── AI meta generation ───────────────────────────────────────────────────────

async function generateMeta(
  keyword: string,
  pageUrl: string,
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: `You are an SEO specialist for an Australian flooring and building supplies store in South Brisbane.

Target keyword: "${keyword}"
Page URL: ${pageUrl}

Rules:
- Title: max 60 chars, include keyword near start, include "Brisbane", end "| Oztop" if space allows
- Description: max 155 chars, include keyword + Brisbane/South Brisbane + clear call to action
- Australian English, professional tone, no quotes inside the text

Respond ONLY with valid JSON: {"title":"...","desc":"..."}`,
    }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
  try {
    const p = JSON.parse(text) as { title?: string; desc?: string }
    return {
      title: (p.title ?? keyword).slice(0, 60),
      desc:  (p.desc  ?? '').slice(0, 155),
    }
  } catch {
    return { title: keyword.slice(0, 60), desc: '' }
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

// ─── Main handler ─────────────────────────────────────────────────────────────

// 🔴 必须写 cron_run_logs(2026-08-03 补):此前不留任何运行痕迹,
// 「跑了但没机会词」和「压根没跑」监控分辨不出。鉴权在建记录之前 ——
// 401 不该产生运行记录,否则会被外部探测刷满。
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('oztop-seo-optimizer')
  try {

    const params   = req.nextUrl.searchParams
    const dryRun   = params.get('dry_run') === 'true'
    const forceAll = params.get('force') === 'true'
    const maxItems = Math.min(parseInt(params.get('max') ?? '8'), 20)

    // GSC data
    const { data: snapshot, error: gscErr } = await supabaseAdmin
      .from('gsc_performance_snapshots')
      .select('top_queries, top_pages, period_start, period_end')
      .eq('client_id', OZTOP_CLIENT_ID)
      .order('period_start', { ascending: false })
      .limit(1)
      .single()

    if (gscErr || !snapshot) {
      await cronRun.finish({ error: `没有 Oztop 的 GSC 数据: ${gscErr?.message ?? '快照为空'}` })
      return NextResponse.json({ error: 'No GSC data for Oztop', detail: gscErr?.message }, { status: 404 })
    }

    const topPages   = (snapshot.top_pages   ?? []) as GscRow[]
    const topQueries = (snapshot.top_queries ?? []) as GscRow[]

    // Opportunities: pages in position 4-20 with enough impressions
    const opportunities = topPages
      .filter(p => !!p.page && p.position >= 4 && p.position <= 20 && p.impressions >= 10)
      .sort((a, b) => (b.impressions / b.position) - (a.impressions / a.position))

    // Best keyword per slug: match slug tokens against top_queries
    function bestKeyword(slug: string): string {
      const tokens = slug.split('-').filter(t => t.length > 2)
      let best = ''
      let bestScore = 0
      for (const row of topQueries) {
        if (!row.query) continue
        const score = tokens.filter(t => row.query!.toLowerCase().includes(t)).length
        if (score > bestScore) { bestScore = score; best = row.query }
      }
      return best || slug.replace(/-/g, ' ')
    }

    function slugFromUrl(url: string): string | null {
      try {
        return new URL(url).pathname.replace(/^\/|\/$/g, '').split('/').pop() ?? null
      } catch { return null }
    }

    const cooldownSlugs = forceAll ? new Set<string>() : await getRecentlyOptimised(PAGE_COOLDOWN)

    const queued: QueuedItem[] = []
    const skipped: string[]    = []

    for (const opp of opportunities) {
      if (queued.length >= maxItems) break

      const slug = slugFromUrl(opp.page!)
      if (!slug) { skipped.push(`${opp.page} — cannot parse slug`); continue }
      if (cooldownSlugs.has(slug)) { skipped.push(`/${slug} — in cooldown`); continue }

      const keyword = bestKeyword(slug)
      const { title, desc } = await generateMeta(keyword, opp.page!)

      if (!title) { skipped.push(`/${slug} — AI returned empty title`); continue }

      queued.push({ page_slug: slug, page_url: opp.page!, keyword, new_title: title, new_desc: desc })
      cooldownSlugs.add(slug)
    }

    // Write pending queue to Supabase (WP plugin will apply these)
    if (!dryRun && queued.length > 0) {
      const rows = queued.map(item => ({
        client_id:    OZTOP_CLIENT_ID,
        content_type: 'pages',
        page_slug:    item.page_slug,
        page_url:     item.page_url,
        keyword:      item.keyword,
        old_title:    '',
        old_desc:     '',
        new_title:    item.new_title,
        new_desc:     item.new_desc,
        wp_updated:   false,
        optimised_at: new Date().toISOString(),
      }))
      await supabaseAdmin.from('seo_meta_log').insert(rows)

      // Work log
      const lines = queued.map(r => `  · pos? "${r.keyword}" → /${r.page_slug} (pending WP plugin)`)
      const summary = [
        `【SEO】自动循环：${queued.length} 条 AI meta 写入待处理队列，等待 WP 插件每小时拉取并应用`,
        ...lines,
        `下一次 Render 运行：下周一 05:00 UTC`,
      ].join('\n')
      await supabaseAdmin.from('fde_work_logs').insert({
        client_id: OZTOP_CLIENT_ID, log_date: new Date().toISOString().slice(0, 10),
        summary, author_email: FDE_EMAIL,
      })
    }

    await cronRun.finish({
      processed: opportunities.length,
      completed: queued.length,
      summary: { dry_run: dryRun, opportunities: opportunities.length, queued: queued.length, skipped: skipped.length },
    })
    return NextResponse.json({
      success:        true,
      dry_run:        dryRun,
      period:         `${snapshot.period_start} → ${snapshot.period_end}`,
      opportunities:  opportunities.length,
      queued:         queued.map(r => ({ slug: r.page_slug, keyword: r.keyword, title: r.new_title, desc: r.new_desc })),
      skipped:        skipped.slice(0, 10),
      wp_note:        'WP plugin (oztop-seo-sync) will apply these hourly via update_post_meta()',
      schedule:       'Render cron: Every Monday 05:00 UTC',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: 'Internal error', detail: msg }, { status: 500 })
  }
}
