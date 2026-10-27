// P21.J M2 — GET /api/factory/work-orders(spec §6.1 Factory Ops 后台可视 + dead_letter 面板数据源)
// The video factory inbox returns only orders awaiting human review. Other statuses stay in the work-order record for history, but are not active inbox items.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope } from '@/lib/auth/require-admin'
import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { engineStaleNotice } from '@/lib/factory/engine-catalog.mjs'

export const dynamic = 'force-dynamic'

export async function GET(req?: Request) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  if (req && new URL(req.url).searchParams.get('view') === 'recovery') {
    if (admin.scope.kind !== 'global') {
      return NextResponse.json({ error: 'Forbidden — recovery tools are for internal staff only' }, { status: 403 })
    }
    const { data, error } = await supabaseAdmin
      .from('content_work_orders')
      .select('id, client_id, status, order_type, angle, rationale_one_liner, attempt_count, reclaim_count, reject_reason, created_at, updated_at, recipe_replan_required:brief->>recipe_replan_required')
      .eq('status', 'dead_letter')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const clientIds = [...new Set((data ?? []).map((w) => w.client_id))]
    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
    const nameById = new Map((clients ?? []).map((c) => [c.id, c.name as string]))
    return NextResponse.json({
      orders: (data ?? []).map((w) => ({ ...w, client_name: nameById.get(w.client_id) ?? w.client_id })),
    })
  }

  const base = supabaseAdmin
    .from('content_work_orders')
    // 单个字面量(不能用 + 拼接):Supabase 客户端靠字面量类型解析列名,拼接后变成 string 就推不出行类型
    .select(
      'id, client_id, status, order_type, angle, rationale_one_liner, actual_cost_usd, budget_cap_usd, attempt_count, reclaim_count, reject_reason, source_ad_id, review_ref, output, published_ref, heartbeat_at, created_at, updated_at, fact_source_url:brief->copy->endcard->>url, deliverable:brief->remotion->>deliverable, template_id:brief->remotion->>template, music_file:brief->remotion->props->>musicFile, card_zone:brief->remotion->props->>cardZone, layout_override:brief->remotion->props->>layoutOverride',
    )
  const pending = base.eq('status', 'in_review')
  const scoped = admin.scope.kind === 'global' ? pending : pending.eq('client_id', admin.scope.clientId)
  const { data, error } = await scoped.order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep the worker heartbeat independent of the review-only inbox query.
  const activeBase = supabaseAdmin
    .from('content_work_orders')
    .select('client_id, heartbeat_at, status')
    .in('status', ['claimed', 'producing'])
  const activeScoped = admin.scope.kind === 'global'
    ? activeBase
    : activeBase.eq('client_id', admin.scope.clientId)
  const { data: activeData } = await activeScoped
  const active = activeData ?? []
  const lastHeartbeat = active
    .map((w) => w.heartbeat_at as string | null)
    .filter(Boolean)
    .sort()
    .pop() ?? null

  const clientIds = [...new Set((data ?? []).map((w) => w.client_id))]
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name as string]))

  let engineNotice: string | null = null
  const { data: aliveRows } = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', 'factory-worker-alive')
    .limit(20)
  engineNotice = engineStaleNotice(
    (aliveRows ?? []).map((row) => ({ summary: row.summary as { client_ids?: string[] | null; engine_stale?: boolean; engine_notice?: string } | null })),
    admin.scope.kind === 'global' ? undefined : admin.scope.clientId,
  )

  const orders = (data ?? []).map(({ published_ref, ...w }) => ({
    ...w,
    client_name: nameById.get(w.client_id) ?? w.client_id,
    published: toPublishedView(published_ref),
  }))
  return NextResponse.json({
    orders,
    worker: { last_heartbeat_at: lastHeartbeat, active_count: active.length, engine_notice: engineNotice },
  })
}
