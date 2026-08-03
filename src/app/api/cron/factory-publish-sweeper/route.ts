// P0.1 factory-publish-sweeper cron — 收超时卡死的 publishing 工单(进程崩没收尾,子牙/魏征 B9)。
// 把 publishing_started_at 超 10min 的重置回 approved(清租约锚)→ 下轮 publish-worker 重新处理。
// 🔴 防双发不靠这里:靠 publish-worker 的**本地幂等锚**——重置后若 published_ref 有 provisional video_id,
//    worker 的锚检查会「只对账不重发」;若崩在 start 前(无 video_id),说明啥都没发,正常重发。安全闭环。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STUCK_MIN = 10 // 与 worker-sweeper 同阈值

// 🔴 必须写 cron_run_logs(2026-08-03 补):此前这条路由不留任何运行痕迹,
// 于是「跑了但没事干」和「压根没跑」长得一模一样,监控无法分辨。
// 本仓有 daily-cron-digest 哑 51 天、工厂排产停摆 8 天都没告警的前科。
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('factory-publish-sweeper')
  const cutoff = new Date(Date.now() - STUCK_MIN * 60_000).toISOString()
  try {
    const { data, error } = await supabaseAdmin
      .from('content_work_orders')
      .update({ status: 'approved', publishing_started_at: null, updated_at: new Date().toISOString() })
      .eq('status', 'publishing')
      .lt('publishing_started_at', cutoff)
      .select('id')
    if (error) throw new Error(error.message)
    const ids = (data ?? []).map((r) => r.id)
    if (ids.length) console.warn(`[factory-publish-sweeper] 收回卡死 publishing ${ids.length} 条: ${ids.join(',')}`)
    await cronRun.finish({ processed: ids.length, completed: ids.length, summary: { recovered: ids.length, ids } })
    return NextResponse.json({ ok: true, recovered: ids.length, ids })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
