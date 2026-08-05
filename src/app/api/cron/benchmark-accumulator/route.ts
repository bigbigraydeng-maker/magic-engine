/**
 * GET /api/cron/benchmark-accumulator
 *
 * 行业基准自动累积 cron — ME 自有客户实测结果 → industry_benchmarks 增长字段
 *
 * 每周运行：
 *   1. 读取最近 180 天的 flywheel_outcomes（真实 delta_pct）
 *   2. clients.industry → benchmark 行业代码，按 (industry, dimension) 分组
 *   3. 归一化指标方向 → 取中位增幅（满足最低样本阈值才写入）
 *   4. 只写 industry_benchmarks 的 GROWTH 字段（realistic_3mo_growth_pct +
 *      growth_* provenance），绝不碰外部研究数据的 score_p50/p75/p90
 *
 * Auth: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { accumulateBenchmarks, MIN_SAMPLE_THRESHOLD } from '@/lib/case-library/benchmark-accumulator'

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
      failed:    result.errors.length,
      // 一条基准都没更新时要写清为什么 —— 样本不够是正常的，不是故障
      summary: {
        benchmarks_updated:   result.benchmarksUpdated,
        groups_skipped:       result.groupsSkipped,
        clients_unmapped:     result.clientsUnmapped,
        min_sample_threshold: MIN_SAMPLE_THRESHOLD,
        note:
          result.benchmarksUpdated === 0
            ? `没有一组样本量达到 ${MIN_SAMPLE_THRESHOLD}，本轮不写基准（等实测结果攒够）`
            : undefined,
      },
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
    })

    return NextResponse.json({
      success: true,
      benchmarks_updated:   result.benchmarksUpdated,
      groups_skipped:       result.groupsSkipped,
      clients_unmapped:     result.clientsUnmapped,
      min_sample_threshold: MIN_SAMPLE_THRESHOLD,
      errors:               result.errors,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // failed: 1 不能少 —— 只写 error 不写 failed，健康检查会把这次崩溃算成「跑成功了」
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
