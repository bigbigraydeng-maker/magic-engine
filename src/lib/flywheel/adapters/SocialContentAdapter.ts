/**
 * SocialContentAdapter — in_house / third_party FlywheelAdapter for the Social flywheel.
 *
 * P12.B.3:
 *   execute()     — records a social action in flywheel_actions and returns the row.
 *   pullMetrics() — counts published / scheduled content_posts and writes them to
 *                   flywheel_metrics.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { isValidSocialActionType, SOCIAL_METRIC_KEY } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class SocialContentAdapter implements FlywheelAdapter {
  readonly flywheel = 'social' as const

  async execute(input: ExecuteActionInput): Promise<FlywheelActionRow> {
    if (!isValidSocialActionType(input.actionType)) {
      throw new Error(
        `Unknown Social action_type: "${input.actionType}". ` +
          `Valid values are defined in SOCIAL_ACTION_TYPE (vocabulary.ts).`
      )
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id:         input.clientId,
        execution_item_id: input.executionItemId ?? null,
        flywheel:          'social',
        action_type:       input.actionType,
        execution_mode:    input.executionMode,
        vendor:            input.vendor ?? null,
        payload:           input.payload ?? null,
        expected_metric:        input.expectedMetric      ?? null,
        expected_delta:         input.expectedDelta       ?? null,
        production_package_id:  input.productionPackageId ?? null,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`SocialContentAdapter.execute DB error: ${error.message}`)
    }

    return {
      id:                   data.id,
      clientId:             data.client_id,
      executionItemId:      data.execution_item_id       ?? undefined,
      flywheel:             'social',
      actionType:           data.action_type,
      executionMode:        data.execution_mode,
      vendor:               data.vendor                  ?? undefined,
      payload:              data.payload                 ?? undefined,
      expectedMetric:       data.expected_metric         ?? undefined,
      expectedDelta:        data.expected_delta          ?? undefined,
      executedAt:           data.executed_at,
      productionPackageId:  data.production_package_id   ?? undefined,
    }
  }

  /**
   * Pull social metrics for a client:
   *   1. Count content_posts with status = 'published'.
   *   2. Count content_posts with status = 'scheduled'.
   *   3. Write both rows to flywheel_metrics.
   */
  async pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]> {
    const now = new Date().toISOString()

    const [publishedResult, scheduledResult] = await Promise.allSettled([
      this.countPosts(clientId, 'published', since),
      this.countPosts(clientId, 'scheduled', since),
    ])

    const toInsert: object[] = []
    const returned: FlywheelMetricRow[] = []

    const push = (metricKey: string, metricValue: number) => {
      toInsert.push({
        client_id:    clientId,
        flywheel:     'social',
        metric_key:   metricKey,
        metric_value: metricValue,
        source:       'content_posts',
        source_ref:   { client_id: clientId },
        measured_at:  now,
      })
      returned.push({
        id:          '',
        clientId,
        flywheel:    'social',
        metricKey,
        metricValue,
        source:      'content_posts',
        sourceRef:   { client_id: clientId },
        measuredAt:  now,
      })
    }

    if (publishedResult.status === 'fulfilled') {
      push(SOCIAL_METRIC_KEY.PUBLISHED_COUNT, publishedResult.value)
    }
    if (scheduledResult.status === 'fulfilled') {
      push(SOCIAL_METRIC_KEY.SCHEDULED_COUNT, scheduledResult.value)
    }

    if (toInsert.length === 0) return []

    const { error } = await supabaseAdmin.from('flywheel_metrics').insert(toInsert)
    if (error) {
      console.error('[SocialContentAdapter] pullMetrics insert error:', error.message)
    }

    return returned
  }

  private async countPosts(clientId: string, status: string, since?: Date): Promise<number> {
    let query = supabaseAdmin
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', status)

    if (since) {
      query = query.gte('created_at', since.toISOString())
    }

    const { count } = await query
    return count ?? 0
  }
}

registerAdapter(new SocialContentAdapter())
