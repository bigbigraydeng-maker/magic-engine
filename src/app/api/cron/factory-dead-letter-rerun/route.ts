// Hourly dead-letter rerun. Missing local files and an offline render worker
// get at most two automatic retries. Unreadable failures are not successes.
// dry_run=1 plans only and writes nothing on the work orders.

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  HELD_FROM_AUTO_RERUN,
  nextReviewRef,
  runDeadLetterRerun,
  UNREADABLE,
  type DeadLetterRow,
  type DeadLetterStore,
  type RerunAction,
  type RerunSummary,
} from '@/lib/factory/dead-letter-rerun'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function receipt(summary: RerunSummary): Record<string, unknown> {
  return {
    ok: summary.ok,
    dryRun: summary.dryRun,
    processed: summary.processed,
    rerun: summary.rerun,
    planned: summary.planned,
    escalated: summary.escalated,
    held: summary.held,
    unread: summary.unread,
    failed: summary.failed,
    ...(summary.reason ? { reason: summary.reason } : {}),
  }
}

function store(): DeadLetterStore {
  return {
    async list() {
      const { data, error } = await supabaseAdmin
        .from('content_work_orders')
        .select('id, client_id, reject_reason, review_ref, brief, reclaim_count')
        .eq('status', 'dead_letter')
        .limit(100)
      if (error) return { ok: false, reason: error.message?.trim() || UNREADABLE }
      return { ok: true, rows: (data ?? []) as DeadLetterRow[] }
    },
    async rerun(action: Extract<RerunAction, { action: 'rerun' }>, at: string) {
      const current = await supabaseAdmin
        .from('content_work_orders')
        .select('review_ref')
        .eq('id', action.id)
        .eq('status', 'dead_letter')
        .maybeSingle()
      if (current.error) return { ok: false, reason: current.error.message?.trim() || UNREADABLE }
      const { data, error } = await supabaseAdmin
        .from('content_work_orders')
        .update({
          status: 'queued',
          attempt_count: 0,
          reclaim_count: action.reclaimCount,
          claimed_by: null,
          claimed_at: null,
          heartbeat_at: null,
          reject_reason: null,
          review_ref: nextReviewRef(current.data?.review_ref, action.nextCount, action.reason, at),
          updated_at: at,
        })
        .eq('id', action.id)
        .eq('status', 'dead_letter')
        .select('id')
      if (error) return { ok: false, reason: error.message?.trim() || UNREADABLE }
      if (!data || data.length === 0) return { ok: false, reason: 'work order no longer in dead_letter' }
      return { ok: true }
    },
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const cronRun = await startCronRun('factory-dead-letter-rerun')
  try {
    const summary = await runDeadLetterRerun(store(), { dryRun, heldPrefixes: HELD_FROM_AUTO_RERUN })
    await cronRun.finish({
      processed: summary.processed,
      completed: dryRun ? 0 : summary.rerun,
      failed: summary.failed,
      error: summary.ok ? undefined : summary.reason,
      summary: receipt(summary),
    })
    return NextResponse.json(summary, { status: summary.ok ? 200 : 500 })
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message : UNREADABLE
    await cronRun.finish({ error: message })
    return NextResponse.json({ ok: false, reason: message }, { status: 500 })
  }
}
