/**
 * Reputation monitoring identities — single write entry for
 * clients.{gbp_place_id, tripadvisor_keyword, competitor_gbp}.
 *
 * GET   → current values.
 * PATCH → replaces the provided fields (partial update).
 *
 * 口碑监测（DataForSEO 计划 阶段 2）的配置入口：客户自己的 GBP place_id、
 * Tripadvisor 搜索词（旅游类）、竞品 GBP 身份列表。每周 cron 只对配了
 * 身份的客户花钱 —— 这里是运营改配置的唯一入口（强约束：不碰数据库）。
 *
 * Mirrors src/app/api/clients/[id]/industry/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { parseCompetitorGbp } from '@/lib/reputation/snapshots'

interface PatchBody {
  gbp_place_id?: unknown
  tripadvisor_keyword?: unknown
  competitor_gbp?: unknown
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('gbp_place_id, tripadvisor_keyword, competitor_gbp')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const row = data as {
    gbp_place_id: string | null
    tripadvisor_keyword: string | null
    competitor_gbp: unknown
  }

  return NextResponse.json({
    gbp_place_id: row.gbp_place_id,
    tripadvisor_keyword: row.tripadvisor_keyword,
    competitor_gbp: parseCompetitorGbp(row.competitor_gbp),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // 口碑身份是花钱配置（竞品列表直接放大每周 API 成本），
  // 与 client-status 同款收紧：客户侧账号只读不写
  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}

  if ('gbp_place_id' in body) {
    const raw = body.gbp_place_id
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: '`gbp_place_id` must be string | null' }, { status: 400 })
    }
    patch.gbp_place_id = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }

  if ('tripadvisor_keyword' in body) {
    const raw = body.tripadvisor_keyword
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: '`tripadvisor_keyword` must be string | null' }, { status: 400 })
    }
    patch.tripadvisor_keyword = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }

  if ('competitor_gbp' in body) {
    if (!Array.isArray(body.competitor_gbp)) {
      return NextResponse.json(
        { error: '`competitor_gbp` must be an array of {name, place_id}' },
        { status: 400 },
      )
    }
    // 写入侧就只收合法条目 —— 不让垃圾形状进库再到处兼容
    const parsed = parseCompetitorGbp(body.competitor_gbp)
    if (parsed.length !== body.competitor_gbp.length) {
      return NextResponse.json(
        { error: 'Every competitor_gbp entry needs non-empty `name` and `place_id`' },
        { status: 400 },
      )
    }
    // 成本上限：竞品条数封顶（spec 预算按全网 43 竞品算，单客户 10 家足够）
    if (parsed.length > 10) {
      return NextResponse.json(
        { error: 'At most 10 competitor GBP entries per client' },
        { status: 400 },
      )
    }
    patch.competitor_gbp = parsed.map(e => ({ name: e.name.trim(), place_id: e.place_id.trim() }))
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No recognised fields in body' }, { status: 400 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update(patch)
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update reputation identity: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, ...patch })
}
