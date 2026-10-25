// P21.J A3 — 工单交付的多表写编排(从 complete route 抽出,魏征架构整理:route 只留鉴权/校验)。
// 红线复扫 → B 轨 scene_tag 白名单 → clip 幂等入库 → 台账 spend → 工单转 in_review。
//
// 2026-07-23:交付直接转 in_review(原先转 rendered,再由 factory-review-sweeper 推 Airtable
// 审核卡时改 in_review)。Airtable 已退役、该 sweeper 已停调度,rendered 于是成了死胡同——
// 成片永远进不了 /dashboard/factory 的审片队列。审核既然已搬进 ME 驾驶舱,中间这一站没有存在
// 意义,去掉它比再养一个 sweeper 少一个失败点。`rendered` 保留在状态枚举里,仅为历史行兼容。
// route 已做:鉴权 + worker_id 归属 + 预算硬顶 + 路径前缀校验。这里做落库副作用。

import type { SupabaseClient } from '@supabase/supabase-js'
import { FACTORY_B_TRACK_SCENE_TAGS, FACTORY_CLIENT_DERIVED_SCENE_TAG } from './constants'
import { scanContentQualityFlags, type QualityFlag } from './content-quality-guard'
import { scanRedlineHits, validateClipPath } from './worker-guard'
import { assertRecipeReceipt, winnerRecipeFromBrief, type WinnerRecipe } from './recipe'
import { buildReelPostCaption, buildReelPublishAutoChecks } from '@/lib/social/reel-publishing'
import { buildReelMediaAutoChecks, type ReelMediaEvidence } from '@/lib/social/reel-media-checks'
import { assessRemotionContentSubstance } from './content-substance'

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
  /** blocker 1:recipe 单必须携带 executed receipt;legacy 单可 undefined。 */
  recipeReceipt?: unknown
  mediaEvidence?: ReelMediaEvidence | null
}

/**
 * blocker 1:server-side recipe complete gate。
 * - brief 无 creative_recipe → 保留 legacy 分支,无需 receipt
 * - brief 有 creative_recipe → 必须携带 receipt,且必须通过 shared assertRecipeReceipt
 * - new_clips 数量必须等于 recipe.segments 数
 * - receipt.recipe.id/version 必须匹配 brief.creative_recipe
 * - receipt.segments[i].source_image_url 必须等于 brief.clip_generation_plan[i].source_image_url
 * - new_clips[i].source_meta.recipe 必须携带 recipe.id;source_meta.request_id 必须与 receipt provider 对齐
 */
