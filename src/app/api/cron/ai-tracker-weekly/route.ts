import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/ai-tracker-weekly
 *
 * Weekly cron — runs the AI Visibility Tracker for every client that has
 * at least one enabled query. Triggered by Render Cron every Monday.
 *
 * Returns 202 immediately and runs the tracker in the background to avoid
 * Cloudflare's 100s gateway timeout (tracker takes 10–15 min for all clients).
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * Reference: ROADMAP.md P7.1.11, ARCHITECTURE.md §12.3
 *
 * 🔴 **灰度迁移期间跟 `src/lib/inngest/functions/ai-visibility-weekly.ts` 互斥**（2026-09-21）：
 *    开了 `clients.seo_config.ai_visibility_inngest_enabled` 的客户改由 Inngest 那条新链路
 *    每周处理，本路由的候选查询显式排除他们——否则同一个客户会被两条链路各打一遍 provider、
 *    各写一次数据库：两条定时点几乎撞在同一时刻（本路由 `render.yaml` 排的 `0 18 * * 0`
 *    UTC，新链路是 NZ 本地时间 Mon 06:00，多数月份是同一时刻），一旦有人给某个客户打开
 *    开关，不需要任何操作失误就会触发重复扣费。子牙+魏征两轮复审共同发现，修法照抄
 *    `flywheel-seo-weekly` 那次教训（同一件事两处实现会漂移，是平台化原则禁止的平行系统），
 *    但这里选的是最小排除过滤、不是把本路由整个改造成 Inngest 重派单入口——那样会让还没
 *    开新开关的其余客户当场失去每周检查（新链路的名单本来就只认开了开关的客户），
 *    不在本次迁移范围内，留给旧 cron 真正下线那次 PR。
 */

// Allow up to 15 min for the background work to complete on Render.
export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fire background work without awaiting — respond 202 immediately so
  // Cloudflare doesn't time out the curl trigger (524 after ~100s).
  void runInBackground()

  return NextResponse.json(
    { success: true, message: 'AI tracker started in background' },
    { status: 202 }
  )
}

async function runInBackground() {
  const cronRun = await startCronRun('ai-tracker-weekly')

  // Find clients that have at least one enabled query
  const { data: clientsWithQueries, error: queryErr } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('client_id')
    .eq('enabled', true)

  if (queryErr) {
    console.error('[ai-tracker-weekly] Failed to load clients:', queryErr.message)
    await cronRun.finish({ failed: 1, error: queryErr.message })
    return
  }

  const candidateIds = Array.from(
    new Set((clientsWithQueries ?? []).map(r => (r as { client_id: string }).client_id))
  )

  if (candidateIds.length === 0) {
    console.log('[ai-tracker-weekly] No clients have enabled queries — nothing to run')
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return
  }

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）。
  // 调研档案就算配了 enabled query 也不烧 LLM 钱。
  const { data: activeClients, error: activeErr } = await supabaseAdmin
    .from('clients')
    .select('id, seo_config')
    .in('id', candidateIds)
    .eq('client_status', 'active')

  if (activeErr) {
    console.error('[ai-tracker-weekly] Failed to filter active clients:', activeErr.message)
    await cronRun.finish({ failed: 1, error: activeErr.message })
    return
  }

  // 🔴 排除已经开了 ai_visibility_inngest_enabled 的客户——他们这周改由 Inngest 那条新链路
  // 处理（见本文件顶部注释）。漏排会导致同一个客户被两条链路各花一次 provider 的钱。
  const clientIds = (activeClients ?? [])
    .filter(r => {
      const cfg = (r as { seo_config?: unknown }).seo_config as Record<string, unknown> | null | undefined
      return cfg?.['ai_visibility_inngest_enabled'] !== true
    })
    .map(r => (r as { id: string }).id)

  if (clientIds.length === 0) {
    console.log('[ai-tracker-weekly] No active clients have enabled queries — nothing to run')
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return
  }

  let totalCost = 0
  let succeeded = 0
  let failed = 0

  // Process clients sequentially — multiple clients in parallel would
  // multiply provider RPM pressure.
  for (const clientId of clientIds) {
    try {
      const result = await runTracker({ client_id: clientId })
      totalCost += result.total_cost_usd
      // 🔴 2026-09-23 fix, corrected 2026-09-28: when every single probe
      //    failed, this client got ZERO usable data this week. Originally
      //    checked `runs_succeeded === 0` — but `runs_succeeded` still counts
      //    a run where the provider answered and the DB write worked even
      //    when our own parser couldn't extract a ranking (parse_error_message
      //    set). A week where every probe hit that exact failure mode would
      //    have kept showing "succeeded" here. Uses `runs_conclusive` instead
      //    — the same isRunConclusive standard the snapshot gate and the new
      //    ai_tracker_all_failed PM alert both already use (Codex review
      //    2026-09-28) — so all three layers agree on what "got real data"
      //    means. This is the blind spot that let East International's
      //    24/24 failure go unnoticed for three days (2026-09-20).
      if (result.runs_conclusive === 0 && result.runs_attempted > 0) {
        failed++
        console.warn(
          `[ai-tracker-weekly] client=${clientId} ALL PROBES FAILED — runs_attempted=${result.runs_attempted} runs_conclusive=${result.runs_conclusive} runs_failed=${result.runs_failed} cost=$${result.total_cost_usd.toFixed(4)}`
        )
      } else {
        succeeded++
        console.log(
          `[ai-tracker-weekly] client=${clientId} conclusive=${result.runs_conclusive} succeeded=${result.runs_succeeded} failed=${result.runs_failed} cost=$${result.total_cost_usd.toFixed(4)}`
        )
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[ai-tracker-weekly] client=${clientId} error:`, message)
      failed++
    }
  }

  console.log(`[ai-tracker-weekly] Done. clients=${clientIds.length} total_cost=$${totalCost.toFixed(4)}`)
  await cronRun.finish({
    processed: clientIds.length,
    completed: succeeded,
    failed,
    summary: { total_cost_usd: totalCost },
  })
}
