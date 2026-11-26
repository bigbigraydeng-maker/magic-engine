/**
 * Load and write one Story DM-window verdict. Reads our database only.
 * Does not call Meta. A query error is thrown so the caller can retry;
 * it is never stored as zero.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_PUBLISH_STORY_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import { writeReadbackOutcome } from '@/lib/social/readback-outcome-record'
import {
  insertSocialVerificationVerdict,
  type VerdictWriteResult,
} from '@/lib/social/verification-verdicts'
import { socialVerificationRequestId } from '@/lib/social/verification-verdict-id'
import {
  MESSENGER_SYNC_JOB,
  STORY_DM_LOGIC_VERSION,
  STORY_DM_THREAD_CAP,
  countNewThreads,
  readStoryDmWindowConfig,
  rowsFromThreadQuery,
  storyDmInviteRole,
  storyDmReadAt,
  storyDmReadPoint,
  storyDmWindowEnd,
  type StoryDmCount,
  type StoryDmThread,
} from '@/lib/social/verify/story-dm-window'

export const STORY_DM_WINDOW_EVENT = 'social/story.dm_window.due'

export interface StoryDmEventData {
  client_id: string
  action_id: string
  item_id: string
  sent_at: string
  channel: 'facebook_story' | 'instagram_story'
}

export interface StoryDmReady {
  ok: true
  clientId: string
  actionId: string
  itemId: string
  sentAt: string
  hours: number
  windowEnd: string
  readAt: string
  platform: 'facebook' | 'instagram'
  /** Null when this product does not store that channel's threads. Never counted as zero. */
  threadChannel: 'messenger' | null
  immediateUnread: string | null
}

export type StoryDmLoad =
  | StoryDmReady
  | { ok: false; skipped: 'not_invite_slot' }
  | { ok: false; outcome: string; reason: string; clientId: string; itemId: string }

interface ItemRow {
  item_id: string
  client_id: string
  channel: string
  status: string
  sent_at: string | null
  role: string | null
}

