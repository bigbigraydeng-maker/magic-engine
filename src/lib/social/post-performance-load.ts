// Read-only loader for the post-performance report.
//
// Scope: Story + image-Post slice only. Reel publish actions are read from
// flywheel_actions but excluded by the pure builder (buildPostPerformanceReport).
// All data comes from existing tables; no new table is introduced.
//
// This module performs SELECT queries only. Any database error is thrown so a
// failure can never be silently rendered as an empty "0" report.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_PUBLISH_ACTION_TYPE } from './post-measurement-store'
import {
  buildPostPerformanceReport,
  type PostPerformanceReport,
  type ReceiptRow,
  type PublishActionRow,
  type StoryRow,
  type PageMetricRow,
} from './post-performance'
import type { SocialPlatform } from './platforms'

export const DEFAULT_POST_PERFORMANCE_LIMIT = 20
const MAX_ROWS = 200
const MAX_PAGE_METRIC_ROWS = 500

/** Shape of a Supabase query result we care about (client is untyped here). */
interface QueryResult {
  data: unknown
  error: { message: string } | null
}

/**
 * Convert an untyped `data` payload into a typed row array.
 * The Supabase client is untyped at this boundary (rows are `any`); callers
 * supply the expected row type.
 */
function toRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return []
  return data
}

/** Throw a descriptive error when a query failed. */
function assertNoError(table: string, result: QueryResult): void {
  if (result.error) {
    throw new Error(`loadPostPerformance: ${table} query failed — ${result.error.message}`)
  }
}

export async function loadPostPerformance(
  supabase: SupabaseClient,
  input: {
    clientId: string
    since: Date
    until: Date
    limit?: number
    connectedPlatforms?: readonly SocialPlatform[]
  },
): Promise<PostPerformanceReport> {
  const sinceIso = input.since.toISOString()
  const untilIso = input.until.toISOString()

  // Steps 1, 3, 4 run in parallel; step 2 depends on step 1's ids.
  const actionsPromise = supabase
    .from('flywheel_actions')
    .select('id, executed_at, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
    .gte('executed_at', sinceIso)
    .lte('executed_at', untilIso)
    .order('executed_at', { ascending: false })
    .limit(MAX_ROWS)

  const storiesPromise = supabase
    .from('story_items')
    .select('item_id, channel, status, sent_at, slot_at')
    .eq('client_id', input.clientId)
    .eq('status', 'SENT')
    .gte('sent_at', sinceIso)
    .lte('sent_at', untilIso)
    .order('sent_at', { ascending: false })
    .limit(MAX_ROWS)

  const pageMetricsPromise = supabase
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at')
    .eq('client_id', input.clientId)
    .like('metric_key', 'social.fb.%')
    .gte('measured_at', sinceIso)
    .lte('measured_at', untilIso)
    .order('measured_at', { ascending: false })
    .limit(MAX_PAGE_METRIC_ROWS)

  const [actionsResult, storiesResult, pageMetricsResult] = await Promise.all([
    actionsPromise,
    storiesPromise,
    pageMetricsPromise,
  ])

  assertNoError('flywheel_actions', actionsResult)
  assertNoError('story_items', storiesResult)
  assertNoError('flywheel_metrics', pageMetricsResult)

  const actions = toRows<PublishActionRow>(actionsResult.data)
  const stories = toRows<StoryRow>(storiesResult.data)
  const pageMetrics = toRows<PageMetricRow>(pageMetricsResult.data)

  // Step 2: receipts, only when there is at least one action to look up.
  let receipts: ReceiptRow[] = []
  if (actions.length > 0) {
    const ids = actions.map((a) => a.id)
    const receiptsResult = await supabase
      .from('social_post_measurement_receipts')
      .select('action_id, window_hours, status, measured_at, values, missing, reason')
      .eq('client_id', input.clientId)
      .in('action_id', ids)

    assertNoError('social_post_measurement_receipts', receiptsResult)
    receipts = toRows<ReceiptRow>(receiptsResult.data)
  }

  return buildPostPerformanceReport({
    clientId: input.clientId,
    since: sinceIso,
    until: untilIso,
    limit: input.limit ?? DEFAULT_POST_PERFORMANCE_LIMIT,
    actions,
    receipts,
    stories,
    pageMetrics,
    connectedPlatforms: input.connectedPlatforms,
  })
}
