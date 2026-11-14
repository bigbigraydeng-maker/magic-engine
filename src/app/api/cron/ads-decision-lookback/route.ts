import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorized } from '@/lib/cron/dispatch/handle'
import { startCronRun } from '@/lib/cron/run-logger'
import { supabaseAdmin } from '@/lib/supabase'
import { runAdsDecisionLookbackJob } from '@/lib/ads/decision-log/lookback-job'
import { listClientsWithDecisionReviewOn } from '@/lib/ads/decision-log/switch'

export const dynamic = 'force-dynamic'

const JOB = 'ads-decision-lookback'

/** Daily look-back for ads_decision_v1 when per-client switch is on. Unscheduled by default. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = rejectUnauthorized(req)
  if (denied) return denied
  const clientId = req.nextUrl.searchParams.get('client_id') ?? undefined
  const asOf = req.nextUrl.searchParams.get('as_of') ?? undefined
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const cronRun = await startCronRun(JOB)
  try {
    if (dryRun) {
      const clients = clientId
        ? [{ id: clientId }]
        : await listClientsWithDecisionReviewOn(supabaseAdmin)
      const summary = { dry_run: true, clients: clients.length, as_of: asOf ?? 'today' }
      await cronRun.finish(summary)
      return NextResponse.json({ success: true, ...summary })
    }
    const result = await runAdsDecisionLookbackJob(supabaseAdmin, { clientId, asOf })
    await cronRun.finish(result)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
