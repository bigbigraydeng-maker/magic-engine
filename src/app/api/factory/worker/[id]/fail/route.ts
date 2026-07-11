// P21.J M2 — POST /api/factory/worker/[id]/fail(spec §6.1)
// body {error, retryable}:retryable 且未超 max_attempts → 回 queued + attempt_count+1;
// 不可重试或超限 → dead_letter(ME 后台「重置回 queued」按钮人工复活,不碰 DB)。

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isWorkerAuthorized } from '@/lib/factory/worker-guard'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = ['claimed', 'producing']

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
  const errorMsg = typeof body.error === 'string' && body.error.trim()
    ? body.error.trim().slice(0, 2000)
    : 'worker reported failure'
  const retryable = body.retryable === true

  const { data: wo, error: loadErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, status, attempt_count, max_attempts')
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

  const nextAttempt = Number(wo.attempt_count) + 1
  const toDeadLetter = !retryable || nextAttempt >= Number(wo.max_attempts)

  const { error: upErr } = await supabaseAdmin
    .from('content_work_orders')
    .update(
      toDeadLetter
        ? {
            status: 'dead_letter',
            attempt_count: nextAttempt,
            reject_reason: errorMsg,
            claimed_by: null,
            claimed_at: null,
            heartbeat_at: null,
            updated_at: new Date().toISOString(),
          }
        : {
            status: 'queued',
            attempt_count: nextAttempt,
            reject_reason: errorMsg,
            claimed_by: null,
            claimed_at: null,
            heartbeat_at: null,
            updated_at: new Date().toISOString(),
          },
    )
    .eq('id', id)
    .in('status', ACTIVE_STATUSES)
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  if (toDeadLetter) {
    console.warn(`[factory worker] work order ${id} → dead_letter after ${nextAttempt} attempts: ${errorMsg}`)
  }

  return NextResponse.json({
    ok: true,
    status: toDeadLetter ? 'dead_letter' : 'queued',
    attempt_count: nextAttempt,
  })
}
