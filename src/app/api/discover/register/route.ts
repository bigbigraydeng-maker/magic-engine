/**
 * POST /api/discover/register
 *
 * Prospect self-registration flow:
 *   1. Validate body (url, email, name)
 *   2. Rate-limit by IP (3/day)
 *   3. Save lead to discovery_leads
 *   4. Create public_scan_jobs row + fire background Zhang Qian scan
 *   5. Send Supabase magic link to prospect's email (shouldCreateUser: true)
 *   6. Return { success: true, job_id }
 *
 * The magic link redirects to /auth/callback?next=/prospect, which then
 * lands the user on their personal Discovery Report dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runZhangqian } from '@/lib/zhangqian/agent'
import { getDomainMetrics, getKeywordsForSite } from '@/lib/dataforseo/labs'
import {
  checkScanRateLimits,
  recordScanAttempt,
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
  const { data } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('progress_log')
    .eq('id', jobId)
    .single<{ progress_log: LogEntry[] }>()

  const current: LogEntry[] = Array.isArray(data?.progress_log) ? data.progress_log : []
  const entry: LogEntry = { type, icon, message, detail: detail ?? null, ts: new Date().toISOString() }

  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ progress_log: [...current, entry] })
    .eq('id', jobId)
}

// ─── Progress translator ──────────────────────────────────────────────────────

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

// ─── Background scan ──────────────────────────────────────────────────────────

const SCAN_HARD_TIMEOUT_MS = 9 * 60 * 1000

async function runScan(jobId: string, domain: string): Promise<void> {
  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
    .then(() => undefined, () => undefined)

  let heartbeatMsg = 'Analysing your brand…'
  const heartbeat = setInterval(() => {
    void addLog(jobId, 'step', '⏳', heartbeatMsg).catch(() => {})
  }, 30_000)

  let hardTimeoutId: ReturnType<typeof setTimeout> | undefined
  const hardTimeout = new Promise<'timeout'>(resolve => {
    hardTimeoutId = setTimeout(() => resolve('timeout'), SCAN_HARD_TIMEOUT_MS)
  })

  async function doScan(): Promise<void> {
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

    heartbeatMsg = 'Deep scanning your brand…'
    const { report, validation_error } = await runZhangqian(domain, {
      semrushContext,
      onProgress: async (note) => {
        const { icon, message } = translateNote(note)
        heartbeatMsg = message
        await addLog(jobId, 'step', icon, message).catch(() => {})
      },
    })

    if (validation_error) {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: `Validation: ${validation_error}`, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      await updateDomainCacheStatus(domain, 'failed').catch(() => {})
      return
    }

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
    await updateDomainCacheStatus(domain, 'completed').catch(() => {})
  }

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
    try {
      await supabaseAdmin
        .from('public_scan_jobs')
        .update({ status: 'failed', error: msg, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      await updateDomainCacheStatus(domain, 'failed').catch(() => {})
    } catch {
      // Ignore failure while recording the failure state.
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
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 })
    }
    const norm = normaliseUrl(body.url)
    url = norm.url
    domain = norm.domain
    email = body.email.trim().toLowerCase()
    name  = typeof body.name === 'string' ? body.name.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Phase X.S3 H3 — persistent rate-limit by IP, email, domain.
  const rate = await checkScanRateLimits({ ip, email, domain })
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'Daily limit reached (3 scans per day). Try again tomorrow.',
        blocked_by: rate.blockedBy,
      },
      { status: 429 },
    )
  }

  // 24h domain cache hit — hand back the existing job.
  const cached = await getDomainCache(domain)
  if (cached) {
    return NextResponse.json({ success: true, job_id: cached.job_id, cached: true })
  }

  // Save lead
  await Promise.resolve(
    supabaseAdmin
      .from('discovery_leads')
      .insert({ url, name: name || null, email, created_at: new Date().toISOString() }),
  ).catch(() => {})

  // Create scan job
  const { data: job, error: jobErr } = await supabaseAdmin
    .from('public_scan_jobs')
    .insert({ url, domain, email, name: name || null })
    .select('id')
    .single<{ id: string }>()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Failed to create scan job.' }, { status: 500 })
  }

  await Promise.allSettled([
    recordScanAttempt({ ip, email, domain }),
    setDomainCache(domain, job.id, 'queued'),
  ])

  // Fire background scan
  void runScan(job.id, domain).catch((err: unknown) => {
    console.error('[discover/register] background scan failure', err)
    void updateDomainCacheStatus(domain, 'failed').catch(() => {})
  })

  // Determine origin for magic link redirect
  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL)?.replace(/\/$/, '')
    ?? `${req.headers.get('x-forwarded-proto') ?? 'https'}://${req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3001'}`

  const redirectTo = `${appUrl}/auth/implicit-callback?next=/prospect`

  // Send magic link (creates user if not exists)
  const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  })

  if (otpError) {
    console.error('[discover/register] magic link error', otpError)
    // Non-fatal: scan is still running. User can request a new link via /login.
  }

  return NextResponse.json({ success: true, job_id: job.id }, { status: 202 })
}
