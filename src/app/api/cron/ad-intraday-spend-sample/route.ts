/** GET. Read-only Meta spend sample. ?dry_run=1 replays a fixture and writes nothing. */
import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { dryIntradayCpl } from '@/lib/ads-strategy/circuit-breaker/intraday'
import { proposeDry } from '@/lib/ads-strategy/intraday-spend/cap-proposal'
import { samplesTableReady } from '@/lib/ads-strategy/intraday-spend/db'
import { DRY_CLIENT, DRY_NOW, dryDeps } from '@/lib/ads-strategy/intraday-spend/dry'
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
    const deps = dryDeps()
    const receipt = await runIntradaySample(deps, { now: DRY_NOW, sleep: async () => {}, dryRun: true })
    const rows = await deps.loadSamples(DRY_CLIENT, '2000-01-01')
    const proposal = await proposeDry(rows, await deps.capMinor(DRY_CLIENT), DRY_NOW)
    const cpl = dryIntradayCpl(rows, DRY_NOW)
    return NextResponse.json({ ok: true, ...receipt, proposal, cpl })
  }
  return live()
}

async function liveCpl(now: Date): Promise<{ cards: number; clients: number; failed: number; action: string }> {
  try {
    const { runIntradayCplCards } = await import('@/lib/ads-strategy/circuit-breaker/intraday-run')
    return await runIntradayCplCards(supabaseAdmin, now)
  } catch {
    return { cards: 0, clients: 0, failed: 1, action: 'cpl_failed' }
  }
}

async function liveProposal(now: Date): Promise<{ cards: number; todos: number; action: string }> {
  try {
    const { runLiveCapProposal } = await import('@/lib/ads-strategy/intraday-spend/cap-proposal-run')
    return await runLiveCapProposal(supabaseAdmin, now)
  } catch {
    return { cards: 0, todos: 0, action: 'proposal_failed' }
  }
}

async function live(): Promise<NextResponse> {
  const cronRun = await startCronRun('ad-intraday-spend-sample')
  try {
    if (!(await samplesTableReady(supabaseAdmin))) {
      await cronRun.finish({ processed: 0, completed: 0, failed: 0, summary: { skipped: 'tables_missing' } })
      return NextResponse.json({ ok: false, skipped: 'tables_missing' })
    }
    const now = new Date()
    const receipt = await runIntradaySample(productionDeps(), { now, sleep: delay })
    const proposal = await liveProposal(now)
    const cpl = await liveCpl(now)
    await cronRun.finish({
      processed: receipt.accountsSampled + receipt.failed,
      completed: receipt.accountsSampled + receipt.noLive,
      failed: receipt.failed,
      summary: { ...receipt, proposal, cpl } as unknown as Record<string, unknown>,
    })
    return NextResponse.json({ ok: receipt.failed === 0, ...receipt, proposal, cpl })
  } catch {
    await cronRun.finish({ error: 'intraday sample failed' })
    return NextResponse.json({ ok: false, error: '采样没有跑完' }, { status: 500 })
  }
}