interface ActionRow {
  id: string
  client_id: string
  action_type: string
  payload: Record<string, unknown> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStoryDmEvent(data: unknown): StoryDmEventData | null {
  if (!isRecord(data)) return null
  const channel = data.channel
  if (channel !== 'facebook_story' && channel !== 'instagram_story') return null
  if (!isUuid(data.client_id) || !isUuid(data.action_id) || !isUuid(data.item_id)) return null
  if (typeof data.sent_at !== 'string' || !Number.isFinite(Date.parse(data.sent_at))) return null
  return {
    client_id: data.client_id,
    action_id: data.action_id,
    item_id: data.item_id,
    sent_at: new Date(data.sent_at).toISOString(),
    channel,
  }
}

export function storyDmWindowEventId(actionId: string): string {
  return `story-dm:${actionId}`
}

export function decideStoryDmContext(
  event: StoryDmEventData,
  item: ItemRow | null,
  calendar: unknown,
  action: ActionRow | null,
): StoryDmLoad {
  if (!item) throw new Error('story dm: item not found')
  const mismatch = storyIdentityMismatch(event, item, action)
  if (mismatch) {
    return { ok: false, outcome: `story_dm_refused:${mismatch}`, reason: mismatch, clientId: event.client_id, itemId: event.item_id }
  }
  if (item.role !== storyDmInviteRole(calendar)) return { ok: false, skipped: 'not_invite_slot' }
  const config = readStoryDmWindowConfig(calendar)
  if (!config.ok) {
    return {
      ok: false,
      outcome: 'story_dm_window_not_configured',
      reason: config.reason,
      clientId: event.client_id,
      itemId: event.item_id,
    }
  }
  const windowEnd = storyDmWindowEnd(event.sent_at, config.hours)
  const readAt = windowEnd ? storyDmReadAt(windowEnd) : null
  if (!windowEnd || !readAt) {
    return { ok: false, outcome: 'story_dm_window_not_configured', reason: 'window_invalid', clientId: event.client_id, itemId: event.item_id }
  }
  const instagram = event.channel === 'instagram_story'
  return {
    ok: true,
    clientId: event.client_id,
    actionId: event.action_id,
    itemId: event.item_id,
    sentAt: event.sent_at,
    hours: config.hours,
    windowEnd,
    readAt,
    platform: instagram ? 'instagram' : 'facebook',
    threadChannel: instagram ? null : 'messenger',
    immediateUnread: instagram ? 'instagram_dm_not_stored' : null,
  }
}

export async function loadStoryDmContext(supabase: SupabaseClient, event: StoryDmEventData): Promise<StoryDmLoad> {
  const [item, calendar, action] = await Promise.all([
    loadItem(supabase, event.item_id),
    loadCalendar(supabase, event.client_id),
    loadAction(supabase, event.action_id),
  ])
  return decideStoryDmContext(event, item, calendar, action)
}

export async function readStoryDmCount(supabase: SupabaseClient, ctx: StoryDmReady): Promise<StoryDmCount> {
  if (!ctx.threadChannel) {
    return { verdict: 'not_readable', observedValue: null, reason: ctx.immediateUnread ?? 'threads_unreadable' }
  }
  const syncStartedAt = await latestSyncStartedAt(supabase, ctx.windowEnd)
  const threads = await loadThreads(supabase, ctx)
  if (threads === null) throw new Error('story dm: thread query failed')
  if (threads.length > STORY_DM_THREAD_CAP) {
    return { verdict: 'not_readable', observedValue: null, reason: 'threads_truncated' }
  }
  return countNewThreads(threads, {
    sentAt: ctx.sentAt,
    hours: ctx.hours,
    lastSuccessfulSyncStartedAt: syncStartedAt,
  })
}

export async function writeStoryDmVerdict(
  supabase: SupabaseClient,
  input: { eventId: string; ctx: StoryDmReady; count: StoryDmCount },
): Promise<VerdictWriteResult> {
  if (!input.eventId) throw new Error('story dm: event id is required')
  return insertSocialVerificationVerdict(supabase, {
    requestId: socialVerificationRequestId(input.eventId, 'story_dm_count'),
    clientId: input.ctx.clientId,
    recordType: 'story_dm_count',
    contentActionId: input.ctx.actionId,
    periodKey: null,
    platform: input.ctx.platform,
    verdict: input.count.verdict,
    readPoint: storyDmReadPoint(input.ctx.hours),
    windowHours: input.ctx.hours,
    boostStatus: null,
    sampleSize: null,
    observedValue: input.count.observedValue,
    evidenceReceiptIds: [],
    evidenceVerdictIds: [],
    cohortDefinition: null,
    baselineValue: null,
    notComparableReasons: null,
    reason: input.count.reason,
    logicVersion: STORY_DM_LOGIC_VERSION,
    subjectKind: 'story',
    subjectRef: input.ctx.itemId,
  })
}

export async function writeStoryDmBlock(
  supabase: SupabaseClient,
  blocked: { outcome: string; reason: string; clientId: string; itemId: string },
): Promise<void> {
  await writeReadbackOutcome(supabase, {
    clientId: blocked.clientId,
    subjectKind: 'story',
    subjectRef: blocked.itemId,
    outcome: blocked.outcome,
    reason: blocked.reason,
  })
}

function storyIdentityMismatch(event: StoryDmEventData, item: ItemRow, action: ActionRow | null): string | null {
  if (item.client_id !== event.client_id) return 'client_mismatch'
  if (item.item_id !== event.item_id) return 'item_mismatch'
  if (item.channel !== event.channel) return 'channel_mismatch'
  if (item.status !== 'SENT') return 'status_not_sent'
  if (!sameInstant(item.sent_at, event.sent_at)) return 'sent_at_mismatch'
  if (!action) throw new Error('story dm: action not found')
  if (action.id !== event.action_id || action.client_id !== event.client_id) return 'action_mismatch'
  if (action.action_type !== SOCIAL_PUBLISH_STORY_ACTION_TYPE) return 'action_type_mismatch'
  const payload = action.payload ?? {}
  if (payload.item_id !== event.item_id) return 'item_mismatch'
  if ('measure_at' in payload) return 'measure_at_present'
  return null
}

async function loadItem(supabase: SupabaseClient, itemId: string): Promise<ItemRow | null> {
  const { data, error } = await supabase
    .from('story_items')
    .select('item_id, client_id, channel, status, sent_at, role')
    .eq('item_id', itemId)
    .maybeSingle()
  if (error) throw new Error(`story dm item: ${error.message}`)
  return (data as ItemRow | null) ?? null
}

async function loadCalendar(supabase: SupabaseClient, clientId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('clients')
    .select('publishing_calendar_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`story dm config: ${error.message}`)
  if (!data) throw new Error('story dm config: client not found')
  return (data as { publishing_calendar_config?: unknown }).publishing_calendar_config ?? null
}

async function loadAction(supabase: SupabaseClient, actionId: string): Promise<ActionRow | null> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, action_type, payload')
    .eq('id', actionId)
    .maybeSingle()
  if (error) throw new Error(`story dm action: ${error.message}`)
  return (data as ActionRow | null) ?? null
}

async function latestSyncStartedAt(supabase: SupabaseClient, windowEnd: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('started_at')
    .eq('job_name', MESSENGER_SYNC_JOB)
    .eq('status', 'completed')
    .gte('started_at', windowEnd)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`story dm sync: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : null
  const started = isRecord(row) && typeof row.started_at === 'string' ? row.started_at : null
  return started
}

async function loadThreads(supabase: SupabaseClient, ctx: StoryDmReady): Promise<StoryDmThread[] | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('created_at, entry_referral')
    .eq('client_id', ctx.clientId)
    .eq('channel', ctx.threadChannel)
    .gte('created_at', ctx.sentAt)
    .lt('created_at', ctx.windowEnd)
    .limit(STORY_DM_THREAD_CAP + 1)
  return rowsFromThreadQuery(error, toThreads(data))
}

function toThreads(data: unknown): StoryDmThread[] {
  if (!Array.isArray(data)) return []
  return data.map((row) => {
    const record = isRecord(row) ? row : {}
    return {
      createdAt: typeof record.created_at === 'string' ? record.created_at : '',
      entryReferral: record.entry_referral ?? null,
    }
  })
}

function sameInstant(left: string | null, right: string): boolean {
  if (!left) return false
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && a === b
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
