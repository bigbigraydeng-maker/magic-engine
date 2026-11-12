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
import { formatStoryDmLabel } from '@/lib/social/verify/story-dm-window'

export const DEFAULT_SOCIAL_READBACK_LIMIT = 20
const MAX_ROWS = 200

/** Idempotency keys for the Story rows actually shown, so registration lookup cannot drift. */
export function storyRegistrationKeys(stories: readonly { item_id: string }[]): string[] {
  return stories.map((story) => `story-lite:${story.item_id}`)
}

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

export interface SocialReadbackBundle {
  panel: SocialReadbackPanel
  actions: PublishActionRow[]
  receipts: ReceiptRow[]
}

export async function loadSocialReadbackBundle(
  supabase: SupabaseClient,
  input: {
    clientId: string
    since: Date
    until: Date
    limit?: number
    now?: Date
  },
): Promise<SocialReadbackBundle> {
  const now = input.now ?? new Date()
  const sinceIso = input.since.toISOString()
  const untilIso = input.until.toISOString()
  const limit = input.limit ?? DEFAULT_SOCIAL_READBACK_LIMIT
  const { actions, stories } = await loadReadbackSources(supabase, input.clientId, sinceIso, untilIso)
  const [receipts, storySide] = await Promise.all([
    loadReceipts(supabase, input.clientId, actions),
    loadStoryReadbackSide(supabase, input.clientId, stories),
  ])

  const panel = buildSocialReadbackPanel({
    clientId: input.clientId,
    since: sinceIso,
    until: untilIso,
    limit,
    now,
    actions,
    receipts,
    stories,
    storyRegistrationRows: storySide.rows,
    storyDmByItemId: storySide.dmByItemId,
  })
  return { panel, actions, receipts }
}

async function loadReadbackSources(
  supabase: SupabaseClient,
  clientId: string,
  sinceIso: string,
  untilIso: string,
): Promise<{ actions: PublishActionRow[]; stories: StoryRow[] }> {
  const [actionsResult, storiesResult] = await Promise.all([
    supabase
      .from('flywheel_actions')
      .select('id, executed_at, payload')
      .eq('client_id', clientId)
      .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
      .gte('executed_at', sinceIso)
      .lte('executed_at', untilIso)
      .order('executed_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('story_items')
      .select('item_id, channel, status, sent_at, slot_at')
      .eq('client_id', clientId)
      .eq('status', 'SENT')
      .gte('sent_at', sinceIso)
      .lte('sent_at', untilIso)
      .order('sent_at', { ascending: false })
      .limit(MAX_ROWS),
  ])
  assertNoError('flywheel_actions', actionsResult)
  assertNoError('story_items', storiesResult)
  return {
    actions: toRows<PublishActionRow>(actionsResult.data),
    stories: toRows<StoryRow>(storiesResult.data),
  }
}

async function loadReceipts(
  supabase: SupabaseClient,
  clientId: string,
  actions: PublishActionRow[],
): Promise<ReceiptRow[]> {
  if (actions.length === 0) return []
  const receiptsResult = await supabase
    .from('social_post_measurement_receipts')
    .select('action_id, window_hours, status, measured_at, values, missing, reason')
    .eq('client_id', clientId)
    .in('action_id', actions.map((row) => row.id))
  assertNoError('social_post_measurement_receipts', receiptsResult)
  return toRows<ReceiptRow>(receiptsResult.data)
}

async function loadStoryReadbackSide(
  supabase: SupabaseClient,
  clientId: string,
  stories: StoryRow[],
): Promise<{ rows: Array<{ id?: string; payload: unknown }>; dmByItemId: Record<string, string> }> {
  const registrationKeys = storyRegistrationKeys(stories)
  if (registrationKeys.length === 0) return { rows: [], dmByItemId: {} }
  const storyRegResult = await supabase
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', SOCIAL_PUBLISH_STORY_ACTION_TYPE)
    .in('payload->>idempotency_key', registrationKeys)
  assertNoError('flywheel_actions (story register)', storyRegResult)
  const rows = toRows<{ id?: string; payload: unknown }>(storyRegResult.data)
  return { rows, dmByItemId: await loadStoryDmByItem(supabase, clientId, rows) }
}

interface StoryDmVerdictRow {
  content_action_id?: unknown
  verdict?: unknown
  observed_value?: unknown
  reason?: unknown
  window_hours?: unknown
  created_at?: unknown
}

function itemIdFromRegistration(row: { payload: unknown }): string | null {
  if (typeof row.payload !== 'object' || row.payload === null || Array.isArray(row.payload)) return null
  const payload = row.payload as { item_id?: unknown; idempotency_key?: unknown }
  if (typeof payload.item_id === 'string' && payload.item_id.length > 0) return payload.item_id
  if (typeof payload.idempotency_key === 'string' && payload.idempotency_key.startsWith('story-lite:')) {
    return payload.idempotency_key.slice('story-lite:'.length)
  }
  return null
}

function isMissingVerdictTable(error: { code?: string; message?: string }): boolean {
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const message = error.message ?? ''
  return message.includes('social_verification_verdicts') && /does not exist|schema cache/i.test(message)
}

/**
 * Earliest story_dm_count per story. A missing table leaves the panel as it
 * was: Story rows still show, without a direct-message line.
 */
export async function loadStoryDmByItem(
  supabase: SupabaseClient,
  clientId: string,
  registrations: Array<{ id?: string; payload: unknown }>,
): Promise<Record<string, string>> {
  const actionToItem = new Map<string, string>()
  for (const row of registrations) {
    if (!row.id) continue
    const itemId = itemIdFromRegistration(row)
    if (itemId) actionToItem.set(row.id, itemId)
  }
  if (actionToItem.size === 0) return {}
  const result = await supabase
    .from('social_verification_verdicts')
    .select('content_action_id, verdict, observed_value, reason, window_hours, created_at')
    .eq('client_id', clientId)
    .eq('record_type', 'story_dm_count')
    .in('content_action_id', [...actionToItem.keys()])
    .order('created_at', { ascending: true })
  if (result.error) {
    if (isMissingVerdictTable(result.error)) return {}
    throw new Error(`loadSocialReadbackPanel: social_verification_verdicts query failed — ${result.error.message}`)
  }
  return labelsFromVerdicts(toRows<StoryDmVerdictRow>(result.data), actionToItem)
}

function countOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,6})$/.test(value)) return Number(value)
  return null
}

function labelsFromVerdicts(rows: StoryDmVerdictRow[], actionToItem: Map<string, string>): Record<string, string> {
  const labels: Record<string, string> = {}
  const ordered = [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  for (const row of ordered) {
    if (typeof row.content_action_id !== 'string') continue
    const itemId = actionToItem.get(row.content_action_id)
    if (!itemId || labels[itemId]) continue
    const label = formatStoryDmLabel({
      verdict: typeof row.verdict === 'string' ? row.verdict : '',
      observedValue: countOrNull(row.observed_value),
      reason: typeof row.reason === 'string' ? row.reason : null,
      windowHours: typeof row.window_hours === 'number' ? row.window_hours : null,
    })
    if (label) labels[itemId] = label
  }
  return labels
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
  const bundle = await loadSocialReadbackBundle(supabase, input)
  return bundle.panel
}
