/**
 * Register a sent Story as a flywheel action.
 *
 * The row is an already-happened publish fact. It has no measure_at, so the
 * T+N post reader cannot pick it up. expected_metric stays null so generic
 * attribution does not load it. A unique conflict re-reads the full identity
 * and fails closed when any field differs — the old row is never treated as
 * this story.
 *
 * Both switches are off unless the value is exactly "true".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_PUBLISH_STORY_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import { writeReadbackOutcome } from '@/lib/social/readback-outcome-record'

const UNIQUE_VIOLATION = '23505'
const STORY_SOURCE = 'story_lite'

export const SOCIAL_STORY_PUBLISH_REGISTER_ENV = 'SOCIAL_STORY_PUBLISH_REGISTER_ENABLED'
export const SOCIAL_STORY_PUBLISH_RECONCILE_ENV = 'SOCIAL_STORY_PUBLISH_RECONCILE_ENABLED'
export const STORY_PUBLISH_RECONCILE_EVENT = 'social/story.publish_actions.reconcile_due'

export function storyPublishRegisterEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SOCIAL_STORY_PUBLISH_REGISTER_ENABLED === 'true'
}

export function storyPublishReconcileEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SOCIAL_STORY_PUBLISH_RECONCILE_ENABLED === 'true'
}

export function storyPublishIdempotencyKey(itemId: string): string {
  return `story-lite:${itemId}`
}

/** Floor to 10 minutes in UTC. `story-reconcile:yyyyMMddHHmm`. */
export function storyReconcileEventId(now: Date): string {
  const floored = new Date(now.getTime())
  floored.setUTCSeconds(0, 0)
  floored.setUTCMinutes(floored.getUTCMinutes() - (floored.getUTCMinutes() % 10))
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${floored.getUTCFullYear()}${pad(floored.getUTCMonth() + 1)}${pad(floored.getUTCDate())}${pad(floored.getUTCHours())}${pad(floored.getUTCMinutes())}`
  return `story-reconcile:${stamp}`
}

export interface StoryPublishActionInput {
  clientId: string
  itemId: string
  packId: string
  pageId: string
  channel: 'facebook_story' | 'instagram_story'
  providerReceipt: string
  publishedAt: string
}

export type StoryPublishRegistrationResult =
  | { ok: true; actionId: string; created: boolean }
  | { ok: false; reason: 'identity_mismatch'; field: string }

export interface LiveSentStoryAttempt {
  clientId: string
  itemId: string
  packId: string
  channel: 'facebook_story' | 'instagram_story'
  providerReceipt: string
}

export interface StoryItemRegistrationRow {
  item_id: string
  pack_id: string
  client_id: string
  channel: string
  account_id: string
  status: string
  provider_receipt: string | null
  sent_at: string | null
}

/** Pure gate. Anything except a live send returns false. No I/O. */
export function isLiveSentStoryAttempt(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const row = data as { status?: unknown; mode?: unknown }
  return row.status === 'SENT' && row.mode === 'LIVE'
}

export function parseLiveSentStoryAttempt(data: unknown): LiveSentStoryAttempt | null {
  if (!isLiveSentStoryAttempt(data)) return null
  const row = data as Record<string, unknown>
  const channel = row.channel
  if (channel !== 'facebook_story' && channel !== 'instagram_story') return null
  if (!isUuid(row.client_id) || !isUuid(row.item_id) || !isUuid(row.pack_id)) return null
  if (typeof row.provider_receipt !== 'string' || row.provider_receipt.trim() === '') return null
  return {
    clientId: row.client_id,
    itemId: row.item_id,
    packId: row.pack_id,
    channel,
    providerReceipt: row.provider_receipt,
  }
}

export function storyPublishIdentityMismatch(
  existing: Record<string, unknown> | null,
  input: StoryPublishActionInput,
): string | null {
  if (!existing) return 'action_not_readable'
  if (existing.action_type !== SOCIAL_PUBLISH_STORY_ACTION_TYPE) return 'action_type_mismatch'
  if (existing.expected_metric != null) return 'expected_metric_present'
  const payload = (existing.payload ?? {}) as Record<string, unknown>
  if ('measure_at' in payload) return 'measure_at_present'
  if (existing.client_id !== input.clientId) return 'client_id_mismatch'
  const expected = storyPayload(input)
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) return `${key}_mismatch`
  }
  return null
}

export async function recordStoryPublishAction(
  supabase: SupabaseClient,
  input: StoryPublishActionInput,
): Promise<StoryPublishRegistrationResult> {
  const inserted = await insertStoryAction(supabase, input)
  if (inserted.kind === 'created') return { ok: true, actionId: inserted.actionId, created: true }
  if (inserted.kind === 'conflict') return readStoryConflict(supabase, input)
  throw new Error(`recordStoryPublishAction: ${inserted.message}`)
}

export async function loadStoryItemForRegistration(
  supabase: SupabaseClient,
  itemId: string,
): Promise<StoryItemRegistrationRow | null> {
  const { data, error } = await supabase
    .from('story_items')
    .select('item_id, pack_id, client_id, channel, account_id, status, provider_receipt, sent_at')
    .eq('item_id', itemId)
    .maybeSingle()
  if (error) throw new Error(`loadStoryItemForRegistration: ${error.message}`)
  return (data as StoryItemRegistrationRow | null) ?? null
}

/** Null means the row may be registered. Any string is a refusal code. */
export function storyRegistrationRefusal(
  attempt: LiveSentStoryAttempt,
  item: StoryItemRegistrationRow | null,
  registeredPageId: string | null,
): string | null {
  if (!item) return 'item_not_found'
  if (item.client_id !== attempt.clientId) return 'client_mismatch'
  if (item.pack_id !== attempt.packId) return 'pack_mismatch'
  if (item.channel !== attempt.channel) return 'channel_mismatch'
  if (item.status !== 'SENT') return 'status_not_sent'
  if (item.provider_receipt !== attempt.providerReceipt) return 'receipt_mismatch'
  if (!registeredPageId || registeredPageId !== item.account_id) return 'page_mismatch'
  if (!publishedAt(item.sent_at)) return 'sent_at_missing'
  return null
}

export function storyActionInputFromRow(
  item: StoryItemRegistrationRow,
): StoryPublishActionInput | null {
  const published = publishedAt(item.sent_at)
  if (!published || !item.provider_receipt) return null
  if (item.channel !== 'facebook_story' && item.channel !== 'instagram_story') return null
  return {
    clientId: item.client_id,
    itemId: item.item_id,
    packId: item.pack_id,
    pageId: item.account_id,
    channel: item.channel,
    providerReceipt: item.provider_receipt,
    publishedAt: published,
  }
}

export async function writeStoryRegisterRefusal(
  supabase: SupabaseClient,
  input: { clientId: string; itemId: string; reason: string },
): Promise<void> {
  await writeReadbackOutcome(supabase, {
    clientId: input.clientId,
    subjectKind: 'story',
    subjectRef: input.itemId,
    outcome: `story_register_refused:${input.reason}`,
    reason: input.reason,
  })
}

function storyPayload(input: StoryPublishActionInput): Record<string, string> {
  return {
    source: STORY_SOURCE,
    idempotency_key: storyPublishIdempotencyKey(input.itemId),
    item_id: input.itemId,
    pack_id: input.packId,
    page_id: input.pageId,
    channel: input.channel,
    provider_receipt: input.providerReceipt,
    published_at: input.publishedAt,
  }
}

function storyActionRow(input: StoryPublishActionInput) {
  return {
    client_id: input.clientId,
    flywheel: 'social',
    action_type: SOCIAL_PUBLISH_STORY_ACTION_TYPE,
    execution_mode: 'in_house',
    vendor: 'meta_graph',
    expected_metric: null,
    expected_delta: null,
    executed_at: input.publishedAt,
    payload: storyPayload(input),
  }
}

async function insertStoryAction(
  supabase: SupabaseClient,
  input: StoryPublishActionInput,
): Promise<{ kind: 'created'; actionId: string } | { kind: 'conflict' } | { kind: 'error'; message: string }> {
  const { data, error } = await supabase.from('flywheel_actions').insert(storyActionRow(input)).select('id').single()
  if (!error && data) return { kind: 'created', actionId: (data as { id: string }).id }
  if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) return { kind: 'conflict' }
  return { kind: 'error', message: error?.message ?? 'insert returned no row' }
}

async function readStoryConflict(
  supabase: SupabaseClient,
  input: StoryPublishActionInput,
): Promise<StoryPublishRegistrationResult> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, action_type, expected_metric, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_STORY_ACTION_TYPE)
    .eq('payload->>idempotency_key', storyPublishIdempotencyKey(input.itemId))
    .maybeSingle()
  if (error || !data) {
    throw new Error(`recordStoryPublishAction: unique conflict but row not readable — ${error?.message ?? 'not found'}`)
  }
  const mismatch = storyPublishIdentityMismatch(data as Record<string, unknown>, input)
  if (mismatch) return { ok: false, reason: 'identity_mismatch', field: mismatch }
  return { ok: true, actionId: (data as { id: string }).id, created: false }
}

function publishedAt(value: string | null): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
