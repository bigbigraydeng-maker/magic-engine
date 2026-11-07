/**
 * Load rows for the social readback panel (SELECT-only, same tables as loadPostPerformance).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  SOCIAL_PUBLISH_ACTION_TYPE,
  SOCIAL_PUBLISH_STORY_ACTION_TYPE,
} from '@/lib/social/post-measurement-store'
import type {
  PublishActionRow,
  ReceiptRow,
  StoryRow,
} from '@/lib/social/post-performance'
import {
  buildSocialReadbackPanel,
  READBACK_DEFAULT_DAYS,
  type SocialReadbackPanel,
} from '@/lib/social/social-readback-panel'

export const DEFAULT_SOCIAL_READBACK_LIMIT = 20
const MAX_ROWS = 200

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

function toRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return []
  return data
}

function assertNoError(table: string, result: QueryResult): void {
  if (result.error) {
    throw new Error(`loadSocialReadbackPanel: ${table} query failed — ${result.error.message}`)
  }
}

export function defaultReadbackWindow(now: Date): { since: Date; until: Date } {
  const until = now
  const since = new Date(now.getTime() - READBACK_DEFAULT_DAYS * 24 * 60 * 60 * 1000)
  return { since, until }
}

export async function loadSocialReadbackPanel(
  supabase: SupabaseClient,
  input: {
    clientId: string
    since: Date
    until: Date
    limit?: number
    now?: Date
  },
): Promise<SocialReadbackPanel> {
  const now = input.now ?? new Date()
  const sinceIso = input.since.toISOString()
  const untilIso = input.until.toISOString()
  const limit = input.limit ?? DEFAULT_SOCIAL_READBACK_LIMIT

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

  const storyRegPromise = supabase
    .from('flywheel_actions')
    .select('payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_STORY_ACTION_TYPE)
    .gte('executed_at', sinceIso)
    .lte('executed_at', untilIso)
    .limit(MAX_ROWS)

  const [actionsResult, storiesResult, storyRegResult] = await Promise.all([
    actionsPromise,
    storiesPromise,
    storyRegPromise,
  ])

  assertNoError('flywheel_actions', actionsResult)
  assertNoError('story_items', storiesResult)
  assertNoError('flywheel_actions (story register)', storyRegResult)

  const actions = toRows<PublishActionRow>(actionsResult.data)
  const stories = toRows<StoryRow>(storiesResult.data)
  const storyRegistrationRows = toRows<{ payload: unknown }>(storyRegResult.data)

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

  return buildSocialReadbackPanel({
    clientId: input.clientId,
    since: sinceIso,
    until: untilIso,
    limit,
    now,
    actions,
    receipts,
    stories,
    storyRegistrationRows,
  })
}
