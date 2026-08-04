/**
 * GET /api/cron/benchmark-accumulator
 *
 * 行业基准自动累积 cron — P8.12.S2.4
 *
 * 每周（或按需）运行：
 *   1. 读取 prescription_outcomes（已有实测值）
 *   2. 按 (industry_category, business_size, market, kpi_metric) 分组
 *   3. 计算 P50/P75/P90（满足最低样本阈值才写入）
 *   4. Upsert 到 industry_benchmarks
 *
 * Auth: Bearer ${CRON_SECRET}
 * Reference: ROADMAP.md P8.12.S2.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { accumulateBenchmarks, MIN_SAMPLE_THRESHOLD } from '@/lib/case-library/benchmark-accumulator'
import { startCronRun } from '@/lib/cron/run-logger'

export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 写运行记录 —— 没有它这个任务在健康检查里是「看不见」那一类：
  // 跑没跑都查不出来，而这条链已经因为「看不见」瘫过一次（见下方文件头注）。
  const cronRun = await startCronRun('benchmark-accumulator')
  try {
    const result = await accumulateBenchmarks(supabaseAdmin)

    await cronRun.finish({
      processed: result.benchmarksUpdated + result.groupsSkipped,
      completed: result.benchmarksUpdated,
      failed: result.errors.length,
      // 一条基准都没更新时要写清为什么 —— 样本不够是正常的，不是故障
      summary: {
        benchmarks_updated: result.benchmarksUpdated,
        groups_skipped: result.groupsSkipped,
        min_sample_threshold: MIN_SAMPLE_THRESHOLD,
        note:
          result.benchmarksUpdated === 0
            ? `没有一组样本量达到 ${MIN_SAMPLE_THRESHOLD}，本轮不写基准（等实测结果攒够）`
            : undefined,
      },
    })

    return NextResponse.json({
      success: true,
      benchmarks_updated:  result.benchmarksUpdated,
      groups_skipped:      result.groupsSkipped,
      min_sample_threshold: MIN_SAMPLE_THRESHOLD,
      errors:              result.errors,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
