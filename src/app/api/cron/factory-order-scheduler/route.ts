// factory-order-scheduler cron — 工厂的「开始按钮」。
// 每天给开了 auto_order_enabled 的客户各下一单,然后走既有 decideSignal 闸门。
// Auth: CRON_SECRET bearer(同全部 ME crons)。
//
// 🔴 花钱路径:下单 = 后续 worker 会花生成费(每单封顶 $2)。所以按客户显式开关、默认关,
//    余额/日配额/日花费上限全部沿用 strategist 既有护栏,本 route 不另开口子。
//
// 🔴 必须写 cron_run_logs(2026-08-03 补):此前这条路由**不留任何运行痕迹**,
//    于是「跑了但一个客户都没开开关」和「压根没跑」长得一模一样。实际排查工厂
//    停摆 8 天时,就是卡在这里分辨不出来 —— 只能靠「工单表没有新行」反推,
//    而那个现象两种原因都能解释。本仓已有 daily-cron-digest 只报「失败」不报
//    「没跑」的前科(哑了 51 天),同一个坑不再踩第二次。

import { NextRequest, NextResponse } from 'next/server'
import { runOrderScheduler } from '@/lib/factory/order-scheduler'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('factory-order-scheduler')
  try {
    const summary = await runOrderScheduler()
    const accepted = summary.outcomes.filter((o) => o.result === 'accepted').length
    const failed = summary.outcomes.filter((o) => o.result === 'error').length
    // rejected 不算 failed —— 那是闸门按设计拒单(余额低/配额满/角度用完),
    // 混进 failed 会让告警天天响,真故障反而被淹掉。但要留在 summary 里可查。
    const rejected = summary.outcomes.filter((o) => o.result === 'rejected').length

    await cronRun.finish({
      processed: summary.enabled_clients,
      completed: accepted,
      failed,
      // 开关全关时 enabled_clients=0 —— 记下来,下次就不用再猜是没跑还是没客户。
      summary: {
        enabled_clients: summary.enabled_clients,
        accepted,
        rejected,
        outcomes: summary.outcomes,
        note:
          summary.enabled_clients === 0
            ? '没有客户打开自动下单开关(factory_config.auto_order_enabled),本轮空转'
            : undefined,
      },
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
