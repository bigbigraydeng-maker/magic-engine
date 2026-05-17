/**
 * Write AI Tracker results into flywheel_metrics.
 *
 * Called by the AI Tracker orchestrator after each successful run.
 * Writes up to 3 GEO metric rows per run:
 *   - geo.query.mention_rate   (always)
 *   - geo.engine.coverage      (always)
 *   - geo.query.avg_rank       (only when brand was mentioned at least once)
 *
 * Reference: ROADMAP.md P12.A.7
 */

import { supabaseAdmin } from '../../supabase'
import { GEO_METRIC_KEY } from '../vocabulary'

export interface TrackerMetricInput {
  /** Snapshot id for source_ref traceability (null if snapshot upsert failed) */
  snapshotId: string | null
  /** Number of (query, engine) pairs where the client brand was ranked */
  mentionsCount: number
  /** Total successful (query, engine) pairs in this pass */
  totalRuns: number
  /** Mean ranking position across all mentions (null = brand never appeared) */
  avgRank: number | null
  /** Count of distinct AI engines where brand appeared at least once */
  engineCoverage: number
}

export async function writeTrackerFlywheelMetrics(
  clientId: string,
  data: TrackerMetricInput
): Promise<void> {
  if (data.totalRuns === 0) return

  const mentionRate = data.mentionsCount / data.totalRuns
  const now = new Date().toISOString()
  const sourceRef = data.snapshotId
    ? { snapshot_id: data.snapshotId }
    : undefined

  type MetricInsert = {
    client_id: string
    flywheel: 'geo'
    metric_key: string
    metric_value: number
    source: string
    source_ref?: Record<string, unknown>
    measured_at: string
  }

  const rows: MetricInsert[] = [
    {
      client_id: clientId,
      flywheel: 'geo',
      metric_key: GEO_METRIC_KEY.QUERY_MENTION_RATE,
      metric_value: mentionRate,
      source: 'ai_tracker',
      source_ref: sourceRef,
      measured_at: now,
    },
    {
      client_id: clientId,
      flywheel: 'geo',
      metric_key: GEO_METRIC_KEY.ENGINE_COVERAGE,
      metric_value: data.engineCoverage,
      source: 'ai_tracker',
      source_ref: sourceRef,
      measured_at: now,
    },
  ]

  if (data.avgRank !== null) {
    rows.push({
      client_id: clientId,
      flywheel: 'geo',
      metric_key: GEO_METRIC_KEY.QUERY_AVG_RANK,
      metric_value: data.avgRank,
      source: 'ai_tracker',
      source_ref: sourceRef,
      measured_at: now,
    })
  }

  const { error } = await supabaseAdmin.from('flywheel_metrics').insert(rows)

  if (error) {
    // Non-fatal — tracker data is already in ai_visibility_runs/snapshots
    console.error('[writeTrackerFlywheelMetrics] DB error:', error.message)
  }
}
