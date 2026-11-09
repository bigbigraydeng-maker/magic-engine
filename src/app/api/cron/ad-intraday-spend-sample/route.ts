/** GET. Read-only Meta spend sample. ?dry_run=1 replays a fixture and writes nothing. */
import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { samplesTableReady } from '@/lib/ads-strategy/intraday-spend/db'
import { DRY_NOW, dryDeps } from '@/lib/ads-strategy/intraday-spend/dry'
import { productionDeps } from '@/lib/ads-strategy/intraday-spend/prod'
import { runIntradaySample } from '@/lib/ads-strategy/intraday-spend/run'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.nextUrl.searchParams.get('dry_run') === '1') {
    const receipt = await runIntradaySample(dryDeps(), { now: DRY_NOW, sleep: async () => {}, dryRun: true })
    return NextResponse.json({ ok: true, ...receipt })
  }
  return live()
}

async function live(): Promise<NextResponse> {
  const cronRun = await startCronRun('ad-intraday-spend-sample')
  try {
    if (!(await samplesTableReady(supabaseAdmin))) {
      await cronRun.finish({ processed: 0, completed: 0, failed: 0, summary: { skipped: 'tables_missing' } })
      return NextResponse.json({ ok: false, skipped: 'tables_missing' })
    }
    const receipt = await runIntradaySample(productionDeps(), { now: new Date(), sleep: delay })
    await cronRun.finish({
      processed: receipt.accountsSampled + receipt.failed,
      completed: receipt.accountsSampled + receipt.noLive,
      failed: receipt.failed,
      summary: receipt as unknown as Record<string, unknown>,
    })
    return NextResponse.json({ ok: receipt.failed === 0, ...receipt })
  } catch {
    await cronRun.finish({ error: 'intraday sample failed' })
    return NextResponse.json({ ok: false, error: '采样没有跑完' }, { status: 500 })
  }
}
