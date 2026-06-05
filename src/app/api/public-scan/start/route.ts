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
import {
  consumeScanRateLimits,
  getDomainCache,
  setDomainCache,
  updateDomainCacheStatus,
} from '@/lib/zhangqian/rate-limiter'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

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

  // Append to progress_log only — never write `status`. A heartbeat addLog can
  // race a terminal status write (the 9-min hard timeout fires at exactly an
  // 18×30 s heartbeat tick); writing `status: 'running'` here would clobber a
  // 'failed'/'completed' write and strand the job. runScan() sets 'running'
  // once explicitly instead.
  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ progress_log: [...current, entry] })
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
  // Promote queued → running once. addLog() deliberately no longer writes
  // `status`, so this is the sole running-state transition.
  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
    .then(() => undefined, () => undefined)

  // Heartbeat: write a "still scanning" step every 30 s while running.
  // Guarantees the user sees activity at least every 30 s — covers the 75 s
  // Apify social-scraper gap and the 150 s Anthropic reasoning turns.
  let heartbeatMsg = 'Analysing your brand…'
  const heartbeat = setInterval(() => {
    void addLog(jobId, 'step', '⏳', heartbeatMsg).catch(() => {})
  }, 30_000)

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

    // Phase X.S3 H3 — sync the domain cache so re-requests in the next 24h
    // get an instant hit instead of re-running the agent.
    await updateDomainCacheStatus(domain, 'completed').catch(() => {})
  }

  // Race doScan() against the hard timeout
  try {
    const outcome = await Promise.race([doScan(), hardTimeout])
    if (outcome === 'timeout') {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: 'Scan exceeded 9-minute limit — please try again.', completed_at: new Date().toISOString() })
        .eq('id', jobId)
      await updateDomainCacheStatus(domain, 'failed').catch(() => {})
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Best-effort write: if this also fails, the heartbeat job stays 'running'
    // until the next deployment (acceptable — 9-min timeout handles restarts).
    try {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: msg, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      await updateDomainCacheStatus(domain, 'failed').catch(() => {})
    } catch {
      // best-effort failure write
    }
  } finally {
    clearInterval(heartbeat)
    clearTimeout(hardTimeoutId)
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

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

  // 24h domain cache — if the same site was scanned recently, hand back the
  // existing job rather than spending another $0.57 on a duplicate. Done
  // BEFORE rate-limit consume so a cached hit doesn't burn a quota slot.
  const cached = await getDomainCache(domain)
  if (cached) {
    return NextResponse.json({ job_id: cached.job_id, cached: true })
  }

  // Phase X.S6 M-4 — atomic check-and-increment per dimension (ip/email/domain).
  // Replaces the older check + record two-step which had a race window.
  const rate = await consumeScanRateLimits({ ip, email, domain })
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'Daily limit reached (3 scans per day). Try again tomorrow.',
        blocked_by: rate.blockedBy,
      },
      { status: 429 },
    )
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

  // Stash the new job in the domain cache. Rate-limit counters already
  // moved in consumeScanRateLimits above; the job is created right after.
  await setDomainCache(domain, job.id, 'queued').catch(() => {})

  // Fire-and-forget; the background worker also updates the domain cache
  // status so a cached pointer that later fails can be silently regenerated.
  void runScan(job.id, domain).catch((err: unknown) => {
    console.error('[public-scan/start] background failure', err)
    void updateDomainCacheStatus(domain, 'failed').catch(() => {})
  })

  return NextResponse.json({ job_id: job.id }, { status: 202 })
}
