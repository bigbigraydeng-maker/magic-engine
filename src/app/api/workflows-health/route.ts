/**
 * GET /api/workflows-health
 *
 * 内部 ops 看板的数据源：全仓所有定时任务 + Inngest 工作流的健康度。
 *
 * 存在理由：`daily-cron-digest` 只在邮件里报"最近 24 小时哪个 job status='failed'"，
 * 它看不到——
 *   · 该跑没跑（overdue）
 *   · 跑了但没写下游（silent_success，2026-09-23 事故根因）
 *   · 卡死（stuck）
 * 这些盲区各有独立数据源（cron_run_logs 起来 pull 一次），前端总览一屏摆出来。
 *
 * 读侧：只查 cron_run_logs + registry 里 outputTables 声明的目标表 max()，
 * 不写任何数据，不打外部 API（不打 Render / Inngest 后台）。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { checkCronHealth, summarise } from '@/lib/cron/health'

// 60 秒缓存：健康检查扫全部 job × outputTables，短时间内重复刷不必打全套查询。
// 数据本身也没那么"实时"—— cron 间隔从 10 分钟到每周不等，60 秒的滞后无感知。
export const revalidate = 60
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  try {
    const report = await checkCronHealth(supabaseAdmin)
    return NextResponse.json({
      success: true,
      report,
      summary: summarise(report),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
