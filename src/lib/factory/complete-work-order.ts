// P21.J A3 — 工单交付的多表写编排(从 complete route 抽出,魏征架构整理:route 只留鉴权/校验)。
// 红线复扫 → B 轨 scene_tag 白名单 → clip 幂等入库 → 台账 spend → 工单转 in_review。
//
// 2026-07-23:交付直接转 in_review(原先转 rendered,再由 factory-review-sweeper 推 Airtable
// 审核卡时改 in_review)。Airtable 已退役、该 sweeper 已停调度,rendered 于是成了死胡同——
// 成片永远进不了 /dashboard/factory 的审片队列。审核既然已搬进 ME 驾驶舱,中间这一站没有存在
// 意义,去掉它比再养一个 sweeper 少一个失败点。`rendered` 保留在状态枚举里,仅为历史行兼容。
// route 已做:鉴权 + worker_id 归属 + 预算硬顶 + 路径前缀校验。这里做落库副作用。

import type { SupabaseClient } from '@supabase/supabase-js'
import { FACTORY_B_TRACK_SCENE_TAGS } from './constants'
import { scanRedlineHits, validateClipPath } from './worker-guard'

const ACTIVE_STATUSES = ['claimed', 'producing']

export interface CompleteClipInput {
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

export interface CompleteParams {
  wo: Record<string, unknown>
  workerId: string
  videoPath: string
  segmentsPath: string
  srtPath: string
  caption: string
  actualCost: number
  newClips: CompleteClipInput[]
}

export type CompleteResult =
  | { ok: true; status: 'in_review'; redlineHits: string[]; newClipIds: string[] }
  | { ok: false; status: number; error: string }

export async function completeWorkOrder(
  supabase: SupabaseClient,
  p: CompleteParams,
): Promise<CompleteResult> {
  const { wo, workerId, videoPath, segmentsPath, srtPath, caption, actualCost, newClips } = p
  const clientId = wo.client_id as string
  const woId = wo.id as string

  // ② 成片级红线复扫(fail-closed:红线/brief 查询失败即拒,查不到 ≠ 没有)
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('brand_redline_phrases, factory_config')
    .eq('id', clientId)
    .maybeSingle()
  if (cErr || !client) return { ok: false, status: 500, error: 'redline lookup failed' }

  // ①b B 轨 scene_tag 白名单(护栏 6):生成式具体地标不入库,例外仅 allow_b_track_landmark_ads
  const allowLandmark =
    ((client.factory_config ?? {}) as Record<string, unknown>)['allow_b_track_landmark_ads'] === true
  if (!allowLandmark) {
    const badTag = newClips.find(
      (c) => c.track === 'b_generated' && !(FACTORY_B_TRACK_SCENE_TAGS as readonly string[]).includes(c.scene_tag),
    )
    if (badTag) {
      return { ok: false, status: 422, error: `b_generated scene_tag '${badTag.scene_tag}' not in abstract whitelist (护栏 6)` }
    }
  }

  const { data: brief, error: bErr } = await supabase
    .from('master_briefs')
    .select('excluded_topics')
    .eq('id', wo.master_brief_id as string)
    .maybeSingle()
  if (bErr) return { ok: false, status: 500, error: 'brief lookup failed' }

  const overlays = (Array.isArray((wo.brief as Record<string, unknown>)?.['segments'])
    ? ((wo.brief as Record<string, unknown>)['segments'] as Array<Record<string, unknown>>)
    : []
  ).map((s) => (typeof s['text_overlay'] === 'string' ? (s['text_overlay'] as string) : null))
  const redlineHits = scanRedlineHits(
    [caption, ...overlays],
    (client.brand_redline_phrases as string[] | null) ?? [],
    (brief?.excluded_topics as string[] | null) ?? [],
  )

  // ③ new_clips 幂等入库:idempotency_key 命中已有行 → 复用不重插
  const insertedClipIds: string[] = []
  if (newClips.length > 0) {
    const keys = newClips.map((c) => c.idempotency_key)
    const { data: existing, error: exErr } = await supabase
      .from('video_clips')
      .select('id, source_meta')
      .eq('client_id', clientId)
      .in('source_meta->>idempotency_key', keys)
    if (exErr) return { ok: false, status: 500, error: `clip idempotency check failed: ${exErr.message}` }

    const existingKeys = new Set(
      (existing ?? []).map((r) => String((r.source_meta as Record<string, unknown>)?.['idempotency_key'])),
    )
    const rows = newClips
      .filter((c) => !existingKeys.has(c.idempotency_key))
      .map((c) => ({
        client_id: clientId,
        title: c.title ?? null,
        scene_tag: c.scene_tag,
        motion_type: c.motion_type ?? null,
        duration_seconds: c.duration_seconds,
        track: c.track,
        storage_url: validateClipPath(c.storage_url, clientId, c.track) as string, // route 已全量校验过必非 null
        generation_cost_usd: c.generation_cost_usd ?? 0,
        source_meta: { ...(c.source_meta ?? {}), idempotency_key: c.idempotency_key, work_order_id: woId },
      }))
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await supabase.from('video_clips').insert(rows).select('id')
      if (insErr) return { ok: false, status: 500, error: `clip insert failed: ${insErr.message}` }
      insertedClipIds.push(...(ins ?? []).map((r) => r.id as string))
    }
  }

  // ④ 台账 spend(护栏 10 事实源)。幂等:同工单已有 spend 行则跳过(complete 重试不重记)
  if (actualCost > 0) {
    const { data: existingSpend } = await supabase
      .from('factory_balance_ledger')
      .select('id')
      .eq('work_order_id', woId)
      .eq('entry_type', 'spend')
      .limit(1)
      .maybeSingle()
    if (!existingSpend) {
      const { error: ledgerErr } = await supabase.from('factory_balance_ledger').insert({
        entry_type: 'spend',
        amount_usd: -actualCost,
        work_order_id: woId,
        note: `muapi generation spend (worker complete)`,
      })
      if (ledgerErr) return { ok: false, status: 500, error: `ledger write failed: ${ledgerErr.message}` }
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
  const { data: updated, error: upErr } = await supabase
    .from('content_work_orders')
    .update({
      status: 'in_review',
      actual_cost_usd: Math.max(Number(wo.actual_cost_usd), actualCost),
      output,
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', woId)
    .eq('claimed_by', workerId)
    .in('status', ACTIVE_STATUSES)
    .select('id')
  if (upErr) return { ok: false, status: 500, error: upErr.message }
  if (!updated || updated.length === 0) {
    console.error(`[factory worker] complete race: work order ${woId} reclaimed mid-flight (clips/ledger already written)`)
    return { ok: false, status: 409, error: 'work order reclaimed mid-flight' }
  }

  return { ok: true, status: 'in_review', redlineHits, newClipIds: insertedClipIds }
}
