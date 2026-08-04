// factory-stock-refill cron — 素材池自动补货。
//
// 存在理由:没有这条 cron,stock-pipeline 就是零调用方的死代码,素材池永远停在
// 手工灌进去的那几张 —— 出片画面还是「所有 AI 镜头从同一张种子图长出来」。
// 对抗审查(2026-07-25)把这条列为最严重问题,这是它的修复。
//
// Auth: CRON_SECRET bearer(同全部 ME crons)。
//
// 🔴 花钱路径:抓取按张计费(≈$0.002/张)。护栏在 lib 层:只给配了 factory_config 的
//    客户抓 · 池子够 24 张就跳过 · 每客户最多 3 词×12 张 · 搜索词必须能溯源到品牌资料。
//    单次全量最坏约 $0.2 量级,且天然收敛(补够就不再抓)。

import { NextRequest, NextResponse } from 'next/server'
import { runStockRefill } from '@/lib/factory/stock-scheduler'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 🔴 必须写 cron_run_logs(2026-08-03 补):此前这条路由不留任何运行痕迹,
// 于是「跑了但没事干」和「压根没跑」长得一模一样,监控无法分辨。
// 本仓有 daily-cron-digest 哑 51 天、工厂排产停摆 8 天都没告警的前科。
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('factory-stock-refill')
  try {
    const summary = await runStockRefill()
    await cronRun.finish({ summary: { ...summary } })
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
