/**
 * Ga4Adapter — SEO flywheel adapter for Google Analytics 4 traffic data.
 *
 * P22.A.2:
 *   pullMetrics() — reads the latest ga4_traffic_snapshots row for the client
 *                   and writes sessions / users / pageviews / avg_session_duration /
 *                   bounce_rate to flywheel_metrics.
 *
 * Data flow:
 *   GA4 Reporting API → /api/cron/google-data-pullback-daily → ga4_traffic_snapshots
 *                                                               ↗
 *                              Ga4Adapter.pullMetrics()
 *
 * This adapter is intentionally read-only (no execute() — GA4 is analytics-only,
 * not an execution platform). Only pullMetrics() is implemented.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { SEO_METRIC_KEY } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class Ga4Adapter implements FlywheelAdapter {
  readonly flywheel = 'seo' as const

  /**
   * GA4 is analytics-only — execution is not supported.
   * Throws to satisfy the FlywheelAdapter interface contract.
   */
  async execute(_input: ExecuteActionInput): Promise<FlywheelActionRow> {
    throw new Error('Ga4Adapter does not support execute() — GA4 is read-only analytics data.')
  }

  /**
   * Read the latest ga4_traffic_snapshots row for the client and write
   * sessions / users / pageviews / avg_session_duration / bounce_rate to flywheel_metrics.
   *
   * Returns [] if no snapshot exists (GA4 sync not yet run for this client).
   */
  async pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]> {
    let query = supabaseAdmin
      .from('ga4_traffic_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('synced_at', { ascending: false })

    if (since) {
      query = query.gte('synced_at', since.toISOString())
    }

    const { data, error } = await query.limit(1).maybeSingle()

    if (error || !data) return []

    const now = new Date().toISOString()
    const base = {
      clientId,
      flywheel: 'seo' as const,
      source: 'ga4',
      sourceRef: {
        snapshot_id:  data.id as string,
        property_id:  data.property_id as string,
        period_start: data.period_start as string,
        period_end:   data.period_end as string,
      },
      measuredAt: now,
    }

    type MetricEntry = { key: string; value: number | null }
    const candidates: MetricEntry[] = [
      { key: SEO_METRIC_KEY.GA4_SESSIONS,              value: data.total_sessions       as number | null },
      { key: SEO_METRIC_KEY.GA4_USERS,                 value: data.total_users          as number | null },
      { key: SEO_METRIC_KEY.GA4_PAGEVIEWS,             value: data.total_pageviews      as number | null },
      { key: SEO_METRIC_KEY.GA4_AVG_SESSION_DURATION,  value: data.avg_session_duration as number | null },
      { key: SEO_METRIC_KEY.GA4_BOUNCE_RATE,           value: data.bounce_rate          as number | null },
    ]

    const toInsert: object[] = []
    const returned: FlywheelMetricRow[] = []

    for (const { key, value } of candidates) {
      if (value === null || value === undefined) continue
      toInsert.push({
        client_id:    clientId,
        flywheel:     'seo',
        metric_key:   key,
        metric_value: value,
        source:       'ga4',
        source_ref:   base.sourceRef,
        measured_at:  now,
      })
      returned.push({ id: '', ...base, metricKey: key, metricValue: value })
    }

    if (toInsert.length === 0) return []

    const { error: insertErr } = await supabaseAdmin
      .from('flywheel_metrics')
      .upsert(toInsert, {
        onConflict: 'client_id,metric_key,measured_at',
        ignoreDuplicates: true,
      })

    if (insertErr) {
      console.error('[Ga4Adapter] pullMetrics upsert error:', insertErr.message)
    }

    return returned
  }
}

registerAdapter(new Ga4Adapter())
