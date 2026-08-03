/**
 * 深度诊断周更 —— 补上 DAPE 的 A 段（分析）。
 *
 * 此前深度诊断**没有任何定时任务**：只能人工点按钮，或新客户建档时跑一次。
 * 最近一次是 2026-07-20。于是 E 段(执行)天天在跑，但执行的是两个月前的结论 ——
 * 没有新分析 → 没有新处方 → 只能重复老动作，而效果在掉。
 *
 * 🔴 结果必须有人看（PM 2026-08-03 拍板：进今日待办逐条看）。
 *    没有消费方的自动化就是再造一个「有数据没人看」—— 今天挖出来的所有毛病
 *    都是这个形状：工厂停摆 8 天没人报、9 个任务坏了没人报、目标数字反了没人报。
 *
 * 周一 08:00 UTC ≈ 周一 20:00 NZST，跑完正好赶上周二早上的待办。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runScheduledDiagnostics } from '@/lib/diagnostic/scheduled-run'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
// 六个维度全量采集 × 若干客户，串行跑。给足时间，超时比跑一半更难查。
export const maxDuration = 800

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('diagnostic-weekly')
  try {
    const summary = await runScheduledDiagnostics(supabaseAdmin)
    const failed = summary.outcomes.filter((o) => o.result === 'error').length
    const ran = summary.outcomes.filter((o) => o.result === 'ran').length

    await cronRun.finish({
      processed: summary.eligible,
      completed: ran,
      failed,
      // 一个都没跑也要写清楚为什么 —— 「空转」和「没跑」必须能分辨
      summary: {
        outcomes: summary.outcomes,
        note:
          summary.eligible === 0
            ? '没有符合条件的客户（要么没域名，要么冷却期内刚诊断过）'
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
