/**
 * P13.E: Flywheel feedback 闭环 — package-publish hook
 *
 * When a production package transitions to "published", this function logs
 * a flywheel_action directly (bypassing the adapter dispatch layer for
 * simplicity — the adapter's execute() validates action_type against the
 * vocabulary, but auto-publish actions are internal and always valid).
 *
 * Dimension → flywheel + action_type mapping (mirrors execution_items backfill
 * in 20260517000001_flywheel_data_skeleton.sql):
 *   seo           → seo   / seo.publish_blog
 *   ai_visibility → geo   / geo.deploy_directive
 *   ads           → ads   / ads.meta_snapshot
 *   social        → social/ social.publish_post
 *   reputation    → skip  (external_manual, no flywheel ingest)
 *   competitor    → skip  (external_manual, no flywheel ingest)
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { FlywheelName } from '@/lib/flywheel/adapters/types'
import { assertAdsExpectedMetric } from '@/lib/flywheel/metric-registry'
import { resolveClientAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'

type DiagnosticDimension =
  | 'seo'
  | 'ai_visibility'
  | 'ads'
  | 'social'
  | 'reputation'
  | 'competitor'

interface DimensionMapping {
  flywheel: FlywheelName
  actionType: string
  executionMode: 'in_house' | 'third_party'
  /**
   * null = resolved per client at write time. The ads dimension has no campaign
   * context here, and its old hard-coded `ads.account.roas` was wrong for every
   * client that does not sell online — a Messenger lead-gen account never
   * accumulates a ROAS row, so the promise could never be redeemed.
   */
  expectedMetric: string | null
}

const DIMENSION_MAP: Partial<Record<DiagnosticDimension, DimensionMapping>> = {
  seo: {
    flywheel:       'seo',
    actionType:     'seo.publish_blog',
    executionMode:  'in_house',
    expectedMetric: 'seo.domain.organic_traffic',
  },
  ai_visibility: {
    flywheel:       'geo',
    actionType:     'geo.deploy_directive',
    executionMode:  'in_house',
    expectedMetric: 'geo.query.mention_rate',
  },
  ads: {
    flywheel:       'ads',
    actionType:     'ads.meta_snapshot',
    executionMode:  'third_party',
    expectedMetric: null,   // resolved from the client's actual ads outcome data
  },
  social: {
    flywheel:       'social',
    actionType:     'social.publish_post',
    executionMode:  'in_house',
    expectedMetric: 'social.posts.published_count',
  },
  // reputation + competitor: external_manual, no flywheel ingest
}

export interface PackagePublishInput {
  packageId:        string
  clientId:         string
  dimension:        string
  executionItemId?: string
}

/**
 * Logs a flywheel_action for a newly-published production package.
 *
 * Returns the created action id on success, null if the dimension is not
 * mapped to a flywheel (reputation / competitor).
 *
 * Non-throwing: errors are logged and surfaced as null so callers can
 * treat this as a non-blocking side-effect.
 */
export async function logPackagePublishedAction(
  input: PackagePublishInput,
): Promise<string | null> {
  const mapping = DIMENSION_MAP[input.dimension as DiagnosticDimension]
  if (!mapping) return null   // reputation / competitor — skip silently

  try {
    const expectedMetric = mapping.flywheel === 'ads'
      ? await resolveClientAdsExpectedMetric(supabaseAdmin, input.clientId)
      : mapping.expectedMetric

    // Reconciliation gate: never promise a metric nothing pulls. Deliberately
    // OUTSIDE the DB insert — a bad mapping is a code bug and must surface, not
    // become another silently-unattributable row.
    if (mapping.flywheel === 'ads') {
      assertAdsExpectedMetric(expectedMetric, 'logPackagePublishedAction')
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id:             input.clientId,
        execution_item_id:     input.executionItemId ?? null,
        flywheel:              mapping.flywheel,
        action_type:           mapping.actionType,
        execution_mode:        mapping.executionMode,
        vendor:                null,
        payload:               { triggered_by: 'package_publish', package_id: input.packageId },
        expected_metric:       expectedMetric,
        expected_delta:        null,
        production_package_id: input.packageId,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[logPackagePublishedAction] DB error:', error.message)
      return null
    }

    return data.id as string
  } catch (err) {
    console.error('[logPackagePublishedAction] unexpected:', err)
    return null
  }
}
