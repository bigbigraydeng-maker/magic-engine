// P21.J M2 — POST /api/factory/worker/[id]/complete(spec §6.1)
// 交付闸(审核流/素材库注入面的正门):
//   ①三件套路径前缀强校验 + new_clips 路径/track 一致性(魏征 F9)—— 任意外部 URL 一律拒
//   ②成片级红线复扫 caption + text_overlay(板桥 #7)—— 命中不打回,写 output.redline_hits 标红
//   ③new_clips 按 idempotency_key 幂等入 video_clips(重试不重插)
//   ④actual_cost_usd 落 factory_balance_ledger spend(台账 = 护栏 10 事实源)
// 通过 → rendered(sweeper 推 Airtable 审核卡后转 in_review,§7.2)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_B_TRACK_SCENE_TAGS } from '@/lib/factory/constants'
import {
  isWorkerAuthorized,
  scanRedlineHits,
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
  const clipPaths: string[] = []
  for (const clip of newClips) {
    const p = validateClipPath(clip.storage_url, wo.client_id, clip.track)
    if (!p) {
      return NextResponse.json(
        { error: `new_clips[${clipPaths.length}] path/track invalid: ${clip.storage_url}` },
        { status: 422 },
      )
    }
    clipPaths.push(p)
  }

  // ② 成片级红线复扫(fail-closed:红线/brief 查询失败即拒,查不到 ≠ 没有)
  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('brand_redline_phrases, factory_config')
    .eq('id', wo.client_id)
    .maybeSingle()
  if (cErr || !client) {
    return NextResponse.json({ error: 'redline lookup failed' }, { status: 500 })
  }

  // ①b B 轨 scene_tag 白名单(魏征 M2-P1-2,护栏 6/板桥 #8):生成式具体地标不入库,
  // 例外仅 clients.factory_config.allow_b_track_landmark_ads(附录 A: CTS PM 显式接受)
  const allowLandmark =
    ((client.factory_config ?? {}) as Record<string, unknown>)['allow_b_track_landmark_ads'] === true
  if (!allowLandmark) {
    const badTag = newClips.find(
      (c) => c.track === 'b_generated' && !(FACTORY_B_TRACK_SCENE_TAGS as readonly string[]).includes(c.scene_tag),
    )
    if (badTag) {
      return NextResponse.json(
        { error: `b_generated scene_tag '${badTag.scene_tag}' not in abstract whitelist (护栏 6)` },
        { status: 422 },
      )
    }
  }
  const { data: brief, error: bErr } = await supabaseAdmin
    .from('master_briefs')
    .select('excluded_topics')
    .eq('id', wo.master_brief_id)
    .maybeSingle()
  if (bErr) {
    return NextResponse.json({ error: 'brief lookup failed' }, { status: 500 })
  }
  const overlays = (Array.isArray((wo.brief as Record<string, unknown>)?.['segments'])
    ? ((wo.brief as Record<string, unknown>)['segments'] as Array<Record<string, unknown>>)
    : []
  ).map((s) => (typeof s['text_overlay'] === 'string' ? (s['text_overlay'] as string) : null))
  const redlineHits = scanRedlineHits(
    [caption, ...overlays],
    (client.brand_redline_phrases as string[] | null) ?? [],
    (brief?.excluded_topics as string[] | null) ?? [],
  )

  // ③ new_clips 幂等入库:idempotency_key 命中已有行 → 复用不重插(魏征 F10③)
  const insertedClipIds: string[] = []
  if (newClips.length > 0) {
    const keys = newClips.map((c) => c.idempotency_key)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('video_clips')
      .select('id, source_meta')
      .eq('client_id', wo.client_id)
      .in('source_meta->>idempotency_key', keys)
    if (exErr) {
      return NextResponse.json({ error: `clip idempotency check failed: ${exErr.message}` }, { status: 500 })
    }
    const existingKeys = new Set(
      (existing ?? []).map((r) => String((r.source_meta as Record<string, unknown>)?.['idempotency_key'])),
    )
    const rows = newClips
      .filter((c) => !existingKeys.has(c.idempotency_key))
      .map((c) => ({
        client_id: wo.client_id,
        title: c.title ?? null,
        scene_tag: c.scene_tag,
        motion_type: c.motion_type ?? null,
        duration_seconds: c.duration_seconds,
        track: c.track,
        // 前面已全量校验过,此处必非 null(死代码 fallback 已删,魏征 M2-P2-2)
        storage_url: validateClipPath(c.storage_url, wo.client_id, c.track) as string,
        generation_cost_usd: c.generation_cost_usd ?? 0,
        source_meta: {
          ...(c.source_meta ?? {}),
          idempotency_key: c.idempotency_key,
          work_order_id: wo.id,
        },
      }))
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('video_clips')
        .insert(rows)
        .select('id')
      if (insErr) {
        return NextResponse.json({ error: `clip insert failed: ${insErr.message}` }, { status: 500 })
      }
      insertedClipIds.push(...(ins ?? []).map((r) => r.id as string))
    }
  }

  // ④ 台账 spend(护栏 10 事实源)。幂等:同工单已有 spend 行则跳过(complete 重试不重记)
  if (actualCost > 0) {
    const { data: existingSpend } = await supabaseAdmin
      .from('factory_balance_ledger')
      .select('id')
      .eq('work_order_id', wo.id)
      .eq('entry_type', 'spend')
      .limit(1)
      .maybeSingle()
    if (!existingSpend) {
      const { error: ledgerErr } = await supabaseAdmin.from('factory_balance_ledger').insert({
        entry_type: 'spend',
        amount_usd: -actualCost,
        work_order_id: wo.id,
        note: `muapi generation spend (worker complete)`,
      })
      if (ledgerErr) {
        return NextResponse.json({ error: `ledger write failed: ${ledgerErr.message}` }, { status: 500 })
      }
    }
  }

  const output = {
    ...((wo.output as Record<string, unknown>) ?? {}),
    video_path: videoPath,
    segments_json_path: segmentsPath,
    srt_path: srtPath,
    caption,
    redline_hits: redlineHits,
    new_clip_ids: insertedClipIds,
  }

  // .select() 判行数:load 后被 sweeper 收回时 0 行匹配不能伪装成功(魏征 M2-P1-1)
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'rendered',
      actual_cost_usd: Math.max(Number(wo.actual_cost_usd), actualCost),
      output,
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('claimed_by', workerId)
    .in('status', ACTIVE_STATUSES)
    .select('id')
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    console.error(`[factory worker] complete race: work order ${id} reclaimed mid-flight (clips/ledger already written)`)
    return NextResponse.json({ error: 'work order reclaimed mid-flight' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    status: 'rendered',
    redline_hits: redlineHits,
    new_clip_ids: insertedClipIds,
  })
}
