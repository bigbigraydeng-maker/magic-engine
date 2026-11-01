// P21.J M2 — POST /api/factory/worker/claim(spec §6.1)
// 本地 Mac worker 原子认领最老 queued 工单:factory_claim_work_order RPC
// (FOR UPDATE SKIP LOCKED,杜绝先 SELECT 再 UPDATE 竞态)。
// 响应含完整 brief + clip 签名下载清单 + 三件套签名上传 URL。
// 鉴权 FACTORY_WORKER_TOKEN + client 白名单双 fail-closed(魏征 F9)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  FACTORY_BUCKET,
  isWorkerAuthorized,
  workerClaimClientIds,
  workerClientWhitelist,
} from '@/lib/factory/worker-guard'
import { deriveRecipeIntent } from '@/lib/factory/recipe'
import { claimAspectUploads } from '@/lib/factory/video-aspects'
import { assessEngineReport } from '@/lib/factory/engine-catalog.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNED_DOWNLOAD_TTL_S = 6 * 3600 // 覆盖单工单最长生产窗口

interface ClipRef {
  clip_id: string
  storage_url: string
  /** bucket 内路径给签名 URL;外链(历史数据)原样透传 */
  signed_url: string | null
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const whitelist = workerClientWhitelist()
  if (!whitelist) {
    // fail-closed:白名单 env 未配置绝不放行全客户认领
    return NextResponse.json(
      { error: 'FACTORY_WORKER_CLIENT_IDS not configured' },
      { status: 503 },
    )
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }
  const body = parsedBody as Record<string, unknown>
  const workerId = typeof body.worker_id === 'string' && body.worker_id.trim()
    ? body.worker_id.trim()
    : 'local-mac'
  const claimClientIds = workerClaimClientIds(body, whitelist)
  if (!claimClientIds) {
    return NextResponse.json({ error: 'client_id must be allowlisted when provided' }, { status: 403 })
  }

  // Old machines stay out of the queue. The order is not claimed, so it cannot
  // fall into the dead-letter pile, and a machine that already reports the
  // current catalog can still take it.
  const engine = assessEngineReport(body.engine)
  if (!engine.ok) {
    return NextResponse.json(
      { claimed: false, stale_engine: true, message: engine.message },
      { status: 200 },
    )
  }

  const { data, error } = await supabaseAdmin.rpc('factory_claim_work_order', {
    p_worker_id: workerId,
    p_client_ids: claimClientIds,
  })
  if (error) {
    return NextResponse.json({ error: `claim rpc failed: ${error.message}` }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.ok) {
    return NextResponse.json({ claimed: false }, { status: 200 })
  }

  const workOrderId = row.work_order_id as string
  const clientId = row.client_id
  if (typeof clientId !== 'string'
    || !claimClientIds.some((id) => id.toLowerCase() === clientId.toLowerCase())) {
    return NextResponse.json({ error: 'claim returned a client outside the requested scope' }, { status: 500 })
  }
  const brief = (row.brief ?? {}) as Record<string, unknown>

  // R3:客户当前 recipe 意图 —— worker 拿它对比 brief.creative_recipe。
  // 配置非法 = 让 worker fail-closed(不静默走 legacy 分支)。
  // clients.factory_config 查库失败:也 fail-closed(500)—— 之前的静默降级会让 recipe
  // 客户被当成 legacy 跑,可能绕过 recipe 强约束。查成功 + 无 creative_recipe = null intent,
  // 保留 legacy 客户老路径不变。
  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) {
    return NextResponse.json(
      { error: `client factory_config lookup failed: ${clientErr.message}` },
      { status: 500 },
    )
  }
  const { recipeIntent, recipeIntentInvalidReason } = deriveRecipeIntent(
    clientRow?.factory_config,
  )

  // clip URL 清单:brief.segments[].clip_ids → 签名下载 URL
  const clipIds = new Set<string>()
  const segments = Array.isArray(brief['segments']) ? (brief['segments'] as Array<Record<string, unknown>>) : []
  for (const seg of segments) {
    for (const id of Array.isArray(seg['clip_ids']) ? (seg['clip_ids'] as unknown[]) : []) {
      if (typeof id === 'string') clipIds.add(id)
    }
  }

  const clips: ClipRef[] = []
  if (clipIds.size > 0) {
    const { data: clipRows, error: clipErr } = await supabaseAdmin
      .from('video_clips')
      .select('id, storage_url')
      .in('id', Array.from(clipIds))
    if (clipErr) {
      return NextResponse.json({ error: `clip lookup failed: ${clipErr.message}` }, { status: 500 })
    }
    // 并行签名:此前是 for + await 串行,每个 clip 一次网络往返排队等。
    // 一个工单十几个签名 = 十几次往返串起来,服务端稍慢就整体超过 Cloudflare 的
    // 超时阈值 → worker 领单收到 522(2026-07-24 实测 39s 超时)。
    const signedClips = await Promise.all(
      (clipRows ?? []).map(async (c) => {
        const isPath = typeof c.storage_url === 'string' && !/^[a-z]+:\/\//i.test(c.storage_url)
        if (!isPath) {
          return { clip_id: c.id as string, storage_url: c.storage_url as string, signed_url: c.storage_url as string }
        }
        const { data: s } = await supabaseAdmin.storage
          .from(FACTORY_BUCKET)
          .createSignedUrl(c.storage_url as string, SIGNED_DOWNLOAD_TTL_S)
        return { clip_id: c.id as string, storage_url: c.storage_url as string, signed_url: s?.signedUrl ?? null }
      }),
    )
    clips.push(...signedClips)
  }

