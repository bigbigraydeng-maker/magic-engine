/**
 * Daily AI pickup (lib/crm/ai-takeover/pickup-run.ts). Knocked by cron-dispatch-frequent at 18:45 UTC (07:45 NZDT),
 * after the stop line. Switches: CRM_AI_PICKUP (default: decide only), CRM_AI_PICKUP_CLIENTS, CRM_AI_PICKUP_DAILY_MAX.
 * Receipt → cron_run_logs 'crm-ai-pickup'. Manual dry run: add ?dry_run=1.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { PICKUP_JOB, pickupSwitches, runAiPickup } from '@/lib/crm/ai-takeover/pickup-run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const run = await startCronRun(PICKUP_JOB)
  const sw = pickupSwitches(process.env)
  if (sw.mode === 'off' || sw.clients.length === 0) {
    await run.finish({ processed: 0, completed: 0, summary: { status: 'off', clients: sw.clients.length } })
    return NextResponse.json({ status: 'off' })
  }
  const dryRun = sw.mode !== 'live' || req.nextUrl.searchParams.get('dry_run') === '1'
  try {
    const receipt = await runAiPickup(supabaseAdmin, { clients: sw.clients, dryRun, dailyMax: sw.dailyMax })
    const results = receipt.clients.flatMap((c) => c.picked)
    const failed = results.filter((p) => p.write === 'failed').length
    const unreadable = receipt.clients.filter((c) => c.error !== null).map((c) => `${c.client_id}: ${c.error}`)
    await run.finish({
      processed: results.length,
      completed: results.length - failed,
      failed: failed + unreadable.length,
      summary: { ...receipt },
      ...(unreadable.length > 0 ? { error: unreadable.join('; ').slice(0, 500) } : {}),
    })
    return NextResponse.json(receipt)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await run.finish({ failed: 1, error: message.slice(0, 500) })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
