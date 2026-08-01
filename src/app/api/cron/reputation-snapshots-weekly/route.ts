import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  captureReputationForClient,
  hasReputationIdentity,
  type ReputationClient,
  type ReputationCaptureResult,
} from '@/lib/reputation/snapshots'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/reputation-snapshots-weekly
 *
 * Weekly cron (DataForSEO 计划 阶段 2) — captures GBP / Tripadvisor rating,
 * review count and incremental review items for every ACTIVE client that has
 * reputation identities configured (Settings → 口碑监测身份).
 *
 * Cost gate: client_status='active' (阶段 0) AND at least one identity set.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('reputation-snapshots-weekly')

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, city, country, gbp_place_id, tripadvisor_keyword, competitor_gbp')
    .eq('client_status', 'active')

  if (clientErr) {
    await cronRun.finish({ failed: 1, error: clientErr.message })
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 },
    )
  }

  const eligible = ((clients ?? []) as ReputationClient[]).filter(hasReputationIdentity)

  if (eligible.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({
      success: true,
      message: 'No active clients with reputation identities — nothing to capture',
      clients_processed: 0,
      results: [],
    })
  }

  const results: Array<ReputationCaptureResult | {
    client_id: string
    name: string
    error: string
  }> = []

  // Sequential — DataForSEO business endpoints are cheap but rate-limited.
  for (const client of eligible) {
    try {
      results.push(await captureReputationForClient(client))
    } catch (err) {
      results.push({
        client_id: client.id,
        name: client.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const failedCount = results.filter(r => 'error' in r).length
  const snapshotsWritten = results.reduce(
    (sum, r) => sum + ('snapshots_written' in r ? r.snapshots_written : 0), 0)
  const reviewsWritten = results.reduce(
    (sum, r) => sum + ('reviews_written' in r ? r.reviews_written : 0), 0)

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failedCount,
    failed: failedCount,
    summary: { snapshots_written: snapshotsWritten, reviews_written: reviewsWritten },
  })
  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    snapshots_written: snapshotsWritten,
    reviews_written: reviewsWritten,
    failed: failedCount,
    results,
  })
}