  // 三件套签名上传 URL(路径即 complete 时的前缀校验契约)
  const uploadPaths = {
    video: `renders/${clientId}/${workOrderId}/final.mp4`,
    segments_json: `renders/${clientId}/${workOrderId}/segments.json`,
    srt: `renders/${clientId}/${workOrderId}/captions.srt`,
  }
  const uploads: Record<string, { path: string; signed_url: string; token: string } | null> = {}
  const uploadResults = await Promise.all(
    Object.entries(uploadPaths).map(async ([key, path]) => {
      const { data: u, error: uErr } = await supabaseAdmin.storage
        .from(FACTORY_BUCKET)
        .createSignedUploadUrl(path, { upsert: true })
      return { key, path, u, uErr }
    }),
  )
  for (const { key, path, u, uErr } of uploadResults) {
    if (uErr || !u) {
      return NextResponse.json(
        { error: `signed upload url failed (${key}): ${uErr?.message ?? 'unknown'}` },
        { status: 500 },
      )
    }
    uploads[key] = { path, signed_url: u.signedUrl, token: u.token }
  }

  // B 轨生成 clip 的签名上传 URL(路径即 complete 时 validateClipPath 前缀契约)。
  // 按 clip_generation_plan 逐条,key=idempotency_key(worker 生成后凭此上传+回填)。
  const genPlan = Array.isArray(brief['clip_generation_plan'])
    ? (brief['clip_generation_plan'] as Array<Record<string, unknown>>)
    : []
  const clipUploads: Array<{ idempotency_key: string; path: string; signed_url: string; token: string }> = []
  const genResults = await Promise.all(
    genPlan.map(async (item) => {
      const role = String(item['segment_role'] ?? 'clip')
      const pos = Number(item['position'] ?? 0)
      // 生成式统一进 b-generated;实拍补拍走 a-real(v1 生成为主)
      const path = `clips/b-generated/${clientId}/${workOrderId}_${role}_${pos}.mp4`
      const { data: u, error: uErr } = await supabaseAdmin.storage
        .from(FACTORY_BUCKET)
        .createSignedUploadUrl(path, { upsert: true })
      return { item, role, pos, path, u, uErr }
    }),
  )
  for (const { item, role, pos, path, u, uErr } of genResults) {
    if (uErr || !u) {
      return NextResponse.json(
        { error: `signed clip upload url failed (${role}:${pos}): ${uErr?.message ?? 'unknown'}` },
        { status: 500 },
      )
    }
    clipUploads.push({
      idempotency_key: String(item['idempotency_key'] ?? `${workOrderId}:${role}:${pos}`),
      path,
      signed_url: u.signedUrl,
      token: u.token,
    })
  }

  // Extra ratios are opt-in. A bad list is returned to the worker (the row is already
  // claimed) so it can fail the order instead of delivering a 9:16-only file.
  const aspectPlan = claimAspectUploads(brief, clientId, workOrderId)
  let aspectUploads: Array<{ aspect: string; path: string; width: number; height: number; signed_url: string; token: string }> | undefined
  let aspectError: string | undefined
  if (!aspectPlan.ok) {
    aspectError = aspectPlan.error
  } else if (aspectPlan.uploads.length > 0) {
    const signedAspects = await Promise.all(
      aspectPlan.uploads.map(async (spec) => {
        const { data: u, error: uErr } = await supabaseAdmin.storage
          .from(FACTORY_BUCKET)
          .createSignedUploadUrl(spec.path, { upsert: true })
        return { spec, u, uErr }
      }),
    )
    aspectUploads = []
    for (const { spec, u, uErr } of signedAspects) {
      if (uErr || !u) {
        // The row is already claimed. Return the id plus aspect_error so the worker
        // fails this order, instead of a bare 500 that leaves it claimed until the sweeper.
        aspectError = `额外画幅 ${spec.aspect} 的上传地址没签出来：${uErr?.message ?? 'unknown'}`
        aspectUploads = undefined
        break
      }
      aspectUploads.push({
        aspect: spec.aspect,
        path: spec.path,
        width: spec.width,
        height: spec.height,
        signed_url: u.signedUrl,
        token: u.token,
      })
    }
  }

  return NextResponse.json({
    claimed: true,
    work_order_id: workOrderId,
    client_id: clientId,
    budget_cap_usd: Number(row.budget_cap_usd),
    brief,
    clips,
    uploads,
    ...(aspectUploads ? { aspect_uploads: aspectUploads } : {}),
    ...(aspectError ? { aspect_error: aspectError } : {}),
    clip_uploads: clipUploads,
    // R3:worker 侧 assertClientRecipeIntentMatchesBrief 用它;意图非法则 worker 抛 CONFIG_INVALID。
    recipe_intent: recipeIntent,
    recipe_intent_invalid_reason: recipeIntentInvalidReason,
  })
}
