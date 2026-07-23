// P21.J M2 — POST /api/factory/worker/[id]/complete(spec §6.1)
// 交付闸(审核流/素材库注入面的正门):
//   ①三件套路径前缀强校验 + new_clips 路径/track 一致性(魏征 F9)—— 任意外部 URL 一律拒
//   ②成片级红线复扫 caption + text_overlay(板桥 #7)—— 命中不打回,写 output.redline_hits 标红
//   ③new_clips 按 idempotency_key 幂等入 video_clips(重试不重插)
//   ④actual_cost_usd 落 factory_balance_ledger spend(台账 = 护栏 10 事实源)
// 通过 → in_review(直接进 /dashboard/factory 审片队列;2026-07-23 起不再中转 rendered,详见 lib 头注)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { completeWorkOrder } from '@/lib/factory/complete-work-order'
import {
  isWorkerAuthorized,
  validateClipPath,
  validateRenderPath,
  workerIdFromBody,
} from '@/lib/factory/worker-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACTIVE_STATUSES = ['claimed', 'producing']

interface NewClipInput {
  storage_url: string
  track: string
  scene_tag: string
  duration_seconds: number
  idempotency_key: string
  motion_type?: string
  title?: string
  generation_cost_usd?: number
  source_meta?: Record<string, unknown>
}

function parseNewClips(raw: unknown): NewClipInput[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const out: NewClipInput[] = []
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) return null
    const clip = c as Record<string, unknown>
    if (
      typeof clip.storage_url !== 'string' ||
      typeof clip.track !== 'string' ||
      typeof clip.scene_tag !== 'string' ||
      typeof clip.idempotency_key !== 'string' ||
      typeof clip.duration_seconds !== 'number'
    ) return null
    out.push(clip as unknown as NewClipInput)
  }
  return out
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isWorkerAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const caption = typeof body.caption === 'string' ? body.caption : ''
  const actualCost = typeof body.actual_cost_usd === 'number' && Number.isFinite(body.actual_cost_usd)
    ? Math.max(0, body.actual_cost_usd)
    : null
  if (actualCost === null) {
    return NextResponse.json({ error: 'actual_cost_usd (number) required' }, { status: 400 })
  }
  const newClips = parseNewClips(body.new_clips)
  if (newClips === null) {
    return NextResponse.json({ error: 'new_clips malformed' }, { status: 400 })
  }
  // 归属校验(魏征 M2-P1-1)
  const workerId = workerIdFromBody(body)
  if (!workerId) {
    return NextResponse.json({ error: 'worker_id required' }, { status: 400 })
  }

  const { data: wo, error: loadErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, client_id, master_brief_id, status, brief, budget_cap_usd, actual_cost_usd, output, claimed_by')
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
  if (wo.claimed_by !== workerId) {
    return NextResponse.json(
      { error: `work order claimed by another worker (${wo.claimed_by ?? 'none'})` },
      { status: 409 },
    )
  }

  // ⓪ 服务端预扣硬顶(魏征 M2-P1-3):complete 是唯一可信边界,worker 本地 check 只是第一道
  const briefObj = (wo.brief ?? {}) as Record<string, unknown>
  const maxNewClips = typeof briefObj['max_new_clips'] === 'number' ? briefObj['max_new_clips'] : 0
  if (newClips.length > maxNewClips) {
    return NextResponse.json(
      { error: `new_clips (${newClips.length}) exceeds max_new_clips (${maxNewClips})` },
      { status: 422 },
    )
  }
  // 自报成本超预算 1.5 倍容差 → 拒收,防台账事实源被单次污染打穿停机线(护栏 10)
  if (actualCost > Number(wo.budget_cap_usd) * 1.5) {
    console.error(`[factory worker] work order ${id} cost overrun rejected: $${actualCost} > cap $${wo.budget_cap_usd} ×1.5`)
    return NextResponse.json(
      { error: `actual_cost_usd ($${actualCost}) exceeds budget_cap_usd ($${wo.budget_cap_usd}) tolerance` },
      { status: 422 },
    )
  }

  // ① F9 前缀强校验:三件套 + new_clips,任何一条不合法整单拒(fail-closed)
  const videoPath = validateRenderPath(String(body.video_url ?? ''), wo.client_id, wo.id)
  const segmentsPath = validateRenderPath(String(body.segments_json_url ?? ''), wo.client_id, wo.id)
  const srtPath = validateRenderPath(String(body.srt_url ?? ''), wo.client_id, wo.id)
  if (!videoPath || !segmentsPath || !srtPath) {
    return NextResponse.json(
      { error: 'render urls must be bucket paths under renders/{client_id}/{work_order_id}/' },
      { status: 422 },
    )
  }
  for (let i = 0; i < newClips.length; i++) {
    if (!validateClipPath(newClips[i].storage_url, wo.client_id, newClips[i].track)) {
      return NextResponse.json(
        { error: `new_clips[${i}] path/track invalid: ${newClips[i].storage_url}` },
        { status: 422 },
      )
    }
  }

  // ②–④ 多表写编排(红线复扫 + B轨白名单 + clip 幂等入库 + 台账 + 工单转 in_review)抽到 lib(A3)
  const result = await completeWorkOrder(supabaseAdmin, {
    wo,
    workerId,
    videoPath,
    segmentsPath,
    srtPath,
    caption,
    actualCost,
    newClips,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ok: true,
    status: result.status,
    redline_hits: result.redlineHits,
    new_clip_ids: result.newClipIds,
  })
}
