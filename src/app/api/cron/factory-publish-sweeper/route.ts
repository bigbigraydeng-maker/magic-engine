// P0.1 factory-publish-sweeper cron — 收超时卡死的 publishing 工单(进程崩没收尾,子牙/魏征 B9)。
// 把 publishing_started_at 超 10min 的重置回 approved(清租约锚)→ 下轮 publish-worker 重新处理。
// 🔴 防双发不靠这里:靠 publish-worker 的**本地幂等锚**——重置后若 published_ref 有 provisional video_id,
//    worker 的锚检查会「只对账不重发」;若崩在 start 前(无 video_id),说明啥都没发,正常重发。安全闭环。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STUCK_MIN = 10 // 与 worker-sweeper 同阈值

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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
    return NextResponse.json({ ok: true, recovered: ids.length, ids })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
