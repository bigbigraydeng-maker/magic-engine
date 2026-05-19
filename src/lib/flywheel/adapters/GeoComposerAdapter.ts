/**
 * GeoComposerAdapter — in_house FlywheelAdapter for the GEO flywheel.
 *
 * P12.A.4: execute() writes a row to flywheel_actions and returns it.
 *          pullMetrics() is a stub — P12.A.7 will connect it to AI Tracker.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { isValidGeoActionType } from '../vocabulary'
import { writeTrackerFlywheelMetrics } from '../metrics/writeTrackerMetrics'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class GeoComposerAdapter implements FlywheelAdapter {
  readonly flywheel = 'geo' as const

  async execute(input: ExecuteActionInput): Promise<FlywheelActionRow> {
    if (input.executionMode !== 'in_house') {
      throw new Error(
        `GeoComposerAdapter only handles in_house actions. ` +
          `Received executionMode="${input.executionMode}".`
      )
    }

    if (!isValidGeoActionType(input.actionType)) {
      throw new Error(
        `Unknown GEO action_type: "${input.actionType}". ` +
          `Valid values are defined in GEO_ACTION_TYPE (vocabulary.ts).`
      )
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id: input.clientId,
        execution_item_id: input.executionItemId ?? null,
        flywheel: 'geo',
        action_type: input.actionType,
        execution_mode: 'in_house',
        vendor: input.vendor ?? null,
        payload: input.payload ?? null,
        expected_metric:        input.expectedMetric        ?? null,
        expected_delta:         input.expectedDelta         ?? null,
        production_package_id:  input.productionPackageId   ?? null,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`GeoComposerAdapter.execute DB error: ${error.message}`)
    }

    return {
      id: data.id,
      clientId: data.client_id,
      executionItemId: data.execution_item_id ?? undefined,
      flywheel: 'geo',
      actionType: data.action_type,
      executionMode: data.execution_mode,
      vendor: data.vendor ?? undefined,
      payload: data.payload ?? undefined,
      expectedMetric:       data.expected_metric          ?? undefined,
      expectedDelta:        data.expected_delta            ?? undefined,
      executedAt:           data.executed_at,
      productionPackageId:  data.production_package_id    ?? undefined,
    }
  }

  /**
   * Pull GEO metrics from the latest ai_visibility_snapshots row and write
   * them to flywheel_metrics. Called by the metrics-cron job.
   *
   * Uses the most recent snapshot (any week) unless `since` is provided.
   */
  async pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]> {
    let query = supabaseAdmin
      .from('ai_visibility_snapshots')
      .select('id, week_of, avg_rank, mentions_count, total_runs, models_covered, created_at')
      .eq('client_id', clientId)
      .order('week_of', { ascending: false })
      .limit(1)

    if (since) {
      query = query.gte('created_at', since.toISOString())
    }

    const { data, error } = await query.maybeSingle()

    if (error || !data) return []

    // Recompute engine_coverage: we only have models_covered here (not per-run
    // engine-level data), so use model count as a lower-bound proxy.
    const engineCoverage: number = Array.isArray(data.models_covered)
      ? data.models_covered.length
      : 0

    await writeTrackerFlywheelMetrics(clientId, {
      snapshotId: data.id as string,
      mentionsCount: (data.mentions_count as number) ?? 0,
      totalRuns: (data.total_runs as number) ?? 0,
      avgRank: (data.avg_rank as number | null) ?? null,
      engineCoverage,
    })

    // Return the rows that were written (re-query would add latency; return
    // a minimal representation for the caller to log/inspect).
    const now = new Date().toISOString()
    const base = {
      clientId,
      flywheel: 'geo' as const,
      source: 'ai_tracker',
      sourceRef: { snapshot_id: data.id },
      measuredAt: now,
    }
    const total = (data.total_runs as number) ?? 0
    const mentions = (data.mentions_count as number) ?? 0
    if (total === 0) return []

    const rows: FlywheelMetricRow[] = [
      { ...base, id: '', metricKey: 'geo.query.mention_rate', metricValue: mentions / total },
      { ...base, id: '', metricKey: 'geo.engine.coverage',    metricValue: engineCoverage  },
    ]
    if (data.avg_rank !== null) {
      rows.push({ ...base, id: '', metricKey: 'geo.query.avg_rank', metricValue: data.avg_rank as number })
    }
    return rows
  }
}

registerAdapter(new GeoComposerAdapter())
