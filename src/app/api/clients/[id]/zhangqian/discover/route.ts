/**
 * POST /api/clients/[id]/zhangqian/discover
 *
 * Dispatch 张骞 Zhangqian Discovery Agent for a client. Returns 202 immediately
 * with a job_id; the agent runs in the background and writes results to
 * `client_discovery` when done. Poll `/zhangqian/status?job_id=...` for progress.
 *
 * Body: {} (domain comes from the clients table)
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { runZhangqian } from '@/lib/zhangqian/agent'
import {
  createDiscoveryJob,
  updateJobProgress,
  completeJob,
  failJob,
} from '@/lib/zhangqian/persistor'
import { getDomainMetrics, getKeywordsForSite, bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { loadMemoryForClient } from '@/lib/memory'

// Render — agent itself runs in fire-and-forget; this handler returns in <1s
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    // Resolve domain from clients table
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single<{ id: string; domain: string }>()

    if (clientErr || !client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }
    if (!client.domain) {
      return NextResponse.json(
        { success: false, error: 'Client has no domain configured' },
        { status: 400 },
      )
    }

    // Create job synchronously so we can return its id immediately
    const jobId = await createDiscoveryJob(supabaseAdmin, clientId, client.domain)

    // Fire-and-forget background execution
    void executeDiscoveryJob(jobId, clientId, client.domain).catch((err: unknown) => {
      console.error('[zhangqian/discover] background failure', err)
    })

    return NextResponse.json(
      { success: true, job_id: jobId, domain: client.domain },
      { status: 202 },
    )
  } catch (err: unknown) {
    console.error('[zhangqian/discover] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to dispatch Zhangqian' },
      { status: 500 },
    )
  }
}

// ─── Background executor ─────────────────────────────────────────────────────

async function executeDiscoveryJob(
  jobId: string,
  clientId: string,
  domain: string,
): Promise<void> {
  await updateJobProgress(supabaseAdmin, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    progress_note: '正在预取域名数据…',
  })

  // Pre-fetch domain data before starting the agent — never block on failure
  let semrushContext: string | undefined
  try {
    const [metricsResult, keywordsResult] = await Promise.allSettled([
      getDomainMetrics(domain),
      getKeywordsForSite(domain, 2036, 20),
    ])

    const metrics  = metricsResult.status  === 'fulfilled' ? metricsResult.value  : null
    const rawKws   = keywordsResult.status === 'fulfilled' ? keywordsResult.value : []
    const keywords = rawKws.map(k => ({
      keyword:  k.keyword,
      volume:   k.search_volume      ?? 0,
      kd:       k.keyword_difficulty ?? 0,
      position: k.position,
    }))

    if (metrics && (metrics.organic_traffic > 0 || metrics.organic_keywords > 0)) {
      const trafficStr = metrics.organic_traffic.toLocaleString()
      const kwCountStr = metrics.organic_keywords.toLocaleString()
      const lines: string[] = [
        `月有机流量：${trafficStr}次 | 域名权威分（Authority Score）：${metrics.authority_score}/100 | 有机关键词数：${kwCountStr}`,
      ]

      if (keywords.length > 0) {
        lines.push('')
        lines.push('当前 TOP 关键词排名（实时数据）：')
        lines.push('| 关键词 | 当前排名 | 月搜索量 | 难度 |')
        lines.push('|--------|---------|---------|------|')
        for (const kw of keywords.slice(0, 15)) {
          const rank = kw.position != null ? `#${kw.position}` : 'N/A'
          lines.push(`| ${kw.keyword} | ${rank} | ${kw.volume.toLocaleString()} | ${kw.kd} |`)
        }
      }

      semrushContext = lines.join('\n')
    }
  } catch {
    // Non-fatal — continue without domain context
  }

  // Phase 23.D.2: Non-blocking memory load — failure returns empty context.
  // Cold-start scans return has_content=false naturally, so this is safe for
  // both first-time and re-discovery flows.
  const memoryContext = await loadMemoryForClient(supabaseAdmin, clientId, {
    maxRecentDecisions: 3,
  })

  try {
    const { report, validation_error, raw_output } = await runZhangqian(domain, {
      semrushContext,
      memoryContext,
      onProgress: async (note) => {
        await updateJobProgress(supabaseAdmin, jobId, { progress_note: note })
      },
    })

    if (validation_error) {
      await failJob(
        supabaseAdmin,
        jobId,
        `Validation failed: ${validation_error}. Partial cost: $${report.meta.cost_usd}.`,
        raw_output,
      )
      return
    }

    // Enrich seed keywords with per-keyword SEMrush metrics (volume / KD / CPC)
    if (report.seed_keywords.length > 0) {
      await updateJobProgress(supabaseAdmin, jobId, { progress_note: '正在获取种子关键词数据…' })
      try {
        const kwTexts = report.seed_keywords.map(kw => kw.keyword)
        const enriched = await bulkKeywordVolume(kwTexts)
        const enrichMap = new Map(enriched.map(d => [d.keyword.toLowerCase(), d]))
        report.seed_keywords = report.seed_keywords.map(kw => {
          const d = enrichMap.get(kw.keyword.toLowerCase())
          if (!d) return kw
          return {
            ...kw,
            semrush_volume: (d.search_volume ?? 0) || kw.semrush_volume,
            semrush_kd:  d.keyword_difficulty ?? 0,
            semrush_cpc: d.cpc ?? 0,
          }
        })
      } catch {
        // Non-fatal — seed keywords saved without per-keyword metrics
      }
    }

    await completeJob(supabaseAdmin, jobId, clientId, report)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(supabaseAdmin, jobId, `Agent error: ${message}`)
  }
}
