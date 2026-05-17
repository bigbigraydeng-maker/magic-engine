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
        expected_metric: input.expectedMetric ?? null,
        expected_delta: input.expectedDelta ?? null,
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
      expectedMetric: data.expected_metric ?? undefined,
      expectedDelta: data.expected_delta ?? undefined,
      executedAt: data.executed_at,
    }
  }

  // Stub — P12.A.7 will pull real GEO metrics from the AI Tracker results.
  async pullMetrics(_clientId: string, _since?: Date): Promise<FlywheelMetricRow[]> {
    return []
  }
}

registerAdapter(new GeoComposerAdapter())
