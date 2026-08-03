/**
 * 处方周更 —— 补上 DAPE 的 P 段（处方）。
 *
 * 周一 08:00 UTC 体检跑完，周二 08:00 UTC 这个接着跑，吃周一的结果开方。
 * 分成两个任务而不是串在一起，是为了**失败能分辨**：
 * 混在一起挂了只知道"这周没结果"，分不清是体检没采到还是方案没生成。
 *
 * 落地策略见 src/lib/diagnostic/auto-prescribe.ts 顶部（PM 2026-08-04 拍板：
 * 方案自动落地进执行看板，待办里只通知一声，不等 PM 一份份点头）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runAutoPrescribe } from '@/lib/diagnostic/auto-prescribe'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
// 每份方案要打一次 AI，串行跑若干客户。超时比跑一半更难查，给足时间。
export const maxDuration = 800

export async function GET(req: NextRequest) {
  // 🔴 密钥没配时，比较目标会变成字面量 "Bearer undefined" —— 任何人发这个头就进来了，
  //    而这条链会打 AI、写客户数据。仓库里 54 个定时接口有 34 个带这道守卫，
  //    这里必须是带的那一半。
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 🔴 同一时间只许跑一轮。
  //    两轮同时跑的后果不是"多花一次 AI 的钱"那么轻：两边都会读到同一份
  //    「当前生效的方案」，于是都去归档它、都落地一份新的 —— 同一个目标下
  //    留下两份生效方案、两套动作，而下周只会归档其中一份，另一份永远孤儿。
  //    待办按客户去重，PM 一辈子看不见。
  //    这不是严格互斥（真同一毫秒的两个请求还是能双双读空），但整个危险窗口
  //    是 AI 调用那几十秒，这一招足以把它从"静默双写客户数据"压到"明确报跳过"。
  //    治本是给（目标, 版本号）加唯一索引，那要动数据库，留给下一批。
  //    必须在 startCronRun 之前查 —— 之后查会读到自己刚插进去的那条。
  const { data: inFlight } = await supabaseAdmin
    .from('cron_run_logs')
    .select('id')
    .eq('job_name', 'prescription-weekly')
    .eq('status', 'running')
    .gte('started_at', new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(1)
  if (inFlight && inFlight.length > 0) {
    return NextResponse.json({ ok: true, skipped: '已有一轮在跑，本次跳过' })
  }

  const cronRun = await startCronRun('prescription-weekly')
  try {
    const summary = await runAutoPrescribe(supabaseAdmin)
    const failed = summary.outcomes.filter((o) => o.result === 'error').length

    await cronRun.finish({
      processed: summary.considered,
      completed: summary.prescribed,
      failed,
      // 一份都没开也要写清楚为什么 —— 「空转」和「没跑」必须能分辨
      summary: {
        outcomes: summary.outcomes,
        note:
          summary.considered === 0
            ? '本周没有任何客户跑过体检 —— 先看周一的体检任务是不是没跑'
            : undefined,
      },
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
