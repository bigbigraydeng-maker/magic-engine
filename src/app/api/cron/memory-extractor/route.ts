/**
 * POST /api/cron/memory-extractor
 *
 * Phase 23.C — 自动跑 L3 记忆抽取器：从 flywheel_outcomes 推导 patterns /
 * failed_experiments / learned_preferences，并回填 decision_history.outcome_verdict。
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: 每日（与 attribution cron 错开 1 小时，确保 outcomes 已更新）
 *
 * Query params (optional):
 *   client_id — 只跑单个客户（手动 debug 用）
 *
 * Responses:
 *   200  { ok: true, ... }
 *   401  缺/错 Bearer token
 *   500  抽取器自身崩溃（应极罕见 — extractor 内部已 catch 单条错误）
 *
 * Reference: ROADMAP.md Phase 23.C
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runExtractorForClient, runExtractorForAllClients, type ExtractorResult } from '@/lib/memory'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * What the run log must keep: the stale-evidence count, and every memory switched off
 * this run with its table and reason — restoring by this list is the rollback path
 * (run logs with a summary are kept 180 days).
 */
function reconcileSummary(result: ExtractorResult): Record<string, unknown> {
  return {
    outcomes_stale_skipped: result.outcomes_stale_skipped,
    deactivated_by_reason: result.deactivated_by_reason,
    deactivated: result.deactivated,
    skipped_attribution_stalled: result.skipped_attribution_stalled,
    skipped_immature: result.skipped_immature,
    skipped_unknown_pillar: result.skipped_unknown_pillar,
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('memory-extractor')

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('client_id') ?? undefined

  if (clientId) {
    try {
      const result = await runExtractorForClient(supabaseAdmin, clientId)
      console.log(
        `[memory-extractor/cron] client=${clientId} outcomes=${result.outcomes_processed} ` +
        `patterns+${result.patterns_added} experiments+${result.experiments_added} ` +
        `preferences+${result.preferences_added} stale_skipped=${result.outcomes_stale_skipped} ` +
        `errors=${result.errors.length}`,
      )
      await cronRun.finish({
        processed: result.outcomes_processed,
        completed: result.outcomes_processed - result.errors.length,
        failed: result.errors.length,
        // 「有多少证据因为太久没重算被挡在门外」必须落进运行记录 ——
        // 只挡不报等于把一次静默丢弃换成了另一次。
        // 下架清单（带表名）也必须进运行记录：它就是回滚清单。
        summary: reconcileSummary(result),
      })
      return NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        mode: 'single_client',
        client_id: clientId,
        result,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[memory-extractor/cron] single client error:', message)
      await cronRun.finish({ failed: 1, error: message })
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const batch = await runExtractorForAllClients(supabaseAdmin)
    console.log(
      `[memory-extractor/cron] all clients_processed=${batch.clients_processed} ` +
      `patterns+${batch.aggregate.patterns_added} experiments+${batch.aggregate.experiments_added} ` +
      `preferences+${batch.aggregate.preferences_added} stale_skipped=${batch.aggregate.outcomes_stale_skipped} ` +
      `client_errors=${batch.per_client_errors.length}`,
    )
    await cronRun.finish({
      processed: batch.clients_processed,
      completed: batch.clients_processed - batch.per_client_errors.length,
      failed: batch.per_client_errors.length,
      summary: reconcileSummary(batch.aggregate),
    })
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      mode: 'all_clients',
      ...batch,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[memory-extractor/cron] batch error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