function assertRecipeCompletion(
  wo: Record<string, unknown>,
  newClips: CompleteClipInput[],
  recipeReceipt: unknown,
): { ok: true } | { ok: false; error: string } {
  const briefObj = (wo.brief ?? {}) as Record<string, unknown>
  // 已打回、等待显式 replan 的壳单绝不能被旧 worker 当 legacy 完成。
  if (briefObj.recipe_replan_required === true) {
    return {
      ok: false,
      error: 'recipe replan required: work order cannot complete until server writes a full acknowledged recipe plan',
    }
  }
  let recipe: WinnerRecipe | null
  try {
    recipe = winnerRecipeFromBrief(wo.brief)
  } catch (e) {
    return { ok: false, error: `brief.creative_recipe malformed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!recipe) return { ok: true } // legacy
  if (recipeReceipt == null || typeof recipeReceipt !== 'object') {
    return { ok: false, error: 'recipe_receipt required for recipe work orders (legacy worker payload rejected)' }
  }
  try {
    assertRecipeReceipt(recipeReceipt, recipe)
  } catch (e) {
    return { ok: false, error: `recipe_receipt validation failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (newClips.length !== recipe.segments.length) {
    return {
      ok: false,
      error: `new_clips count ${newClips.length} != recipe.segments ${recipe.segments.length}`,
    }
  }
  const plan = Array.isArray(briefObj.clip_generation_plan)
    ? (briefObj.clip_generation_plan as Array<Record<string, unknown>>)
    : []
  const rec = recipeReceipt as { segments?: Array<Record<string, unknown>> }
  const segs = Array.isArray(rec.segments) ? rec.segments : []
  for (let i = 0; i < segs.length; i++) {
    const expectedSource = plan[i]?.source_image_url
    if (segs[i]?.source_image_url !== expectedSource) {
      return { ok: false, error: `recipe_receipt.segments[${i}].source_image_url != brief plan[${i}] source (${String(expectedSource)})` }
    }
  }
  for (let i = 0; i < newClips.length; i++) {
    const m = (newClips[i].source_meta ?? {}) as Record<string, unknown>
    if (m.recipe !== recipe.id) {
      return { ok: false, error: `new_clips[${i}].source_meta.recipe missing/mismatch (want "${recipe.id}", got "${String(m.recipe)}")` }
    }
    const segProv = segs[i]?.provider as { request_id?: unknown } | undefined
    if (segProv?.request_id !== m.request_id) {
      return {
        ok: false,
        error: `new_clips[${i}].source_meta.request_id "${String(m.request_id)}" != receipt.segments[${i}].provider.request_id "${String(segProv?.request_id)}"`,
      }
    }
  }
  return { ok: true }
}

export type CompleteResult =
  | { ok: true; status: 'in_review'; redlineHits: string[]; qualityFlags: QualityFlag[]; newClipIds: string[] }
  | { ok: false; status: number; error: string }

export async function completeWorkOrder(
  supabase: SupabaseClient,
  p: CompleteParams,
): Promise<CompleteResult> {
  const { wo, workerId, videoPath, segmentsPath, srtPath, caption, actualCost, newClips, recipeReceipt, mediaEvidence } = p
  const clientId = wo.client_id as string
  const woId = wo.id as string

  // blocker 1:recipe brief 必须携带并通过 shared receipt validator（防旧 worker 只报路径就 in_review）
  const recipeGate = assertRecipeCompletion(wo, newClips, recipeReceipt)
  if (!recipeGate.ok) return { ok: false, status: 422, error: recipeGate.error }

  // 内容实质闸（服务端复核）：用工单自己的 props 重算，不信出片机自报的结论。默认只告警+留审计，
  // FACTORY_CONTENT_SUBSTANCE_ENFORCE=1 后：缺内容或缺 capability 一律 422（在任何库写入之前）。
  const substance = assessRemotionContentSubstance(wo.brief, mediaEvidence)
  const enforceSubstance = process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE === '1'
  if (substance.applicable) {
    if (enforceSubstance && !substance.assetOnly && substance.server?.verdict !== 'pass') {
      return { ok: false, status: 422, error: `content_substance_failed: ${substance.server?.reason ?? ''}`.slice(0, 300) }
    }
    if (enforceSubstance && !substance.capable) {
      return { ok: false, status: 422, error: 'content_substance_missing' }
    }
    if ((!substance.assetOnly && substance.server?.verdict !== 'pass') || substance.mismatch || !substance.capable) {
      console.warn(`[factory worker] content substance warning for ${String(wo.id)}: server=${substance.server?.verdict} reported=${substance.reported?.verdict ?? 'none'} capable=${substance.capable} mismatch=${substance.mismatch} enforce=${enforceSubstance}`)
    }
  }

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
    // 客户自己照片衍生的片段另算一类:护栏 6 防的是「AI 编造具体地标」,
    // 而这类画面拍的就是客户真实的东西,不适用。见 constants 里那条注释。
    const allowedBTags = [
      ...(FACTORY_B_TRACK_SCENE_TAGS as readonly string[]),
      FACTORY_CLIENT_DERIVED_SCENE_TAG,
    ]
    const badTag = newClips.find(
      (c) => c.track === 'b_generated' && !allowedBTags.includes(c.scene_tag),
    )
    if (badTag) {
      return { ok: false, status: 422, error: `b_generated scene_tag '${badTag.scene_tag}' not in abstract whitelist (护栏 6)` }
    }
  }

  // brand_name 供下面的成片文案品控用(竞品角度检测)——同一条查询多选一列,不增加往返。
  const { data: brief, error: bErr } = await supabase
    .from('master_briefs')
    .select('excluded_topics, brand_name')
    .eq('id', wo.master_brief_id as string)
    .maybeSingle()
  if (bErr) return { ok: false, status: 500, error: 'brief lookup failed' }

  const briefRecord = (wo.brief as Record<string, unknown>) ?? {}
  const segmentsArr = Array.isArray(briefRecord['segments'])
    ? (briefRecord['segments'] as Array<Record<string, unknown>>)
    : []
  const overlaysFromBrief = segmentsArr.map((s) => (typeof s['text_overlay'] === 'string' ? (s['text_overlay'] as string) : null))
  // legacy(非 recipe)单的逐段字幕实际写在 brief.copy.segments[].{title_sub,caption,title_main}
  // (worker.mjs resolveCopy/buildSrt 同一取法)——brief.segments[].text_overlay 从未被任何调用方
  // 写入过。漏收 copy.segments 会导致 findRepeatedCaption 只拿到 worker 拼好的单条聚合 caption
  // 字符串,永远测不出真实的跨段字幕重复(2026-09-20 codex review round 2)。
  const copySegmentsArr = Array.isArray((briefRecord['copy'] as Record<string, unknown> | undefined)?.['segments'])
    ? (((briefRecord['copy'] as Record<string, unknown>)['segments']) as Array<Record<string, unknown>>)
    : []
  // worker.mjs 用的是 `title_sub || caption || title_main`(buildSrt / caption 拼接同一取法)——
  // 空字符串跟 null/undefined 一样要跳到下一个字段。用 `??` 会在 title_sub==='' 时停在那里,
  // 把这一段错记成 null,漏掉 worker 实际渲染并提交的 caption 内容(2026-09-20 codex review round 3)。
  const overlaysFromCopy = copySegmentsArr.map((s) => {
    const candidates = [s['title_sub'], s['caption'], s['title_main']]
    const text = candidates.find((v) => typeof v === 'string' && v.trim().length > 0)
    return typeof text === 'string' ? text : null
  })
  // recipe(multicut)单不把字幕写进 brief.segments.text_overlay —— 实际渲染的字幕(含 hook 之外的
  // middle 段)只存在于已经过 assertRecipeReceipt 校验的 recipeReceipt.segments[].caption 里,
  // 漏收会导致品控完全扫不到这些段(2026-09-20 codex review)。
  const receiptSegments =
    recipeReceipt != null && typeof recipeReceipt === 'object' && Array.isArray((recipeReceipt as { segments?: unknown }).segments)
      ? ((recipeReceipt as { segments: Array<Record<string, unknown>> }).segments)
      : []
  const overlaysFromReceipt = receiptSegments.map((s) => (typeof s['caption'] === 'string' ? (s['caption'] as string) : null))
  // 三路结构化逐段来源合流:brief.segments.text_overlay(历史保留,当前无写入方)/
  // brief.copy.segments(legacy worker 真正落的地方)/ recipe receipt segments。
  // `caption` 单独作为 worker 拼好的聚合串继续保留在下面的 [caption, ...overlays] 里,
  // 不并入 overlays 本身——否则聚合串会跟其中某一段重复计数,污染逐段重复检测。
  const overlays = [...overlaysFromBrief, ...overlaysFromCopy, ...overlaysFromReceipt]
  const redlineHits = scanRedlineHits(
    [caption, ...overlays],
    (client.brand_redline_phrases as string[] | null) ?? [],
    (brief?.excluded_topics as string[] | null) ?? [],
  )

  // 成片文案品控(2026-09-20 Jev 评估):静态红线短语查不出的语义类缺陷 ——
  // 竞品品牌当角度 / 内部分类标签冒充字幕 / 人称口吻不符简报。命中不打回,
  // 标记随 redline_hits 一起进 output,ReviewInbox 标红转人工(同一套口径)。
  // scanContentQualityFlags 内部已吞掉所有异常(Jev 网络/超时不允许拖垮这条主链路)。
  const hookSegment = segmentsArr.find((s) => s['role'] === 'hook')
  const receiptHookSegment = receiptSegments.find((s) => s['role'] === 'hook')
  const onScreenHook =
    (typeof hookSegment?.['text_overlay'] === 'string' ? (hookSegment['text_overlay'] as string) : null) ??
    (typeof receiptHookSegment?.['caption'] === 'string' ? (receiptHookSegment['caption'] as string) : null) ??
    overlays.find((o): o is string => !!o) ??
    null
  const brandNameForGuard = (brief?.brand_name as string | undefined) ?? ''
  const qualityFlags = await scanContentQualityFlags({
    brandName: brandNameForGuard,
    angleLabel: typeof wo.angle === 'string' ? (wo.angle as string) : null,
    onScreenHook,
    captions: [caption, ...overlays].filter((t): t is string => !!t),
  })

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
    quality_flags: qualityFlags,
    // Media results are collected by the authenticated rendering worker and
    // interpreted here at the server boundary. Missing probe values fail closed.
    quality_checklist_auto: [
      ...buildReelMediaAutoChecks(mediaEvidence),
      ...buildReelPublishAutoChecks({
        workOrderId: woId,
        body: buildReelPostCaption((briefRecord.copy ?? {}) as Record<string, unknown>),
        endcard: (((briefRecord.copy ?? {}) as Record<string, unknown>).endcard ?? {}) as Record<string, unknown>,
      }),
    ],
    ...(mediaEvidence?.creative_plan ? { creative_plan: mediaEvidence.creative_plan } : {}),
    new_clip_ids: insertedClipIds,
    ...(substance.applicable
      ? {
          // Server recompute is the verdict; the worker's report is audit only.
          content_substance: {
            server: substance.server
              ? { verdict: substance.server.verdict, kinds: substance.server.kinds, textSeconds: substance.server.textSeconds, reason: substance.server.reason.slice(0, 500) }
              : null,
            reported: substance.reported,
            capable: substance.capable,
            mismatch: substance.mismatch,
            enforced: enforceSubstance,
          },
          // Audit mark only: the approve/publish guards read brief.remotion.deliverable (see deliverable.ts), not this.
          ...(substance.assetOnly ? { deliverable: 'asset_only' } : {}),
        }
      : {}),
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

  return { ok: true, status: 'in_review', redlineHits, qualityFlags, newClipIds: insertedClipIds }
}
