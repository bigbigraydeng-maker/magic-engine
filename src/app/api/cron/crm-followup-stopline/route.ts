/**
 * The catalogue follow-up stop line (lib/crm/ai-takeover/stop-line-run.ts), run by cron-dispatch-frequent at 18:30 UTC
 * (07:30 NZDT) as well as by its Inngest function. Added 2026-11-16 while the Inngest monthly quota is used up; the two
 * can both run: every stop is keyed by its evidence, so a second run writes nothing new.
 * Switch: CRM_FOLLOWUP_STOPLINE ('off' / 'dry_run'), same as the Inngest function. Receipt → cron_run_logs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { STOPLINE_JOB, runStopline } from '@/lib/crm/ai-takeover/stop-line-run'
import { stoplineMode } from '@/lib/inngest/functions/crm-followup-stopline'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const mode = stoplineMode(process.env, req.nextUrl.searchParams.get('dry_run') === '1')
  if (mode === 'off') return NextResponse.json({ skipped: 'off' })
  const run = await startCronRun(STOPLINE_JOB)
  try {
    const receipt = await runStopline(supabaseAdmin, { dryRun: mode === 'dry_run' })
    const guests = receipt.clients.reduce((n, c) => n + c.in_takeover, 0)
    const failed = receipt.clients.reduce((n, c) => n + c.stopped.filter((s) => s.write === 'failed').length, 0)
    const unreadable = receipt.clients.filter((c) => c.error !== null).map((c) => `${c.client_id}: ${c.error}`)
    await run.finish({
      processed: guests,
      completed: guests - failed,
      failed: failed + unreadable.length,
      summary: { ...receipt, runner: 'dispatcher' },
      ...(receipt.error || unreadable.length > 0 ? { error: [receipt.error, ...unreadable].filter(Boolean).join('; ').slice(0, 500) } : {}),
    })
    return NextResponse.json(receipt)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await run.finish({ failed: 1, error: message.slice(0, 500) })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
