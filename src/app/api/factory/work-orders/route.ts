// P21.J M2 — GET /api/factory/work-orders(spec §6.1 Factory Ops 后台可视 + dead_letter 面板数据源)
// 返回近 100 条工单(按 created_at desc),供 Factory Ops 页分组展示 + dead_letter 复活。仅 admin。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { matchAcceptedFlags, type AcceptanceRow } from '@/lib/factory/review-accept-flag'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    // 单个字面量(不能用 + 拼接):Supabase 客户端靠字面量类型解析列名,拼接后变成 string 就推不出行类型
    .select(
      'id, client_id, status, order_type, angle, rationale_one_liner, actual_cost_usd, budget_cap_usd, attempt_count, reclaim_count, reject_reason, source_ad_id, review_ref, output, published_ref, heartbeat_at, created_at, updated_at, fact_source_url:brief->copy->endcard->>url, brief_brand_name:brief->>brand_name, brief_persona:brief->brand_voice->persona',
    )
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // worker 活性:生产中工单的最新心跳(魏征:worker 挂了 UI 别一片"生产中"假象)
  const active = (data ?? []).filter((w) => w.status === 'claimed' || w.status === 'producing')
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

  // 已接受的 flag:按 client 一次性拉取,再按 brief 指纹匹配到每条工单。
  // 查询失败时不要假装没有:把错误透传给 UI。
  const { data: acceptanceRows, error: acceptancesErr } = await supabaseAdmin
    .from('factory_review_flag_acceptances')
    .select('client_id, category, brief_fingerprint, accepted_by, accepted_at')
    .in('client_id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
    .order('accepted_at', { ascending: false })
  const acceptancesError = acceptancesErr ? acceptancesErr.message : null
  const acceptances: AcceptanceRow[] = acceptancesError ? [] : ((acceptanceRows ?? []) as AcceptanceRow[])

  const orders = (data ?? []).map(({ published_ref, brief_brand_name, brief_persona, ...w }) => ({
    ...w,
    client_name: nameById.get(w.client_id) ?? w.client_id,
    published: toPublishedView(published_ref),
    accepted_flags: acceptancesError
      ? []
      : matchAcceptedFlags(acceptances, {
          client_id: w.client_id,
          brief: { brand_name: brief_brand_name, brand_voice: { persona: brief_persona } },
        }),
  }))
  return NextResponse.json({
    orders,
    worker: { last_heartbeat_at: lastHeartbeat, active_count: active.length },
    accepted_flags_error: acceptancesError,
  })
}
