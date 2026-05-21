/**
 * POST /api/public-scan/start
 *
 * Starts a full public Zhangqian discovery scan (no auth required).
 * Returns immediately with { job_id }; agent runs in background.
 *
 * Body: { url, email?, name? }
 *
 * Discovery log strategy (Method B):
 *   - Pre-fetch DataForSEO → emit real domain stats as discoveries
 *   - Zhangqian onProgress → translate to English steps
 *   - Post-completion → emit key findings from report as discoveries
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runZhangqian } from '@/lib/zhangqian/agent'
import { getDomainMetrics, getKeywordsForSite } from '@/lib/dataforseo/labs'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

// ─── Rate limit: 3 full scans / IP / day ─────────────────────────────────────

const ipBucket = new Map<string, { count: number; resetAt: number }>()

function checkRate(ip: string): boolean {
  const now = Date.now()
  const entry = ipBucket.get(ip)
  if (!entry || entry.resetAt < now) {
    ipBucket.set(ip, { count: 1, resetAt: now + 86_400_000 })
    return false
  }
  if (entry.count >= 3) return true
  entry.count++
  return false
}

// ─── URL normaliser ───────────────────────────────────────────────────────────

function normaliseUrl(raw: string): { url: string; domain: string } {
  let u = raw.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  return { url: parsed.href, domain: parsed.hostname.replace(/^www\./, '') }
}

// ─── Progress log ─────────────────────────────────────────────────────────────

interface LogEntry {
  type: 'step' | 'discovery'
  icon: string
  message: string
  detail?: string | null
  ts: string
}

async function addLog(
  jobId: string,
  type: LogEntry['type'],
  icon: string,
  message: string,
  detail?: string | null,
): Promise<void> {
  // Fetch → append → update (Supabase JS doesn't support jsonb array append inline)
  const { data } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('progress_log')
    .eq('id', jobId)
    .single<{ progress_log: LogEntry[] }>()

  const current: LogEntry[] = Array.isArray(data?.progress_log) ? data.progress_log : []
  const entry: LogEntry = { type, icon, message, detail: detail ?? null, ts: new Date().toISOString() }

  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ status: 'running', progress_log: [...current, entry] })
    .eq('id', jobId)
}

// ─── Translate Zhangqian progress notes → English ─────────────────────────────

function translateNote(note: string): { icon: string; message: string } {
  const n = note.toLowerCase()
  if (n.includes('instagram') || n.includes('tiktok') || n.includes('social') || n.includes('社媒'))
    return { icon: '📱', message: 'Checking social media profiles…' }
  if (n.includes('competitor') || n.includes('竞争') || n.includes('rival'))
    return { icon: '🏆', message: 'Researching your competitors…' }
  if (n.includes('review') || n.includes('评论') || n.includes('gbp') || n.includes('local'))
    return { icon: '⭐', message: 'Scanning online reviews…' }
  if (n.includes('keyword') || n.includes('关键词') || n.includes('serp') || n.includes('search'))
    return { icon: '🔑', message: 'Mapping keyword landscape…' }
  if (n.includes('registration') || n.includes('abn') || n.includes('注册'))
    return { icon: '🏛️', message: 'Verifying business registration…' }
  if (n.includes('技术') || n.includes('technology') || n.includes('stack') || n.includes('whois'))
    return { icon: '💻', message: 'Scanning tech stack & domain info…' }
  if (n.includes('diagnosis') || n.includes('诊断') || n.includes('score') || n.includes('分析'))
    return { icon: '🩺', message: 'Calculating health scores…' }
  if (n.includes('complete') || n.includes('完成') || n.includes('done'))
    return { icon: '✅', message: 'Finalising your Discovery Report…' }
  if (n.includes('fetch') || n.includes('read') || n.includes('crawl'))
    return { icon: '🌐', message: 'Reading website content…' }
  return { icon: '🔍', message: 'Deep scanning your brand…' }
}

// ─── Background executor ──────────────────────────────────────────────────────

// Hard cap: if the entire scan hasn't finished in 9 minutes, mark it failed.
// This prevents jobs from staying in 'running' forever if the agent hangs or
// if the process is recycled mid-scan.
const SCAN_HARD_TIMEOUT_MS = 9 * 60 * 1000

async function runScan(jobId: string, domain: string): Promise<void> {
  // Heartbeat: write a "still scanning" step every 45 s while running.
  // Gives the user visible activity during the long Anthropic + Apify gaps.
  let heartbeatMsg = 'Analysing your brand…'
  const heartbeat = setInterval(() => {
    void addLog(jobId, 'step', '⏳', heartbeatMsg).catch(() => {})
  }, 45_000)

  // Hard timeout — resolves as 'timeout' after 9 minutes.
  let hardTimeoutId: ReturnType<typeof setTimeout> | undefined
  const hardTimeout = new Promise<'timeout'>(resolve => {
    hardTimeoutId = setTimeout(() => resolve('timeout'), SCAN_HARD_TIMEOUT_MS)
  })

  async function doScan(): Promise<void> {
    // Phase 1 — DataForSEO pre-fetch (emit real data as early discoveries)
    await addLog(jobId, 'step', '🔍', 'Gathering domain performance data…')

  let semrushContext: string | undefined
  try {
    const [metricsRes, kwRes] = await Promise.allSettled([
      getDomainMetrics(domain),
      getKeywordsForSite(domain, 2036, 20),
    ])

    const metrics = metricsRes.status === 'fulfilled' ? metricsRes.value : null
    const keywords = kwRes.status === 'fulfilled' ? kwRes.value : []

    if (metrics) {
      if (metrics.authority_score > 0) {
        await addLog(jobId, 'discovery', '📈',
          `Domain authority: ${metrics.authority_score}/100`,
          metrics.organic_traffic > 0
            ? `~${metrics.organic_traffic.toLocaleString()} monthly organic visits`
            : null,
        )
      }
      if (metrics.organic_keywords > 0) {
        await addLog(jobId, 'discovery', '🔑',
          `Currently ranking for ${metrics.organic_keywords.toLocaleString()} keywords`,
        )
      }
    }

    if (keywords.length > 0) {
      const top = keywords[0]
      if (top.position) {
        await addLog(jobId, 'discovery', '🏆',
          `Top keyword: "${top.keyword}" · #${top.position}`,
          top.search_volume ? `${top.search_volume.toLocaleString()} monthly searches` : null,
        )
      }
    }

    if (metrics && keywords.length > 0) {
      const lines = [
        `Monthly traffic: ${metrics.organic_traffic.toLocaleString()} | Authority: ${metrics.authority_score}/100`,
      ]
      lines.push('', 'Top keyword rankings:', '| Keyword | Rank | Volume | KD |', '|---------|------|--------|----|')
      for (const kw of keywords.slice(0, 15)) {
        lines.push(`| ${kw.keyword} | #${kw.position ?? 'N/A'} | ${(kw.search_volume ?? 0).toLocaleString()} | ${kw.keyword_difficulty ?? 0} |`)
      }
      semrushContext = lines.join('\n')
    }
  } catch {
    // Non-fatal
  }

    // Phase 2 — Zhangqian agent (translate progress notes into live discoveries)
    heartbeatMsg = 'Deep scanning your brand…'
    const { report, validation_error } = await runZhangqian(domain, {
      semrushContext,
      onProgress: async (note) => {
        const { icon, message } = translateNote(note)
        heartbeatMsg = message  // keep heartbeat label in sync with latest phase
        await addLog(jobId, 'step', icon, message).catch(() => {})
      },
    })

    if (validation_error) {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: `Validation: ${validation_error}`, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      return
    }

    // Phase 3 — Post-completion discoveries (real data from report)
    heartbeatMsg = 'Finalising your report…'
    const r = report as DiscoveryReport

    const ig = r.social_profiles?.find(s => s.platform === 'instagram')
    if (ig?.followers_count) {
      await addLog(jobId, 'discovery', '📱',
        `Instagram ${ig.handle ?? ig.url} · ${ig.followers_count.toLocaleString()} followers`,
        ig.engagement_rate ? `${(ig.engagement_rate * 100).toFixed(1)}% engagement rate` : null,
      )
    }

    const topComp = r.competitors?.find(c => c.monthly_traffic && c.monthly_traffic > 0)
    if (topComp?.monthly_traffic) {
      await addLog(jobId, 'discovery', '🏆',
        `Competitor: ${topComp.domain} · ${topComp.monthly_traffic.toLocaleString()} monthly visits`,
        topComp.trust_score ? `Authority score: ${topComp.trust_score}/100` : null,
      )
    }

    const gbp = r.gbp
    if (gbp?.rating && gbp.review_count) {
      await addLog(jobId, 'discovery', '⭐',
        `Google: ${gbp.rating}/5 · ${gbp.review_count} reviews`,
        gbp.business_name ?? null,
      )
    }

    await addLog(jobId, 'discovery', '✅', 'Discovery complete — your report is ready!')

    await supabaseAdmin
      .from('public_scan_jobs')
      .update({
        status: 'completed',
        result: report as unknown as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }

  // Race doScan() against the hard timeout
  try {
    const outcome = await Promise.race([doScan(), hardTimeout])
    if (outcome === 'timeout') {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: 'Scan exceeded 9-minute limit — please try again.', completed_at: new Date().toISOString() })
        .eq('id', jobId)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Best-effort write: if this also fails, the heartbeat job stays 'running'
    // until the next deployment (acceptable — 9-min timeout handles restarts).
    await supabaseAdmin
      .from('public_scan_jobs')
      .update({ status: 'failed', error: msg, completed_at: new Date().toISOString() })
      .eq('id', jobId)
      .then(() => undefined)
      .catch(() => undefined)
  } finally {
    clearInterval(heartbeat)
    clearTimeout(hardTimeoutId)
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (checkRate(ip)) {
    return NextResponse.json(
      { error: 'Daily limit reached (3 scans per day). Try again tomorrow.' },
      { status: 429 },
    )
  }

  let url: string, domain: string, email = '', name = ''
  try {
    const body = (await req.json()) as { url?: unknown; email?: unknown; name?: unknown }
    if (!body.url || typeof body.url !== 'string') {
      return NextResponse.json({ error: 'url is required.' }, { status: 400 })
    }
    const norm = normaliseUrl(body.url)
    url = norm.url
    domain = norm.domain
    email = typeof body.email === 'string' ? body.email.trim() : ''
    name  = typeof body.name  === 'string' ? body.name.trim()  : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Save lead (email capture)
  if (email) {
    await Promise.resolve(
      supabaseAdmin
        .from('discovery_leads')
        .insert({ url, name: name || null, email, created_at: new Date().toISOString() }),
    ).catch(() => {})
  }

  // Create job
  const { data: job, error: jobErr } = await supabaseAdmin
    .from('public_scan_jobs')
    .insert({ url, domain, email: email || null, name: name || null })
    .select('id')
    .single<{ id: string }>()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Failed to create scan job.' }, { status: 500 })
  }

  // Fire-and-forget
  void runScan(job.id, domain).catch((err: unknown) => {
    console.error('[public-scan/start] background failure', err)
  })

  return NextResponse.json({ job_id: job.id }, { status: 202 })
}
