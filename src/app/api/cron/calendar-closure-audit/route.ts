import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { createLiveAuditDeps } from '@/lib/calendar-closure/deps'
import { runCalendarClosureAudit, nzTodayDate } from '@/lib/calendar-closure/run-audit'
import { CALENDAR_CLOSURE_DUE_EVENT, CALENDAR_CLOSURE_JOB } from '@/lib/calendar-closure/types'

/**
 * POST /api/cron/calendar-closure-audit —— 日历到期事项巡检的**手动入口**。
 *
 * 🔴 **这条路由不在 render.yaml 里排班，也不该排**：每天 07:20 的定时在 Inngest 原生 cron 里
 *    （`cloud-calendar-closure-audit`，见 src/lib/inngest/functions/calendar-closure-audit.ts）。
 *    CLAUDE.md「新建 /api/cron/* 路由必须同 PR 加 render.yaml」管的是「谁来定时触发它」，
 *    本路由设计上不该被定时触发——先例 seo-meta-cycle-trigger。本路由自己不调 startCronRun，
 *    运行记录由 Inngest 函数写。
 *
 * 🔴 `dry_run: true` 在本请求里同步跑完整条链路，**不发 Inngest 事件、不写任何表**，
 *    结果顶层固定 `not_evidence: true`，不能当验收证据贴进台账。
 *    `only_event_id` / `today_override` / `probe_override` 只在 dry_run 下可用，非演练一律 400。
 *
 * Body（全部可选）：
 *   {}                                   —— 发一个事件，让 Inngest 函数跑一轮真实巡检
 *   { "dry_run": true }                  —— 同步演练全部到期事件
 *   { "dry_run": true, "only_event_id": "<日历事件 id>", "today_override": "YYYY-MM-DD",
 *     "probe_override": "todo_item_present kind=comment_scope_missing client=<客户 id>" }
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120

interface TriggerBody {
  dry_run?: unknown
  only_event_id?: unknown
  today_override?: unknown
  probe_override?: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: TriggerBody = {}
  try {
    const text = await req.text()
    if (text.trim().length > 0) body = JSON.parse(text) as TriggerBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const dryRun = body.dry_run === true
  const onlyEventId = str(body.only_event_id)
  const todayOverride = str(body.today_override)
  const probeOverride = str(body.probe_override)

  if (!dryRun && (onlyEventId || todayOverride || probeOverride)) {
    return NextResponse.json(
      { error: 'only_event_id / today_override / probe_override are dry_run only' },
      { status: 400 },
    )
  }
  if (todayOverride && !/^\d{4}-\d{2}-\d{2}$/.test(todayOverride)) {
    return NextResponse.json({ error: 'today_override must be YYYY-MM-DD' }, { status: 400 })
  }

  if (dryRun) {
    const receipt = await runCalendarClosureAudit(createLiveAuditDeps(supabaseAdmin), {
      dryRun: true,
      source: 'live',
      onlyEventId,
      todayOverride,
      probeOverrideLine: probeOverride,
    })
    return NextResponse.json({ ...receipt, no_writes: true })
  }

  try {
    const result = await sendInngestEvent({
      id: `${CALENDAR_CLOSURE_JOB}:manual:${nzTodayDate(new Date())}:${randomUUID()}`,
      name: CALENDAR_CLOSURE_DUE_EVENT,
      data: { trigger: 'manual' },
    })
    return NextResponse.json({
      job: CALENDAR_CLOSURE_JOB,
      status: 'dispatched',
      trigger: 'manual',
      event_ids: result.event_ids,
      no_publish: true,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { job: CALENDAR_CLOSURE_JOB, status: 'dispatch_failed', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
