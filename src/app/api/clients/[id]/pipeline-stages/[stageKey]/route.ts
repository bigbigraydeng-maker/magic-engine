/**
 * DELETE /api/clients/[id]/pipeline-stages/[stageKey]
 *
 * 删一个阶段,带守卫:
 *   · 删最后一档 → 400(至少留一档)。
 *   · 该档还有客人:
 *       body 给了 reassignTo → 先把这批客人整批改派过去,再删(板桥「改派并删除」)。
 *       没给 → 409 { count } —— 前端据此弹出改派下拉,不做死胡同提示。
 *   · 空档 → 直接删。
 *
 * TOCTOU 说明:count 与 delete 之间理论上有并发把客人移进本档的窗口。改派后
 * 会「再数一次」,仍>0 就不删(返 409);且 today / 配置页对未知 stage_key 有 label
 * fallback。配置是单人 admin 动作、并发极低,这一层足够,不为此上 RPC / 新 migration。
 *
 * Body(可选): { reassignTo }
 * Responses: 200 { deleted, reassigned } / 400 / 401 / 403 / 404 / 409 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

async function countAtStage(clientId: string, stageKey: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('stage', stageKey)
  return count ?? 0
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; stageKey: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const stageKey = params.stageKey

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // body 可选(纯删空档时无 body)。
  let reassignTo: string | null = null
  try {
    const body = (await req.json()) as { reassignTo?: unknown }
    if (typeof body?.reassignTo === 'string' && body.reassignTo.trim()) {
      reassignTo = body.reassignTo.trim()
    }
  } catch {
    // 无 body / 非 JSON:当作纯删除。
  }

  // 目标阶段必须属于本客户。
  const { data: stageRow, error: sErr } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
    .eq('stage_key', stageKey)
    .maybeSingle()
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 })
  }
  if (!stageRow) {
    return NextResponse.json({ error: '这个阶段不存在' }, { status: 404 })
  }

  // 至少留一档。
  const { count: totalStages } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if ((totalStages ?? 0) <= 1) {
    return NextResponse.json({ error: '至少要保留一个阶段' }, { status: 400 })
  }

  let reassigned = 0
  const count = await countAtStage(clientId, stageKey)

  if (count > 0) {
    if (!reassignTo) {
      return NextResponse.json(
        { error: '这一档还有客人', reason: 'not_empty', count },
        { status: 409 },
      )
    }
    if (reassignTo === stageKey) {
      return NextResponse.json({ error: '不能改派到自己' }, { status: 400 })
    }
    // 改派目标也必须属于本客户。
    const { data: target } = await supabaseAdmin
      .from('client_pipeline_stages')
      .select('stage_key')
      .eq('client_id', clientId)
      .eq('stage_key', reassignTo)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: '改派的目标阶段不存在' }, { status: 400 })
    }

    // 整批改派(config 级动作,不逐条写 stage_event —— 那是销售级操作)。
    const nowIso = new Date().toISOString()
    const { error: mvErr } = await supabaseAdmin
      .from('contacts')
      .update({ stage: reassignTo, stage_updated_at: nowIso, updated_at: nowIso })
      .eq('client_id', clientId)
      .eq('stage', stageKey)
    if (mvErr) {
      return NextResponse.json({ error: `改派失败: ${mvErr.message}` }, { status: 500 })
    }
    reassigned = count

    // 再数一次:并发若又有人移进来,不删(返 409),避免删出悬空 stage。
    const recount = await countAtStage(clientId, stageKey)
    if (recount > 0) {
      return NextResponse.json(
        { error: '这一档又进了新客人，请重试', reason: 'not_empty', count: recount },
        { status: 409 },
      )
    }
  }

  const { error: delErr } = await supabaseAdmin
    .from('client_pipeline_stages')
    .delete()
    .eq('client_id', clientId)
    .eq('stage_key', stageKey)
  if (delErr) {
    return NextResponse.json({ error: `删除失败: ${delErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ deleted: true, reassigned })
}
