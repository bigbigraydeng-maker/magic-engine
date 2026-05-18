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

  const result = await accumulateBenchmarks(supabaseAdmin)

  return NextResponse.json({
    success: true,
    benchmarks_updated:  result.benchmarksUpdated,
    groups_skipped:      result.groupsSkipped,
    min_sample_threshold: MIN_SAMPLE_THRESHOLD,
    errors:              result.errors,
  })
}
