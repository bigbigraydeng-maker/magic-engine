/**
 * Find recent sent Stories that have no publish-action row.
 *
 * The caller processes at most STORY_RECONCILE_LIMIT rows. Already-registered
 * rows are skipped before that cap, so a full page of old rows cannot hide a
 * newer one that still needs a row. This module does not publish anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_PUBLISH_STORY_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import {
  storyActionInputFromRow,
  storyPublishIdempotencyKey,
  type StoryItemRegistrationRow,
} from '@/lib/social/story-publish-action'

export const STORY_RECONCILE_LIMIT = 50
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PAGES = 20

export async function listUnregisteredSentStories(
  supabase: SupabaseClient,
  now: Date,
): Promise<StoryItemRegistrationRow[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
  const missing: StoryItemRegistrationRow[] = []
  for (let page = 0; page < MAX_PAGES && missing.length < STORY_RECONCILE_LIMIT; page += 1) {
    const rows = await fetchSentPage(supabase, since, page)
    if (rows.length === 0) break
    const unseen = await dropRegistered(supabase, rows.filter(isEligibleSentStory))
    for (const row of unseen) {
      if (missing.length >= STORY_RECONCILE_LIMIT) break
      missing.push(row)
    }
    if (rows.length < STORY_RECONCILE_LIMIT) break
  }
  return missing
}

async function fetchSentPage(
  supabase: SupabaseClient,
  since: string,
  page: number,
): Promise<StoryItemRegistrationRow[]> {
  const start = page * STORY_RECONCILE_LIMIT
  const { data, error } = await supabase
    .from('story_items')
    .select('item_id, pack_id, client_id, channel, account_id, status, provider_receipt, sent_at')
    .eq('status', 'SENT')
    .gte('sent_at', since)
    .order('sent_at', { ascending: true })
    .range(start, start + STORY_RECONCILE_LIMIT - 1)
  if (error) throw new Error(`listUnregisteredSentStories: ${error.message}`)
  return (data ?? []) as StoryItemRegistrationRow[]
}

async function dropRegistered(
  supabase: SupabaseClient,
  rows: StoryItemRegistrationRow[],
): Promise<StoryItemRegistrationRow[]> {
  if (rows.length === 0) return []
  const keys = rows.map((row) => storyPublishIdempotencyKey(row.item_id))
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('client_id, payload')
    .eq('action_type', SOCIAL_PUBLISH_STORY_ACTION_TYPE)
    .in('payload->>idempotency_key', keys)
  if (error) throw new Error(`listUnregisteredSentStories: ${error.message}`)
  const have = new Set(
    ((data ?? []) as { client_id?: string; payload?: { idempotency_key?: string } }[])
      .map((row) => `${row.client_id}:${row.payload?.idempotency_key ?? ''}`),
  )
  return rows.filter((row) => !have.has(`${row.client_id}:${storyPublishIdempotencyKey(row.item_id)}`))
}

function isEligibleSentStory(row: StoryItemRegistrationRow): boolean {
  return storyActionInputFromRow(row) !== null && row.status === 'SENT'
}
