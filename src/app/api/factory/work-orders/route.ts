// P21.J M2 — GET /api/factory/work-orders(spec §6.1 Factory Ops 后台可视 + dead_letter 面板数据源)
// 返回近 100 条工单(按 created_at desc),供 Factory Ops 页分组展示 + dead_letter 复活。仅 admin。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select(
      'id, client_id, status, order_type, angle, rationale_one_liner, actual_cost_usd, budget_cap_usd, ' +
        'attempt_count, reclaim_count, reject_reason, source_ad_id, review_ref, output, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const clientIds = [...new Set((data ?? []).map((w) => w.client_id))]
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name as string]))

  const orders = (data ?? []).map((w) => ({ ...w, client_name: nameById.get(w.client_id) ?? w.client_id }))
  return NextResponse.json({ orders })
}
