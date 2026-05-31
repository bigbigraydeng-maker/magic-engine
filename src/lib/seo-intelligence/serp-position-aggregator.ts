/**
 * Aggregate SERP position metrics from keyword_snapshots → flywheel_metrics.
 *
 * Reads the most recent keyword_snapshots batch for a client and derives:
 *   - seo.serp.avg_position   — mean ranking position (lower = better)
 *   - seo.serp.top10_count    — number of keywords ranked ≤ 10
 *
 * Called by SeoContentAdapter.pullMetrics() as part of the weekly SEO cron.
 * P22.A.2: provides the AnomalyDetector (22.D.1) its primary SEO signal.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import type { FlywheelMetricRow } from '@/lib/flywheel/adapters/types'

export interface SerpPositionResult {
  snapshotDate: string | null
  keywordsRanked: number
  avgPosition: number | null
  top10Count: number
  metricsWritten: number
}

/**
 * Aggregate the latest keyword_snapshots batch for `clientId` and write
 * avg_position + top10_count to flywheel_metrics.
 *
 * Returns a summary; non-fatal on DB errors (logs and returns zeros).
 */
export async function aggregateSerpPositionMetrics(
  clientId: string,
): Promise<SerpPositionResult & { rows: FlywheelMetricRow[] }> {
  const empty = { snapshotDate: null, keywordsRanked: 0, avgPosition: null, top10Count: 0, metricsWritten: 0, rows: [] }

  // Find the most recent snapshot_date for this client
  const { data: latest, error: latestErr } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr || !latest) return empty

  const snapshotDate = latest.snapshot_date as string

  // Pull all keywords for that snapshot date (position may be null = not ranked)
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('position')
    .eq('client_id', clientId)
    .eq('snapshot_date', snapshotDate)

  if (rowsErr || !rows || rows.length === 0) return empty

  const positions = (rows as Array<{ position: number | null }>)
    .map(r => r.position)
    .filter((p): p is number => typeof p === 'number' && p > 0)

  if (positions.length === 0) return { ...empty, snapshotDate, keywordsRanked: rows.length }

  const avgPosition = positions.reduce((s, p) => s + p, 0) / positions.length
  const top10Count = positions.filter(p => p <= 10).length

  const now = new Date().toISOString()
  const sourceRef = { snapshot_date: snapshotDate, keywords_ranked: positions.length }

  const toInsert = [
    {
      client_id: clientId,
      flywheel: 'seo',
      metric_key: SEO_METRIC_KEY.SERP_AVG_POSITION,
      metric_value: Math.round(avgPosition * 100) / 100,
      source: 'keyword_snapshots',
      source_ref: sourceRef,
      measured_at: now,
    },
    {
      client_id: clientId,
      flywheel: 'seo',
      metric_key: SEO_METRIC_KEY.SERP_TOP10_COUNT,
      metric_value: top10Count,
      source: 'keyword_snapshots',
      source_ref: sourceRef,
      measured_at: now,
    },
  ]

  const { error: insertErr } = await supabaseAdmin.from('flywheel_metrics').insert(toInsert)
  if (insertErr) {
    console.error('[aggregateSerpPositionMetrics] insert error:', insertErr.message)
  }

  const metricRows: FlywheelMetricRow[] = toInsert.map(r => ({
    id: '',
    clientId,
    flywheel: 'seo' as const,
    metricKey: r.metric_key,
    metricValue: r.metric_value,
    source: r.source,
    sourceRef: r.source_ref,
    measuredAt: now,
  }))

  return {
    snapshotDate,
    keywordsRanked: positions.length,
    avgPosition: Math.round(avgPosition * 100) / 100,
    top10Count,
    metricsWritten: insertErr ? 0 : 2,
    rows: metricRows,
  }
}
