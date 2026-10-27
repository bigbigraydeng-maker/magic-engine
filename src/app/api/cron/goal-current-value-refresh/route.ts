/**
 * GET /api/cron/goal-current-value-refresh
 *
 * A2.1-γ daily cron — refresh all active Goals' current_value column
 * by calling autoFetchMetricValue(goal.primary_metric_key).
 *
 * Schedule: 17:30 UTC daily (Render cron; moved from 03:00 UTC on 2026-09-16,
 * PM "NZ morning window") — after the 16:30 UTC industry-ai-visibility-daily
 * cron, so ai_visibility_score reads today's snapshots (not yesterday's).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Returns: { processed, succeeded, failed, errors: [...] }
 *
 * Spec: docs/superpowers/specs/2026-06-04-a21-stepc-design-v3.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { readSeatFetchExtras } from '@/lib/strategy/seat-scope'
import { startCronRun } from '@/lib/cron/run-logger'

export const maxDuration = 300 // 5 min — generous; cron typically completes <60s

interface GoalRow {
  id: string
  client_id: string
  primary_metric_key: string
  period_start: string
  period_end: string
  supporting_metrics?: unknown
  created_at?: string | null
  baseline_value?: unknown
}

interface CronResult {
  processed: number
  succeeded: number
  failed: number
  errors: Array<{ goal_id: string; reason: string }>
  /** Source answered but has no records yet — shown, but not a failed run. */
  no_data: Array<{ goal_id: string; reason: string }>
  duration_ms: number
}

function summarizeErrors(errors: CronResult['errors']): string {
  const [first] = errors
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
  return `goal ${first.goal_id}: ${first.reason}${more}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()

  // ── Auth ────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('goal-current-value-refresh')

  // ── Load active goals ───────────────────────────────────────────────────
  const goalsRes = await supabaseAdmin
    .from('goals')
    .select('id, client_id, primary_metric_key, period_start, period_end, supporting_metrics, created_at, baseline_value')
    .eq('status', 'active')

  const goalsErr = (goalsRes as { error: { message: string } | null }).error
  if (goalsErr) {
    await cronRun.finish({ failed: 1, error: `Failed to load active goals: ${goalsErr.message}` })
    return NextResponse.json({ error: `Failed to load active goals: ${goalsErr.message}` }, { status: 500 })
  }
  const allGoals = (goalsRes as { data: GoalRow[] | null }).data ?? []

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）。
  // autoFetchMetricValue 有 DataForSEO live 直调路径，调研档案的 goal 不刷。
  let goals: GoalRow[] = []
  if (allGoals.length > 0) {
    const clientIds = Array.from(new Set(allGoals.map((g) => g.client_id)))
    const { data: activeClients, error: activeErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .in('id', clientIds)
      .eq('client_status', 'active')

    if (activeErr) {
      await cronRun.finish({ failed: 1, error: activeErr.message })
      return NextResponse.json(
        { error: `Failed to filter active clients: ${activeErr.message}` },
        { status: 500 },
      )
    }

    const activeIds = new Set(((activeClients ?? []) as Array<{ id: string }>).map((c) => c.id))
    goals = allGoals.filter((g) => activeIds.has(g.client_id))
  }

  if (goals.length === 0) {
    const result: CronResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      no_data: [],
      duration_ms: Date.now() - startedAt,
    }
    console.log('[goal-current-value-refresh]', result)
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json(result)
  }

  // ── Process each goal independently (per-goal try/catch) ────────────────
  let succeeded = 0
  let failed = 0
  const errors: Array<{ goal_id: string; reason: string }> = []
  const noData: Array<{ goal_id: string; reason: string }> = []

  for (const goal of goals) {
    try {
      // 传这个目标自己的时间段：一个客户可以同时有多个 active 目标（2026-09-24 起已出现）。
      const extras = readSeatFetchExtras(goal)
      if (!extras.ok) {
        failed++
        errors.push({ goal_id: goal.id, reason: extras.reason })
        continue
      }
      const result = await autoFetchMetricValue(
        supabaseAdmin as any,
        goal.client_id,
        goal.primary_metric_key,
        {
          goalPeriod: { period_start: goal.period_start, period_end: goal.period_end },
          ...(extras.extras ?? {}),
        },
      )

      if (!result.ok) {
        // 「数据源正常、只是还没有记录」不是故障：记下来，但不把整次运行判成失败，
        // 否则它会天天把健康页和今日待办刷红，真故障反而被当噪音。
        // 其它 unknown（多目标歧义、查询报错）仍然算失败。
        if ('noData' in result && result.noData) {
          noData.push({ goal_id: goal.id, reason: result.reason })
        } else {
          failed++
          errors.push({ goal_id: goal.id, reason: result.reason })
        }
        continue
      }

      // UPDATE current_value (last-write-wins; race guard via fetched_at order)
      const nowIso = new Date().toISOString()
      const updRes = await supabaseAdmin
        .from('goals')
        .update({
          current_value: result.value,
          current_value_fetched_at: nowIso,
          current_value_source: 'auto.cron',
        })
        .eq('id', goal.id)

      const updErr = (updRes as { error: { message: string } | null }).error
      if (updErr) {
        failed++
        errors.push({ goal_id: goal.id, reason: `DB UPDATE failed: ${updErr.message}` })
      } else {
        succeeded++
      }
    } catch (err) {
      failed++
      errors.push({
        goal_id: goal.id,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const result: CronResult = {
    processed: goals.length,
    succeeded,
    failed,
    errors,
    no_data: noData,
    duration_ms: Date.now() - startedAt,
  }
  console.log('[goal-current-value-refresh]', JSON.stringify(result))
  // 有目标没刷成 → 这次运行记 failed 并带上原因。2026-09-24/25 两次全失败却记成
  // completed、原因为空，健康页一片绿，某客户两个目标连续两天没有当前值没人发现。
  await cronRun.finish({
    processed: goals.length,
    completed: succeeded,
    failed,
    summary: { errors, no_data: noData },
    error: failed > 0 ? summarizeErrors(errors) : undefined,
  })
  return NextResponse.json(result)
}
