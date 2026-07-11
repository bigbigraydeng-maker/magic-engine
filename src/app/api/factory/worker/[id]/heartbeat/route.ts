// P21.J M2 — POST /api/factory/worker/[id]/heartbeat(spec §6.1)
// 60s 心跳:刷 heartbeat_at;body 可带 {stage, cost_so_far_usd} 实时累计 actual_cost_usd。
// 超 budget_cap 返回 abort:true(第二道防线;第一道是 worker 本地 max_new_clips 预扣 check)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isWorkerAuthorized } from '@/lib/factory/worker-guard'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = ['claimed', 'producing']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isWorkerAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // body 可选
  }
  const costSoFar = typeof body.cost_so_far_usd === 'number' && Number.isFinite(body.cost_so_far_usd)
    ? body.cost_so_far_usd
    : null

  const { data: wo, error: loadErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, status, budget_cap_usd, actual_cost_usd')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 })
  }
  if (!wo || !ACTIVE_STATUSES.includes(wo.status)) {
    return NextResponse.json(
      { error: `work order not active (status=${wo?.status ?? 'missing'})` },
      { status: 409 },
    )
  }

  // 成本只增不减(防乱序心跳回退计数)
  const nextCost = costSoFar !== null
    ? Math.max(Number(wo.actual_cost_usd), costSoFar)
    : Number(wo.actual_cost_usd)

  const { error: upErr } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      heartbeat_at: new Date().toISOString(),
      status: 'producing',
      actual_cost_usd: nextCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ACTIVE_STATUSES)
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const abort = nextCost >= Number(wo.budget_cap_usd)
  return NextResponse.json({ ok: true, abort, actual_cost_usd: nextCost })
}
