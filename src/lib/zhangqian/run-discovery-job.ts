/**
 * Background executor for one 张骞 discovery job. Runs inside the Inngest function
 * `cloud-zhangqian-discovery` (not in the web request), so a redeploy of the web
 * process no longer silently drops a run that is in flight.
 *
 * Billing: commit on success, refund on every failure path. `projectedMtc = 0`
 * means an admin run — billing is a no-op.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { runZhangqian, ZhangqianRunError } from '@/lib/zhangqian/agent'
import { completeJob, failJob, updateJobProgress } from '@/lib/zhangqian/persistor'
import {
  DataForSeoTaskError,
  getDomainMetrics,
  getKeywordsForSite,
  bulkKeywordVolume,
} from '@/lib/dataforseo/labs'
import type { DiscoveryWarning } from '@/lib/zhangqian/types'
import { locationCodeFor } from '@/lib/dataforseo/client'
import { loadMemoryForClient } from '@/lib/memory'
import { commitCharge } from '@/lib/mtc/charge'

export const ZHANGQIAN_SERVICE_KEY = 'zhangqian_discover' as const

export async function executeDiscoveryJob(
  jobId: string,
  clientId: string,
  domain: string,
  projectedMtc: number,
  /** clients.semrush_db —— 决定预取用哪个国家的数据。null 时按 au 兜底。 */
  semrushDb: string | null,
): Promise<void> {
  await updateJobProgress(supabaseAdmin, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    progress_note: '正在预取域名数据…',
  })

  // Pre-fetch domain data before starting the agent — never block on failure.
  // ⚠️ 2026-08-26：这里原本把 location_code 写死成 2036（澳洲），不看客户在哪个国家。
  // 于是所有新西兰客户（CTS、Roman、Park Homes、HBay…）拿到的预取上下文都是澳洲
  // 搜索数据。agent 自己的工具是按 location 正确切 2554 的，所以只污染预取这一段，
  // 但那正是喂给模型的第一手材料。改用现成的 locationCodeFor(clients.semrush_db)。
  let semrushContext: string | undefined
  try {
    const [metricsResult, keywordsResult] = await Promise.allSettled([
      getDomainMetrics(domain),
      getKeywordsForSite(domain, locationCodeFor(semrushDb), 20),
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
      // No refund: nothing is debited until commitCharge, after the job completes.
      return
    }

    // Enrich seed keywords with per-keyword SEMrush metrics (volume / KD / CPC)
    let enrichmentWarning: DiscoveryWarning | null = null
    if (report.seed_keywords.length > 0) {
      await updateJobProgress(supabaseAdmin, jobId, { progress_note: '正在获取种子关键词数据…' })
      try {
        const kwTexts = report.seed_keywords.map(kw => kw.keyword)
        const enriched = await bulkKeywordVolume(kwTexts, locationCodeFor(semrushDb))
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
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        enrichmentWarning = {
          stage: 'seed_enrichment',
          ...(err instanceof DataForSeoTaskError && err.errorCode !== undefined
            ? { error_code: err.errorCode }
            : {}),
          message: 'Keyword volume and difficulty could not be refreshed. Other report findings remain available.',
        }
        console.warn('[zhangqian/discover] bulkKeywordVolume enrichment failed', {
          jobId,
          clientId,
          domain,
          error: errorMessage,
        })
      }
    }

    if (enrichmentWarning) {
      report.meta.warnings = [...(report.meta.warnings ?? []), enrichmentWarning]
    }

    await completeJob(supabaseAdmin, jobId, clientId, report)

    // completeJob 会把 progress_note 覆盖成 "Discovery complete."，
    // 所以降级提示必须放在 completeJob 之后，否则会被冲掉。
    if (enrichmentWarning) {
      await updateJobProgress(supabaseAdmin, jobId, {
        progress_note: '⚠️ 种子关键词补数据未完成，报告字段可能不完整（详情见运维日志）',
      })
    }

    // MTC commit (skipped for admin runs where projectedMtc was set to 0)
    if (projectedMtc > 0) {
      await commitCharge(clientId, ZHANGQIAN_SERVICE_KEY, projectedMtc, {
        referenceId: jobId,
        notes: 'zhangqian discovery report',
      })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // 跑挂之前已经花掉的钱要写回账,否则失败记录永远是 cost_usd = 0(见 failJob 头注)。
    const spend =
      err instanceof ZhangqianRunError
        ? { costUsd: err.costUsd, toolCalls: err.toolCalls }
        : undefined
    await failJob(supabaseAdmin, jobId, `Agent error: ${message}`, undefined, spend)
    // No refund: nothing is debited until commitCharge, after the job completes.
  }
}
