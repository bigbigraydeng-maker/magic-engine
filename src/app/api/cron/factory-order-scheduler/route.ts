// factory-order-scheduler cron — 工厂的「开始按钮」。
// 每天给开了 auto_order_enabled 的客户各下一单,然后走既有 decideSignal 闸门。
// Auth: CRON_SECRET bearer(同全部 ME crons)。
//
// 🔴 花钱路径:下单 = 后续 worker 会花生成费(每单封顶 $2)。所以按客户显式开关、默认关,
//    余额/日配额/日花费上限全部沿用 strategist 既有护栏,本 route 不另开口子。

import { NextRequest, NextResponse } from 'next/server'
import { runOrderScheduler } from '@/lib/factory/order-scheduler'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runOrderScheduler()
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
