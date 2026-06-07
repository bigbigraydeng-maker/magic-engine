import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  snapshotRankedKeywordsForClient,
  type KeywordSnapshotClient,
} from '@/lib/seo-intelligence/keyword-snapshots'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/keyword-snapshots-weekly
 *
 * Weekly cron — stores DataForSEO ranked keyword snapshots for every client
 * with a configured domain. P12.I.9 uses this table for New/Lost/Improved/
 * Declined position changes.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 900

interface ClientRow {
  id: string
  domain: string | null
  semrush_db: string | null
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

  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db')
    .not('domain', 'is', null)

  if (clientErr) {
    await cronRun.finish({ failed: 1, error: clientErr.message })
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 },
    )
  }

  const eligibleClients = ((clients ?? []) as ClientRow[])
    .filter((c): c is KeywordSnapshotClient =>
      typeof c.id === 'string' &&
      typeof c.domain === 'string' &&
      c.domain.trim().length > 0
    )

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
    error?: string
  }> = []

  for (const client of eligibleClients) {
    try {
      const result = await snapshotRankedKeywordsForClient(client)
      results.push(result)
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
  const failedCount = results.filter(r => r.error !== undefined).length

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failedCount,
    failed: failedCount,
    summary: { snapshots_written: totalWritten },
  })
  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    snapshots_written: totalWritten,
    failed: failedCount,
    results,
  })
}
