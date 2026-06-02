import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getPublicOrigin } from '@/lib/auth/public-origin'

/**
 * POST /api/baselines/trigger-cron
 *
 * Admin UI button: pre-creates a baseline_cron_runs row, then fires the cron route
 * async (fire-and-forget) — returns the runId immediately so UI can poll status.
 *
 * Auth: requires a logged-in user. Without this, anyone could trigger the cron
 * route (which calls DataForSEO for every baseline_domain — burns quota fast).
 * Admin-level access isn't required here because the UI is already behind
 * /dashboard auth middleware; this is the second-layer guard for the API route.
 */
export async function POST(req: NextRequest) {
  // Block unauthenticated callers — cron triggers paid DataForSEO calls
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  // 1. Pre-create a run row so UI gets a runId to poll
  const { data: runRow, error: createError } = await supabaseAdmin
    .from('baseline_cron_runs')
    .insert({ status: 'running', triggered_by: 'admin_manual' })
    .select('id')
    .single()

  if (createError || !runRow) {
    return NextResponse.json(
      { error: createError?.message ?? 'Failed to create run record' },
      { status: 500 },
    )
  }

  // 2. Fire-and-forget the actual cron route
  // Use getPublicOrigin() instead of raw env var — on Render, request.url returns
  // the internal localhost:PORT and APP_URL may not be set. getPublicOrigin
  // handles both env-var and x-forwarded-host fallback correctly.
  const origin = getPublicOrigin(req)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // Mark the just-created run as failed before bailing out
    await supabaseAdmin
      .from('baseline_cron_runs')
      .update({ status: 'failed', error_message: 'CRON_SECRET not configured', completed_at: new Date().toISOString() })
      .eq('id', runRow.id)
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  fetch(`${origin}/api/cron/baseline-domains-monthly`, {
    method:  'POST',
    headers: {
      'x-cron-secret': cronSecret,
      'x-run-id':      runRow.id,
    },
  }).catch(err => console.error('[trigger-cron] fire-and-forget error:', err))

  // 3. Return runId immediately — UI polls /api/baselines/cron-runs to see status
  return NextResponse.json({ success: true, run_id: runRow.id })
}
