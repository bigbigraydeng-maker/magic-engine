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
import { runExtractorForClient, runExtractorForAllClients } from '@/lib/memory'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
        `preferences+${result.preferences_added} decisions+${result.decisions_updated} ` +
        `errors=${result.errors.length}`,
      )
      await cronRun.finish({
        processed: result.outcomes_processed,
        completed: result.outcomes_processed - result.errors.length,
        failed: result.errors.length,
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
      `preferences+${batch.aggregate.preferences_added} decisions+${batch.aggregate.decisions_updated} ` +
      `client_errors=${batch.per_client_errors.length}`,
    )
    await cronRun.finish({
      processed: batch.clients_processed,
      completed: batch.clients_processed - batch.per_client_errors.length,
      failed: batch.per_client_errors.length,
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
