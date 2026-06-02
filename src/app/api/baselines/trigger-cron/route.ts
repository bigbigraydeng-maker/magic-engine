import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/baselines/trigger-cron
// Admin UI button: pre-creates a baseline_cron_runs row, then fires the cron route
// async (fire-and-forget) — returns the runId immediately so UI can poll status.
export async function POST() {
  // 1. Pre-create a run row so UI gets a runId to poll
  const { data: runRow, error: createError } = await supabaseAdmin
    .from('baseline_cron_runs')
    .insert({ status: 'running', triggered_by: 'admin_manual' })
    .select('id')
    .single()

  if (createError || !runRow) {
    return NextResponse.json({ error: createError?.message ?? 'Failed to create run record' }, { status: 500 })
  }

  // 2. Fire-and-forget the actual cron route — it will pick up the pre-created run via x-run-id
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const cronSecret = process.env.CRON_SECRET ?? ''

  fetch(`${appUrl}/api/cron/baseline-domains-monthly`, {
    method:  'POST',
    headers: {
      'x-cron-secret': cronSecret,
      'x-run-id':      runRow.id,
    },
  }).catch(err => console.error('[trigger-cron] fire-and-forget error:', err))

  // 3. Return runId immediately — UI polls /api/baselines/cron-runs to see status
  return NextResponse.json({ success: true, run_id: runRow.id })
}
