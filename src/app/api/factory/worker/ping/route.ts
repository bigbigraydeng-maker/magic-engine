// POST /api/factory/worker/ping — 出片机空闲时的「我还活着」信号。
// 工单心跳（[id]/heartbeat）只在干活时刷新；空闲的 worker 此前没有任何信号，
// 于是「队列有活但没人领」要等 6 小时才能判成离线。这里复用 cron_run_logs，
// 一台 worker 只占一行（原地刷新 started_at，不堆积），读侧见 pushFactoryWorkerItems。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseRenderWorkerField } from '@/lib/factory/render-worker-report'
import { assessEngineReport } from '@/lib/factory/engine-catalog.mjs'
import {
  isWorkerAuthorized,
  workerClaimClientIds,
  workerClientWhitelist,
  workerIdFromBody,
} from '@/lib/factory/worker-guard'

export const dynamic = 'force-dynamic'

const FACTORY_ALIVE_JOB = 'factory-worker-alive'

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // body 必须有 worker_id，下面会拒
  }
  const workerId = workerIdFromBody(body)
  if (!workerId || workerId.length > 100) {
    return NextResponse.json({ error: 'worker_id required (<=100 chars)' }, { status: 400 })
  }
  // 存活信号只算给「这台 worker 真能领的客户」：跟 claim 同一套白名单口径。
  // 没限定客户的 worker 展开成整个白名单；限定了就只算那一个；越权或白名单没配一律拒。
  const whitelist = workerClientWhitelist()
  if (!whitelist) return NextResponse.json({ error: 'FACTORY_WORKER_CLIENT_IDS not configured' }, { status: 503 })
  const clientIds = workerClaimClientIds(body, whitelist)
  if (!clientIds) return NextResponse.json({ error: 'client_id must be allowlisted when provided' }, { status: 403 })

  const at = new Date().toISOString()
  const renderWorker = parseRenderWorkerField(body)
  const engine = assessEngineReport(body.engine)
  const row = {
    status: 'completed',
    started_at: at,
    finished_at: at,
    duration_ms: 0,
    summary: {
      worker_id: workerId,
      client_ids: clientIds,
      ...(renderWorker ? { render_worker: renderWorker } : {}),
      engine_rev: engine.engine_rev,
      engine_stale: !engine.ok,
      ...(!engine.ok ? { engine_notice: engine.message } : {}),
    },
  }
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('cron_run_logs')
    .select('id')
    .eq('job_name', FACTORY_ALIVE_JOB)
    .eq('summary->>worker_id', workerId)
    .limit(1)
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  const id = (existing ?? [])[0]?.id as string | undefined
  const { error } = id
    ? await supabaseAdmin.from('cron_run_logs').update(row).eq('id', id)
    : await supabaseAdmin.from('cron_run_logs').insert({ job_name: FACTORY_ALIVE_JOB, ...row })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
