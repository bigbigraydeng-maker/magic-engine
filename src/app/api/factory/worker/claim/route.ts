// P21.J M2 — POST /api/factory/worker/claim(spec §6.1)
// 本地 Mac worker 原子认领最老 queued 工单:factory_claim_work_order RPC
// (FOR UPDATE SKIP LOCKED,杜绝先 SELECT 再 UPDATE 竞态)。
// 响应含完整 brief + clip 签名下载清单 + 三件套签名上传 URL。
// 鉴权 FACTORY_WORKER_TOKEN + client 白名单双 fail-closed(魏征 F9)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_BUCKET, isWorkerAuthorized, workerClientWhitelist } from '@/lib/factory/worker-guard'

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

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // body 可选:worker_id 缺省用 host 标识
  }
  const workerId = typeof body.worker_id === 'string' && body.worker_id.trim()
    ? body.worker_id.trim()
    : 'local-mac'

  const { data, error } = await supabaseAdmin.rpc('factory_claim_work_order', {
    p_worker_id: workerId,
    p_client_ids: whitelist,
  })
  if (error) {
    return NextResponse.json({ error: `claim rpc failed: ${error.message}` }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.ok) {
    return NextResponse.json({ claimed: false }, { status: 200 })
  }

  const workOrderId = row.work_order_id as string
  const clientId = row.client_id as string
  const brief = (row.brief ?? {}) as Record<string, unknown>

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
      .in('id', [...clipIds])
    if (clipErr) {
      return NextResponse.json({ error: `clip lookup failed: ${clipErr.message}` }, { status: 500 })
    }
    for (const c of clipRows ?? []) {
      let signed: string | null = null
      if (typeof c.storage_url === 'string' && !/^[a-z]+:\/\//i.test(c.storage_url)) {
        const { data: s } = await supabaseAdmin.storage
          .from(FACTORY_BUCKET)
          .createSignedUrl(c.storage_url, SIGNED_DOWNLOAD_TTL_S)
        signed = s?.signedUrl ?? null
      } else {
        signed = c.storage_url as string
      }
      clips.push({ clip_id: c.id as string, storage_url: c.storage_url as string, signed_url: signed })
    }
  }

  // 三件套签名上传 URL(路径即 complete 时的前缀校验契约)
  const uploadPaths = {
    video: `renders/${clientId}/${workOrderId}/final.mp4`,
    segments_json: `renders/${clientId}/${workOrderId}/segments.json`,
    srt: `renders/${clientId}/${workOrderId}/captions.srt`,
  }
  const uploads: Record<string, { path: string; signed_url: string; token: string } | null> = {}
  for (const [key, path] of Object.entries(uploadPaths)) {
    const { data: u, error: uErr } = await supabaseAdmin.storage
      .from(FACTORY_BUCKET)
      .createSignedUploadUrl(path, { upsert: true })
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
  for (const item of genPlan) {
    const role = String(item['segment_role'] ?? 'clip')
    const pos = Number(item['position'] ?? 0)
    // 生成式统一进 b-generated;实拍补拍走 a-real(v1 生成为主)
    const path = `clips/b-generated/${clientId}/${workOrderId}_${role}_${pos}.mp4`
    const { data: u, error: uErr } = await supabaseAdmin.storage
      .from(FACTORY_BUCKET)
      .createSignedUploadUrl(path, { upsert: true })
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

  return NextResponse.json({
    claimed: true,
    work_order_id: workOrderId,
    client_id: clientId,
    budget_cap_usd: Number(row.budget_cap_usd),
    brief,
    clips,
    uploads,
    clip_uploads: clipUploads,
  })
}
