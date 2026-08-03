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
