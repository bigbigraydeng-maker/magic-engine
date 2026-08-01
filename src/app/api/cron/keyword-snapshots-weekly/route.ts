import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  snapshotRankedKeywordsForClient,
  type KeywordSnapshotClient,
} from '@/lib/seo-intelligence/keyword-snapshots'
import {
  captureSerpForClient,
  type SerpCaptureClient,
  type SerpCaptureResult,
} from '@/lib/seo-intelligence/serp-capture'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/keyword-snapshots-weekly
 *
 * Weekly cron — stores DataForSEO ranked keyword snapshots for every client
 * with a configured domain. P12.I.9 uses this table for New/Lost/Improved/
 * Declined position changes.
 *
 * Step 2 (DataForSEO 计划 阶段 1): weekly SERP capture per client — writes
 * local_pack_rank onto today's keyword_snapshots rows and AI Overview /
 * top-organic-domain snapshots into serp_ai_overview_snapshots.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 900

interface ClientRow {
  id: string
  domain: string | null
  semrush_db: string | null
  name: string | null
  brand_aliases: string[] | null
}

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

  const cronRun = await startCronRun('keyword-snapshots-weekly')

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db, name, brand_aliases')
    .eq('client_status', 'active')
    .not('domain', 'is', null)

  if (clientErr) {
    await cronRun.finish({ failed: 1, error: clientErr.message })
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 },
    )
  }

  const eligibleClients: SerpCaptureClient[] = ((clients ?? []) as ClientRow[])
    .filter((c): c is ClientRow & KeywordSnapshotClient =>
      typeof c.id === 'string' &&
      typeof c.domain === 'string' &&
      c.domain.trim().length > 0
    )
    .map(c => ({
      id: c.id,
      domain: c.domain,
      semrush_db: c.semrush_db,
      name: c.name ?? '',
      brand_aliases: c.brand_aliases ?? null,
    }))

  if (eligibleClients.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({
      success: true,
      message: 'No clients with a domain — nothing to snapshot',
      clients_processed: 0,
      snapshots_written: 0,
      failed: 0,
      results: [],
    })
  }

  const results: Array<{
    client_id: string
    domain: string
    location_code?: number
    keywords_seen: number
    snapshots_written: number
    serp?: SerpCaptureResult
    serp_error?: string
    error?: string
  }> = []

  for (const client of eligibleClients) {
    try {
      const result = await snapshotRankedKeywordsForClient(client)

      // Step 2 — SERP capture rides on the fresh snapshot. Its failure must
      // not undo step 1 (snapshots already written), so it's caught separately.
      try {
        const serp = await captureSerpForClient(client)
        results.push({ ...result, serp })
      } catch (serpErr) {
        results.push({
          ...result,
          serp_error: serpErr instanceof Error ? serpErr.message : 'Unknown error',
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.push({
        client_id: client.id,
        domain: client.domain,
        keywords_seen: 0,
        snapshots_written: 0,
        error: message,
      })
    }
  }

  const totalWritten = results.reduce((sum, r) => sum + r.snapshots_written, 0)
  const serpRowsWritten = results.reduce((sum, r) => sum + (r.serp?.serp_rows_written ?? 0), 0)
  const localPackHits = results.reduce((sum, r) => sum + (r.serp?.local_pack_hits ?? 0), 0)
  const failedCount = results.filter(r => r.error !== undefined).length
  const serpFailedCount = results.filter(r => r.serp_error !== undefined).length

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failedCount,
    failed: failedCount,
    summary: {
      snapshots_written: totalWritten,
      serp_rows_written: serpRowsWritten,
      local_pack_hits: localPackHits,
      serp_failed_clients: serpFailedCount,
    },
  })
  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    snapshots_written: totalWritten,
    serp_rows_written: serpRowsWritten,
    failed: failedCount,
    serp_failed: serpFailedCount,
    results,
  })
}
