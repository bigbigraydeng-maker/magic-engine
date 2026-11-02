/**
 * Find recent sent Stories that have no publish-action row.
 *
 * Registered rows are removed before the 50-row cap. story_items and
 * flywheel_actions have no foreign key, so PostgREST cannot express
 * NOT EXISTS without a new database function. The registered identity
 * set (client + idempotency key) is read first, then Stories are walked
 * with a (sent_at, item_id) keyset. A prefix of already-registered rows
 * does not end the walk or hide a later gap. This module does not publish.
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
const ACTION_PAGE = 1000
const ACTION_PAGE_CAP = 100

interface ScanCursor {
  sentAt: string
  itemId: string
}

export async function listUnregisteredSentStories(
  supabase: SupabaseClient,
  now: Date,
): Promise<StoryItemRegistrationRow[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
  const registered = await loadRegisteredKeys(supabase, since)
  return walkUnregistered(supabase, since, registered)
}

async function loadRegisteredKeys(supabase: SupabaseClient, since: string): Promise<Set<string>> {
  const keys = new Set<string>()
  for (let page = 0; page < ACTION_PAGE_CAP; page += 1) {
    const start = page * ACTION_PAGE
    const { data, error } = await supabase
      .from('flywheel_actions')
      .select('client_id, payload')
      .eq('action_type', SOCIAL_PUBLISH_STORY_ACTION_TYPE)
      .gte('executed_at', since)
      .order('executed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + ACTION_PAGE - 1)
    if (error) throw new Error(`listUnregisteredSentStories: ${error.message}`)
    const rows = (data ?? []) as { client_id?: string; payload?: { idempotency_key?: string } }[]
    for (const row of rows) {
      if (row.client_id && row.payload?.idempotency_key) {
        keys.add(`${row.client_id}:${row.payload.idempotency_key}`)
      }
    }
    if (rows.length < ACTION_PAGE) return keys
  }
  throw new Error('listUnregisteredSentStories: registered-key scan exceeded 100000 rows')
}

async function walkUnregistered(
  supabase: SupabaseClient,
  since: string,
  registered: Set<string>,
): Promise<StoryItemRegistrationRow[]> {
  const missing: StoryItemRegistrationRow[] = []
  let cursor: ScanCursor | null = null
  for (;;) {
    const rows = await fetchSentPage(supabase, since, cursor)
    if (rows.length === 0) return missing
    for (const row of rows) {
      if (!isEligibleSentStory(row) || registered.has(storyIdentity(row))) continue
      missing.push(row)
      if (missing.length >= STORY_RECONCILE_LIMIT) return missing
    }
    const last = rows[rows.length - 1]
    const sentAt = last?.sent_at
    if (!last || !sentAt || rows.length < STORY_RECONCILE_LIMIT) return missing
    if (sameCursor(cursor, sentAt, last.item_id)) return missing
    cursor = { sentAt, itemId: last.item_id }
  }
}

async function fetchSentPage(
  supabase: SupabaseClient,
  since: string,
  cursor: ScanCursor | null,
): Promise<StoryItemRegistrationRow[]> {
  let query = supabase
    .from('story_items')
    .select('item_id, pack_id, client_id, channel, account_id, status, provider_receipt, sent_at')
    .eq('status', 'SENT')
    .gte('sent_at', since)
  if (cursor) query = query.or(pastCursor(cursor))
  const { data, error } = await query
    .order('sent_at', { ascending: true })
    .order('item_id', { ascending: true })
    .limit(STORY_RECONCILE_LIMIT)
  if (error) throw new Error(`listUnregisteredSentStories: ${error.message}`)
  return (data ?? []) as StoryItemRegistrationRow[]
}

function sameCursor(cursor: ScanCursor | null, sentAt: string, itemId: string): boolean {
  return cursor !== null && cursor.sentAt === sentAt && cursor.itemId === itemId
}

function pastCursor(cursor: ScanCursor): string {
  const sent = `"${cursor.sentAt}"`
  const item = `"${cursor.itemId}"`
  return `and(sent_at.eq.${sent},item_id.gt.${item}),sent_at.gt.${sent}`
}

function storyIdentity(row: StoryItemRegistrationRow): string {
  return `${row.client_id}:${storyPublishIdempotencyKey(row.item_id)}`
}

function isEligibleSentStory(row: StoryItemRegistrationRow): boolean {
  return storyActionInputFromRow(row) !== null && row.status === 'SENT'
}
