/**
 * 马良 review of admitted finished videos without Inngest. Knocked every 20 minutes by
 * cron-dispatch-frequent (in-process). Logic and switch: lib/maliang/direct-sweep.ts.
 * One cron_run_logs row per run under 'maliang-direct-sweep'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { directFallbackEnabled } from '@/lib/telephony/direct-sweep'
import { runNineGridCheck } from '@/lib/maliang/render-check'
import { runReviewCheckV2 } from '@/lib/maliang/render-check-v2'
import { REMOTION_REVIEW_TIMEOUT_MS, runCheckWithTimeout } from '@/lib/maliang/review-disposition'
import { readWorkOrderContext, writeWorkOrderVerdict, type WorkOrderReady } from '@/lib/maliang/work-order-review'
import { EXTERNAL_UPLOAD_ENGINE, isExternalUpload } from '@/lib/factory/talent-consent'
import { workOrderCheck } from '@/lib/inngest/functions/maliang-render-check'
import {
  contentFactoryPublicUrl,
  MALIANG_DIRECT_JOB,
  runMaliangDirectSweep,
  type DirectReviewOutcome,
} from '@/lib/maliang/direct-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LOOKBACK_DAYS = 14

interface PendingRow { id: string; client_id: string; brief: unknown; output: { video_path?: unknown } | null }

async function listPending(limit: number): Promise<WorkOrderReady[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not configured')
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, client_id, brief, output')
    .eq('status', 'in_review')
    .eq('brief->>engine', EXTERNAL_UPLOAD_ENGINE)
    .gte('created_at', since)
    .not('output->video_path', 'is', null)
    .is('output->maliang_check', null)
    .order('created_at', { ascending: true })
    .limit(limit * 4)
  if (error) throw new Error(error.message)
  return ((data ?? []) as PendingRow[])
    .filter((row) => isExternalUpload(row.brief) && typeof row.output?.video_path === 'string' && row.output.video_path.length > 0)
    .slice(0, limit)
    .map((row) => ({
      client_id: row.client_id,
      work_order_id: row.id,
      output_url: contentFactoryPublicUrl(supabaseUrl, row.output!.video_path as string),
    }))
}

async function review(order: WorkOrderReady): Promise<DirectReviewOutcome> {
  const read = await readWorkOrderContext(supabaseAdmin, order)
  if (!read.ok) return { kind: 'unread', reason: read.reason }
  const deps = { check: runNineGridCheck, checkV2: runReviewCheckV2, apiKey: () => process.env.GEMINI_API_KEY }
  const check = await runCheckWithTimeout(
    () => workOrderCheck(deps, read.ctx, order.output_url),
    REMOTION_REVIEW_TIMEOUT_MS,
    order.output_url,
  )
  await writeWorkOrderVerdict(supabaseAdmin, order.work_order_id, check)
  return { kind: 'checked', status: check.status, reasons: check.reasons }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!directFallbackEnabled(process.env)) return NextResponse.json({ status: 'off' })

  const startedAt = Date.now()
  const runId = await startCronRunId(MALIANG_DIRECT_JOB)
  const receipt = await runMaliangDirectSweep({ listPending, review })
  const unread = receipt.results.filter((r) => r.outcome.kind === 'unread')
  const error = receipt.error ?? (unread.length > 0
    ? unread.map((r) => `${r.work_order_id}: ${r.outcome.kind === 'unread' ? r.outcome.reason : ''}`).join(' | ')
    : undefined)
  await cronRunHandle(MALIANG_DIRECT_JOB, runId, startedAt).finish({
    processed: receipt.picked,
    completed: receipt.picked - unread.length,
    failed: unread.length + (receipt.status === 'list_failed' ? 1 : 0),
    summary: { status: receipt.status, results: receipt.results, runner: 'dispatcher', no_publish: true },
    ...(error ? { error: error.slice(0, 1000) } : {}),
  })
  return NextResponse.json(receipt, { status: receipt.status === 'list_failed' ? 500 : 200 })
}
