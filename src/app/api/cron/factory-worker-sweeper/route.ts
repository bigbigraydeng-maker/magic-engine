// P21.J M2 — factory-worker-sweeper cron(*/5,spec §6.1 心跳纪律,魏征 F10)
// ①heartbeat_at 超 10 分钟的 claimed/producing 收回 queued:reclaim_count+1,
//   **不消耗 attempt_count**(Mac 合盖睡眠是「超时」不是「失败」,两次睡眠即 dead_letter 是误判)
// ②离线报警器数据:queued 积压 > 2h 数量 + 全局最后心跳时间(daily digest 消费,M2 后段接)
// Auth: CRON_SECRET bearer(同全部 ME crons)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const HEARTBEAT_STALE_MINUTES = 10
const BACKLOG_ALERT_HOURS = 2
const RECLAIM_ALERT_THRESHOLD = 5

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const staleBefore = new Date(now - HEARTBEAT_STALE_MINUTES * 60_000).toISOString()

  // ① 收回僵死工单(不消耗 attempt,记 reclaim_count)
  const { data: stale, error: staleErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, reclaim_count, claimed_by')
    .in('status', ['claimed', 'producing'])
    .lt('heartbeat_at', staleBefore)
  if (staleErr) {
    return NextResponse.json({ error: staleErr.message }, { status: 500 })
  }

  const reclaimed: string[] = []
  for (const wo of stale ?? []) {
    const nextReclaim = Number(wo.reclaim_count) + 1
    const { data: upd, error: upErr } = await supabaseAdmin
      .from('content_work_orders')
      .update({
        status: 'queued',
        claimed_by: null,
        claimed_at: null,
        heartbeat_at: null,
        reclaim_count: nextReclaim,
        updated_at: new Date().toISOString(),
      })
      .eq('id', wo.id)
      .in('status', ['claimed', 'producing'])
      .lt('heartbeat_at', staleBefore) // 二次条件防与活 worker 心跳竞态
      .select('id')
    if (upErr) {
      console.error(`[factory-worker-sweeper] reclaim ${wo.id} failed: ${upErr.message}`)
      continue
    }
    if (!upd || upd.length === 0) continue // 竞态输给活心跳,0 行不虚报(魏征 M2-P2-4)
    reclaimed.push(wo.id as string)
    if (nextReclaim >= RECLAIM_ALERT_THRESHOLD) {
      console.warn(
        `[factory-worker-sweeper] work order ${wo.id} reclaimed ${nextReclaim}x ` +
        `(worker=${wo.claimed_by}) — 产线机器疑似长期不在线`,
      )
    }
  }

  // ② 离线报警器数据(digest 消费)
  const backlogBefore = new Date(now - BACKLOG_ALERT_HOURS * 3_600_000).toISOString()
  const { count: backlogCount } = await supabaseAdmin
    .from('content_work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued')
    .lt('created_at', backlogBefore)

  const { data: lastBeat } = await supabaseAdmin
    .from('content_work_orders')
    .select('heartbeat_at')
    .not('heartbeat_at', 'is', null)
    .order('heartbeat_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if ((backlogCount ?? 0) > 0) {
    console.warn(`[factory-worker-sweeper] ${backlogCount} queued work orders older than ${BACKLOG_ALERT_HOURS}h`)
  }

  return NextResponse.json({
    ok: true,
    reclaimed,
    backlog_over_2h: backlogCount ?? 0,
    last_heartbeat_at: lastBeat?.heartbeat_at ?? null,
  })
}
