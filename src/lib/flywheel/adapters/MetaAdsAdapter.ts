/**
 * MetaAdsAdapter — third_party FlywheelAdapter for the Ads flywheel.
 *
 * P12.B.2:
 *   execute()     — records an Ads action in flywheel_actions and returns the row.
 *   pullMetrics() — reads the latest meta_ads_snapshots row for the client and
 *                   writes ROAS / spend / impressions / clicks / cpc / ctr /
 *                   conversions to flywheel_metrics.
 *
 * Data flow:
 *   Meta Graph API → /api/clients/[id]/meta-ads/sync → meta_ads_snapshots
 *                                                      ↗
 *                          MetaAdsAdapter.pullMetrics()
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { isValidAdsActionType, ADS_METRIC_KEY } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class MetaAdsAdapter implements FlywheelAdapter {
  readonly flywheel = 'ads' as const

  async execute(input: ExecuteActionInput): Promise<FlywheelActionRow> {
    if (!isValidAdsActionType(input.actionType)) {
      throw new Error(
        `Unknown Ads action_type: "${input.actionType}". ` +
          `Valid values are defined in ADS_ACTION_TYPE (vocabulary.ts).`
      )
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id: input.clientId,
        execution_item_id: input.executionItemId ?? null,
        flywheel: 'ads',
        action_type: input.actionType,
        execution_mode: input.executionMode,
        vendor: input.vendor ?? 'meta',
        payload: input.payload ?? null,
        expected_metric: input.expectedMetric ?? null,
        expected_delta: input.expectedDelta ?? null,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`MetaAdsAdapter.execute DB error: ${error.message}`)
    }

    return {
      id: data.id,
      clientId: data.client_id,
      executionItemId: data.execution_item_id ?? undefined,
      flywheel: 'ads',
      actionType: data.action_type,
      executionMode: data.execution_mode,
      vendor: data.vendor ?? undefined,
      payload: data.payload ?? undefined,
      expectedMetric: data.expected_metric ?? undefined,
      expectedDelta: data.expected_delta ?? undefined,
      executedAt: data.executed_at,
    }
  }

  /**
   * Read the latest meta_ads_snapshots row for the client and write
   * its metrics to flywheel_metrics.
   *
   * Returns [] if no snapshot exists (Meta sync not yet run for this client).
   */
  async pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]> {
    let query = supabaseAdmin
      .from('meta_ads_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('fetched_at', { ascending: false })
      .limit(1)

    if (since) {
      query = query.gte('fetched_at', since.toISOString())
    }

    const { data, error } = await query.maybeSingle()

    if (error || !data) return []

    const now = new Date().toISOString()
    const base = {
      clientId,
      flywheel: 'ads' as const,
      source: 'meta_ads',
      sourceRef: {
        snapshot_id: data.id as string,
        ad_account_id: data.ad_account_id as string,
        period_start: data.period_start as string,
        period_end: data.period_end as string,
      },
      measuredAt: now,
    }

    type MetricEntry = { key: string; value: number | null }
    const candidates: MetricEntry[] = [
      { key: ADS_METRIC_KEY.ROAS,        value: data.roas        as number | null },
      { key: ADS_METRIC_KEY.SPEND,       value: data.spend       as number | null },
      { key: ADS_METRIC_KEY.IMPRESSIONS, value: data.impressions as number | null },
      { key: ADS_METRIC_KEY.CLICKS,      value: data.clicks      as number | null },
      { key: ADS_METRIC_KEY.CPC,         value: data.cpc         as number | null },
      { key: ADS_METRIC_KEY.CTR,         value: data.ctr         as number | null },
      { key: ADS_METRIC_KEY.CONVERSIONS, value: data.conversions as number | null },
    ]

    const toInsert: object[] = []
    const returned: FlywheelMetricRow[] = []

    for (const { key, value } of candidates) {
      if (value === null || value === undefined) continue
      toInsert.push({
        client_id: clientId,
        flywheel: 'ads',
        metric_key: key,
        metric_value: value,
        source: 'meta_ads',
        source_ref: base.sourceRef,
        measured_at: now,
      })
      returned.push({ id: '', ...base, metricKey: key, metricValue: value })
    }

    if (toInsert.length === 0) return []

    const { error: insertErr } = await supabaseAdmin
      .from('flywheel_metrics')
      .insert(toInsert)

    if (insertErr) {
      console.error('[MetaAdsAdapter] pullMetrics insert error:', insertErr.message)
    }

    return returned
  }
}

registerAdapter(new MetaAdsAdapter())
