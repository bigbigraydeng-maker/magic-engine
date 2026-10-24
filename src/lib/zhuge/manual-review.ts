/**
 * Persist an unregistered 诸葛亮 recommendation as manual review.
 *
 * The row is intentionally NOT `pending`. Pending cards re-enter the
 * execution picker; an invented action type must not.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension } from './types'
import {
  MANUAL_REVIEW_ACTION_TYPE,
  MANUAL_REVIEW_DISPOSITION,
} from './action-vocabulary'

export interface ManualReviewInsert {
  dimension: DiagnosticDimension
  inventedActionType: string
  why: string
  source: 'zhuge' | 'proactive_signal'
  prescriptionId?: string | null
  zhugeSessionId?: string | null
  sortOrder?: number
  metadata?: Record<string, unknown>
}

interface ExistingReviewRow {
  id: string
  steps_json: Record<string, unknown> | null
}

function inventedOf(steps: Record<string, unknown> | null): string {
  const raw = steps?.invented_action_type
  return typeof raw === 'string' ? raw : ''
}

/** Rows to insert. The insert itself stays in action-persister (grandfathered writer). */
export async function buildManualReviewRows(
  supabase: SupabaseClient,
  clientId: string,
  items: ManualReviewInsert[],
): Promise<Array<Record<string, unknown>>> {
  if (items.length === 0) return []

  const { data, error } = await supabase
    .from('execution_items')
    .select('id, steps_json')
    .eq('client_id', clientId)
    .eq('status', 'skipped')
    .eq('action_type', MANUAL_REVIEW_ACTION_TYPE)
    .in('action_type', [MANUAL_REVIEW_ACTION_TYPE])

  if (error) throw new Error(`manual review lookup failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as ExistingReviewRow[]) {
    if (row.steps_json?.disposition === MANUAL_REVIEW_DISPOSITION) {
      seen.add(inventedOf(row.steps_json))
    }
  }

  const fresh: ManualReviewInsert[] = []
  for (const item of items) {
    const key = item.inventedActionType.trim() || MANUAL_REVIEW_ACTION_TYPE
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push(item)
  }

  return fresh.map((item) => ({
    prescription_id: item.prescriptionId ?? null,
    client_id: clientId,
    finding_id: null,
    dimension: item.dimension,
    title: `要人工看：${item.inventedActionType || '未命名动作'}`,
    description: item.why || '模型给了一个系统不认识的动作，没有排进待办。',
    fix_type: 'fde_manual' as const,
    action_type: MANUAL_REVIEW_ACTION_TYPE,
    status: 'skipped' as const,
    source: item.source,
    zhuge_session_id: item.zhugeSessionId ?? null,
    sort_order: item.sortOrder ?? 0,
    steps_json: {
      ...(item.metadata ?? {}),
      disposition: MANUAL_REVIEW_DISPOSITION,
      invented_action_type: item.inventedActionType,
    },
  }))
}
