import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  buildSnapshotEvents,
  type FanOutReceipt,
} from '@/lib/inngest/functions/flywheel-seo-weekly'
import { isoWeekKey, loadSnapshotRoster, PROVIDER_CALLS_PER_CLIENT } from '@/lib/flywheel/seo-weekly'

/**
 * GET /api/cron/flywheel-seo-weekly —— **手动补触发**每周 SEO 快照。
 *
 * 🔴 **这条路由不再自己干活**（2026-09-07 改）。定时和执行都在 Inngest 上：
 *    `cloud-flywheel-seo-weekly-fanout` 每周一 05:15 新西兰时间派单，
 *    `cloud-flywheel-seo-snapshot-one` 一个客户一单地干。本路由只是把同一批条子
 *    再发一遍，给「等不到下周一」的场合用。
 *
 * 🔴 **为什么不保留原来那套「一个请求里串着跑完所有客户」**：留着就是两条执行路径，
 *    同一件事两处实现、两处会漂移，正是平台化原则里禁止的平行系统。
 *
 * 🔴 **补触发不会重复付款**：条子的事件 id 是「客户 + ISO 周」，同一周内 Inngest 按 id
 *    去重。所以本路由在同一周内点多少次，钱只花一轮。
 *
 * 🔴 **本路由不写 cron_run_logs**：运行记录是「定时器有没有按时跑」的证据，手动补触发
 *    写进去会把「人手点了一下」伪装成「定时器正常」，正好盖住要监控的那件事。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const weekKey = isoWeekKey(now)
  // A bounded client_id mode is for controlled smoke tests and recovery. The
  // default remains the full roster for the scheduled/manual weekly run.
  const requestedClientId = req.nextUrl.searchParams.get('client_id')?.trim() || null
  const requestedAttempt = req.nextUrl.searchParams.get('attempt')?.trim() || null
  if (requestedAttempt && !/^[A-Za-z0-9._-]{1,64}$/.test(requestedAttempt)) {
    return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 })
  }
  const base = {
    job: 'flywheel-seo-weekly',
    week_key: weekKey,
    trigger: 'manual' as const,
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const roster = await loadSnapshotRoster(supabaseAdmin)
  if (!roster.ok) {
    return NextResponse.json(
      { ...base, status: 'roster_failed', clients_dispatched: 0, error: roster.reason },
      { status: 500 },
    )
  }

  const entries = requestedClientId
    ? roster.entries.filter((entry) => entry.clientId === requestedClientId)
    : roster.entries
  const events = buildSnapshotEvents(entries, weekKey, requestedAttempt ?? undefined)
  if (events.length === 0) {
    return NextResponse.json({
      ...base,
      status: 'roster_empty',
      clients_dispatched: 0,
      estimated_provider_calls: 0,
      ...(requestedClientId ? { client_id: requestedClientId } : {}),
      error: null,
    })
  }

  // 🔴 一个客户发不出去不影响其他客户，但**必须如实报出去哪几个没发出去** ——
  //    静默吞掉的话，这次补触发看起来成功了，实际有人没被扫。
  const failed: { client_id: string; error: string }[] = []
  for (const event of events) {
    try {
      await sendInngestEvent(event)
    } catch (err: unknown) {
      failed.push({
        client_id: event.data.client_id,
        error: err instanceof Error ? err.message : 'unknown_error',
      })
    }
  }

  const dispatched = events.length - failed.length
  const receipt: FanOutReceipt & { trigger: 'manual'; failed: typeof failed } = {
    ...base,
    status: failed.length === events.length ? 'roster_failed' : 'dispatched',
    clients_dispatched: dispatched,
    estimated_provider_calls: dispatched * PROVIDER_CALLS_PER_CLIENT,
    ...(requestedClientId ? { client_id: requestedClientId } : {}),
    ...(requestedAttempt ? { attempt: requestedAttempt } : {}),
    error: failed.length > 0 ? `${failed.length}/${events.length} 条派单没发出去` : null,
    failed,
  }
  return NextResponse.json(receipt, { status: failed.length > 0 ? 207 : 200 })
}
