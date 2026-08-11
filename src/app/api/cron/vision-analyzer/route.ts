/**
 * POST /api/cron/vision-analyzer
 *
 * Phase 21.B.3 — Vision Analysis Engine
 *
 * Picks up to BATCH_SIZE client_assets with status='pending',
 * analyses each via GPT-4o-mini Vision, writes vision_metadata +
 * Hook/Middle/CTA scores back to the row.
 *
 * Auth:     Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 2 minutes (render.yaml)
 * Batch:    10 assets per run (keeps run time < 60s)
 *
 * Idempotency: sets status='analyzing' before calling Vision API,
 * so a second concurrent run won't double-process the same asset.
 *
 * Reference: ROADMAP.md P21.B.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyseImage, computeScores } from '@/lib/assets/vision-analyzer'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 10

/** 取批时先捞多少倍的候选，再在里面按客户轮流分。 */
const FAIR_SHARE_POOL = 5

/**
 * 按客户轮流取，而不是先来后到。
 *
 * 🔴 2026-08-05 狄仁杰 6c：这个任务原来是**全局先进先出**。一个客户从公开上传口
 * 灌 5000 张垃圾图，会全部排在其他客户真实素材前面 —— 按每 2 分钟 10 张算，
 * 把队列堵将近 17 小时。这不只是烧他自己的钱，是**跨客户的服务饿死**。
 *
 * 轮流分之后，一个客户灌得再多，也只占每一轮里的一个名额。
 * 每个客户内部仍然是先来后到（入参已按时间排好序）。
 */
function fairShare<T extends { client_id?: unknown }>(rows: readonly T[], take: number): T[] {
  const queues = new Map<string, T[]>()
  for (const r of rows) {
    const k = String(r.client_id ?? '')
    const q = queues.get(k) ?? []
    q.push(r)
    queues.set(k, q)
  }
  const out: T[] = []
  let progressed = true
  while (out.length < take && progressed) {
    progressed = false
    for (const q of Array.from(queues.values())) {
      if (out.length >= take) break
      const next = q.shift()
      if (next) { out.push(next); progressed = true }
    }
  }
  return out
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('vision-analyzer')

  // 1. Claim a batch: PostgREST UPDATE does not support .order().limit(),
  //    so we SELECT the IDs first, then UPDATE by ID.
  const { data: pending, error: selectErr } = await supabaseAdmin
    .from('client_assets')
    // 带上 vision_metadata:分析结果要**合并**写回而不是整体覆盖,否则会抹掉入库时写的
    // 溯源字段(source='client_upload_link' 等)—— 那是判断「是不是客户真拍的」的依据。
    .select('id, client_id, storage_url, original_filename, vision_metadata')
    .eq('status', 'pending')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    // 多取一些再按客户轮流分 —— 直接 limit(BATCH_SIZE) 拿到的永远是同一个客户的头几张。
    .limit(BATCH_SIZE * FAIR_SHARE_POOL)

  if (selectErr) {
    console.error('[vision-analyzer] select error:', selectErr.message)
    await cronRun.finish({ failed: 1, error: selectErr.message })
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }

  const batch = fairShare(pending ?? [], BATCH_SIZE)
  if (batch.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending assets' })
  }

  // Mark as 'analyzing' so a concurrent run won't double-process
  const { error: claimErr } = await supabaseAdmin
    .from('client_assets')
    .update({ status: 'analyzing' })
    .in('id', batch.map(a => a.id))

  if (claimErr) {
    console.error('[vision-analyzer] claim error:', claimErr.message)
    await cronRun.finish({ failed: 1, error: claimErr.message })
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }

  let succeeded = 0
  let failed    = 0
  const errors: string[] = []

  for (const asset of batch) {
    try {
      const metadata = await analyseImage(asset.storage_url)
      const scores   = computeScores(metadata)

      const { error: updateErr } = await supabaseAdmin
        .from('client_assets')
        .update({
          status:           'analyzed',
          // 合并而非覆盖:保住 source / uploaded_at 这些入库时写的溯源字段
          vision_metadata:  { ...((asset.vision_metadata ?? {}) as Record<string, unknown>), ...metadata },
          hook_score:       scores.hook_score,
          middle_score:     scores.middle_score,
          cta_score:        scores.cta_score,
          recommended_use:  scores.recommended_use,
          error_message:    null,
        })
        .eq('id', asset.id)

      if (updateErr) throw new Error(updateErr.message)

      console.log(
        `[vision-analyzer] ✓ ${asset.original_filename ?? asset.id} ` +
        `hook=${scores.hook_score} mid=${scores.middle_score} cta=${scores.cta_score} → ${scores.recommended_use}`,
      )
      succeeded++

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[vision-analyzer] ✗ ${asset.id}: ${msg}`)
      errors.push(`${asset.original_filename ?? asset.id}: ${msg}`)
      failed++

      // Mark as error so it doesn't stay stuck at 'analyzing'
      try {
        await supabaseAdmin
          .from('client_assets')
          .update({ status: 'error', error_message: msg })
          .eq('id', asset.id)
      } catch {
        // best-effort status update
      }
    }
  }

  await cronRun.finish({ processed: batch.length, completed: succeeded, failed })
  return NextResponse.json({
    ok:        true,
    timestamp: new Date().toISOString(),
    batch:     batch.length,
    succeeded,
    failed,
    errors,
  })
}
