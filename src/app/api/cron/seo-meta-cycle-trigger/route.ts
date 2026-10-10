import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { buildAdapterForClient } from '@/lib/inngest/functions/seo-meta-cycle'
import { generateMetaCycleTitle } from '@/lib/seo-meta/cycle/ai-meta'
import { runDryRunCycle } from '@/lib/seo-meta/cycle/runner'
import {
  META_CYCLE_DUE_EVENT,
  isoWeekKey,
  loadMetaCycleClientConfigForDryRun,
  loadMetaCycleRoster,
  metaCycleEventId,
  toClientConfig,
} from '@/lib/seo-meta/cycle/roster'

/**
 * POST /api/cron/seo-meta-cycle-trigger —— **手动补触发** SEO Meta-Cycle v1。
 *
 * 🔴 **这条路由不在 render.yaml 里排班，也不该排**：周一的定时已经在 Inngest 原生
 *    cron 里了（`cloud-seo-meta-cycle-fanout`，见 src/lib/seo-meta/cycle/roster.ts
 *    的 META_CYCLE_CRON）。本路由只是手动入口，给"等不到下周一"或者本机没有
 *    INNGEST_EVENT_KEY 没法直接发事件的场合用。CLAUDE.md「新建 /api/cron/* 路由
 *    必须同一个 PR 内加 render.yaml 调度条目」这条规矩不适用于这里——它管的是
 *    "谁来定时触发它"，本路由设计上就不该被定时触发，同目录 register/registry
 *    对账见下面这条路由自己不调 startCronRun，不需要登记进 CRON_REGISTRY 或
 *    UNSCHEDULED_CRON_ROUTES。
 *
 * 🔴 **补触发不会重复付款/重复开 PR**：事件 id 复用 `metaCycleEventId(clientId,
 *    weekKey)`——同一 ISO 周内 Inngest 按事件 id 去重，点多少次都只算一轮；就算
 *    去重窗口漏过去，`cloud-seo-meta-cycle-run-one` 自己的 `recentlyCycled` 闸
 *    和 PR 幂等闸（pr-guard.ts）也会挡。
 *
 * 🔴 **本路由不写 cron_run_logs**：跟 flywheel-seo-weekly 手动补触发路由同一个
 *    理由——运行记录是"定时器有没有按时跑"的证据，手动点一下不该伪装成那个证据。
 *    dry_run 模式更是如此——完全不写任何一条 cron_run_logs、不写 seo_meta_log、
 *    不下发人工看板任务，纯只读演练。
 *
 * PM 2026-09-20（incident follow-up）：`dry_run: true` 直接在这个 HTTP 请求里
 * 同步跑完整个 1-4 步（含闸门+事实核对），不经过 Inngest——Inngest 是
 * fire-and-forget，没法把结果同步带回响应体，而 PM 要的是"点一下就能看到这一轮
 * 会出什么方案"。真实（非 dry_run）触发继续走 Inngest 事件派单，行为不变。
 *
 * Body（可选）：
 *   { "client_id": "<uuid>" }              —— 只发这一个客户；不传则发全部已开启的客户
 *   { "client_id": "<uuid>", "dry_run": true } —— 只读演练该客户，dry_run 时 client_id 必填
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120

interface TriggerBody {
  client_id?: unknown
  dry_run?: unknown
}

async function handleDryRun(clientId: string, weekKey: string) {
  const entry = await loadMetaCycleClientConfigForDryRun(supabaseAdmin, clientId)
  if (!entry) {
    return NextResponse.json({ error: `client ${clientId} not found, inactive, or missing a domain` }, { status: 404 })
  }
  const resolved = await buildAdapterForClient(clientId)
  if (!resolved) {
    return NextResponse.json({ error: `client ${clientId} has no repo connection configured — nothing to dry-run against` }, { status: 400 })
  }

  const result = await runDryRunCycle(supabaseAdmin, resolved.adapter, toClientConfig(entry), weekKey, generateMetaCycleTitle)
  return NextResponse.json({
    job: 'seo-meta-cycle-trigger', week_key: weekKey, client_id: clientId,
    dry_run: true, no_writes: true, ...result,
  })
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
  const requestedClientId = typeof body.client_id === 'string' && body.client_id.trim().length > 0 ? body.client_id.trim() : null
  const dryRun = body.dry_run === true

  const now = new Date()
  const weekKey = isoWeekKey(now)

  if (dryRun) {
    if (!requestedClientId) {
      return NextResponse.json({ error: 'dry_run requires client_id' }, { status: 400 })
    }
    return handleDryRun(requestedClientId, weekKey)
  }

  const base = {
    job: 'seo-meta-cycle-trigger',
    week_key: weekKey,
    trigger: 'manual' as const,
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const roster = await loadMetaCycleRoster(supabaseAdmin)
  if (!roster.ok) {
    return NextResponse.json({ ...base, status: 'roster_failed', clients_dispatched: [], error: roster.reason }, { status: 500 })
  }

  const entries = requestedClientId
    ? roster.entries.filter((entry) => entry.clientId === requestedClientId)
    : roster.entries
  if (entries.length === 0) {
    return NextResponse.json({
      ...base,
      status: 'roster_empty',
      clients_dispatched: [],
      ...(requestedClientId ? { client_id: requestedClientId } : {}),
      error: null,
    })
  }

  // 一个客户发不出去不影响其他客户，但必须如实报出去哪几个没发出去 ——
  // 静默吞掉的话，这次补触发看起来成功了，实际有人没被扫。
  const dispatched: string[] = []
  const failed: { client_id: string; error: string }[] = []
  for (const entry of entries) {
    try {
      await sendInngestEvent({
        id: metaCycleEventId(entry.clientId, weekKey),
        name: META_CYCLE_DUE_EVENT,
        data: { client_id: entry.clientId, week_key: weekKey },
      })
      dispatched.push(entry.clientId)
    } catch (err: unknown) {
      failed.push({ client_id: entry.clientId, error: err instanceof Error ? err.message : 'unknown_error' })
    }
  }

  return NextResponse.json(
    {
      ...base,
      status: failed.length === entries.length ? 'roster_failed' : 'dispatched',
      clients_dispatched: dispatched,
      ...(requestedClientId ? { client_id: requestedClientId } : {}),
      error: failed.length > 0 ? `${failed.length}/${entries.length} 条派单没发出去` : null,
      failed,
    },
    { status: failed.length > 0 ? 207 : 200 },
  )
}
