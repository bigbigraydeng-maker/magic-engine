/**
 * Week overview — one read-only look at what is planned for the week, per kind of content.
 * Reads Story packs (story-lite) and this client's factory Reels; Posts are not wired in yet.
 * Server side only: every read is filtered by client id here, never in the browser.
 * Nothing in this file publishes, authorises or switches anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { packState, requireGlobalAdmin, type LitePackState, type LiteResult, type LiteServicePorts } from '../story-lite/service'
import { isLiveFor, type LiteActor, type LiteChannel, type LiteItemStatus, type LiteMediaKind, type LiteRole, type LiteSwitches } from '../story-lite/types'
import { toPublishedView } from '../../factory/publish/publish-display'

export interface OverviewStoryItem {
  item_id: string
  channel: LiteChannel
  slot_at: string
  media_kind: LiteMediaKind
  media_url: string
  text_line: string
  status: LiteItemStatus
  /** Inspiration / fact / invite; null until the roles are recorded. */
  role: LiteRole | null
}

export interface OverviewStoryPack {
  /** Title of a newer, not-yet-authorised pack waiting behind an authorised one; null otherwise. */
  newer_draft_title: string | null
  pack_id: string
  title: string
  state: LitePackState
  authorized_at: string | null
  expires_at: string | null
  items: OverviewStoryItem[]
}

export interface OverviewReel {
  id: string
  status: string
  angle: string
  created_at: string
  published_at: string | null
  permalink: string | null
}

/** How many of each kind the client wants per day / week. A kind that is not configured is null ("not configured"), never 0. */
export interface PublishingQuota {
  post_per_day: number | null
  story_per_day: number | null
  reel_per_week: number | null
}

export interface WeekOverview {
  /** Client-layer quotas; null when the client has no calendar configuration at all. */
  quota: PublishingQuota | null
  /** True only when real publishing is switched on for this client. */
  live: boolean
  /** The Story pack in play: an authorised one first (it WILL publish), otherwise the newest draft; null when none. */
  story: OverviewStoryPack | null
  /** Set when the Story read failed: the page must say "cannot read", never "no Stories". */
  story_error: string | null
  reels: OverviewReel[]
  reels_error: string | null
  /** Posts have no weekly pack yet. */
  post: { connected: false }
}

/** Factory orders that are not a Reel anyone can look at (archived, replaced, failed, stuck). */
const HIDDEN_REEL_STATUSES = ['archived', 'superseded', 'failed', 'dead_letter'] as const
const REEL_LIMIT = 30

interface ReelRow {
  id: string
  status: string
  angle: string | null
  created_at: string
  video_path: string | null
  published_ref: unknown
}

/** This client's factory Reels only (filtered in the query), newest first. Throws on a database error. */
export async function listClientReels(db: SupabaseClient, clientId: string): Promise<OverviewReel[]> {
  const { data, error } = await db
    .from('content_work_orders')
    .select('id, status, angle, created_at, video_path:output->>video_path, published_ref')
    .eq('client_id', clientId)
    .not('status', 'in', `(${HIDDEN_REEL_STATUSES.join(',')})`)
    .not('output->>video_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(REEL_LIMIT)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ReelRow[])
    .filter((row) => typeof row.video_path === 'string' && row.video_path.length > 0)
    .map((row) => {
      const published = toPublishedView(row.published_ref)
      return {
        id: row.id,
        status: row.status,
        angle: row.angle ?? '',
        created_at: row.created_at,
        published_at: published?.published_at ?? null,
        permalink: published?.permalink ?? null,
      }
    })
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The client's own quotas from `clients.publishing_calendar_config` = { quota: { post_per_day, story_per_day, reel_per_week } }.
 * No config (or the column not created yet) = null: the page says "未配置", it never pretends the quota is 0.
 */
export async function readPublishingQuota(db: SupabaseClient, clientId: string): Promise<PublishingQuota | null> {
  const { data, error } = await db.from('clients').select('publishing_calendar_config').eq('id', clientId).maybeSingle()
  if (error) {
    // the config column is added by a separate, approved migration: before that, "not configured"
    if (error.code === '42703' || /does not exist|column/i.test(error.message)) return null
    throw new Error(error.message)
  }
  const raw = (data as { publishing_calendar_config?: unknown } | null)?.publishing_calendar_config
  const quota = raw && typeof raw === 'object' ? (raw as { quota?: unknown }).quota : null
  if (!quota || typeof quota !== 'object') return null
  const q = quota as Record<string, unknown>
  const result: PublishingQuota = {
    post_per_day: wholeNumber(q.post_per_day),
    story_per_day: wholeNumber(q.story_per_day),
    reel_per_week: wholeNumber(q.reel_per_week),
  }
  return result.post_per_day === null && result.story_per_day === null && result.reel_per_week === null ? null : result
}

async function readStory(ports: LiteServicePorts, clientId: string, now: Date): Promise<OverviewStoryPack | null> {
  const rows = await ports.store.listPacksForClient(clientId, 10)
  // an authorised pack is the one that will publish: it must never be hidden behind a newer draft
  const authorised = rows.find(({ pack }) => packState(pack, now) === 'AUTHORIZED')
  const draft = rows.find(({ pack }) => packState(pack, now) === 'DRAFT')
  const current = authorised ?? draft
  if (!current) return null
  const newerDraft = authorised && draft && draft.pack.created_at > authorised.pack.created_at ? draft.pack.title : null
  const items = await ports.store.getItems(current.pack.id, clientId)
  return {
    newer_draft_title: newerDraft,
    pack_id: current.pack.id,
    title: current.pack.title,
    state: packState(current.pack, now),
    authorized_at: current.pack.authorized_at,
    expires_at: current.pack.expires_at,
    items: items.map((item) => ({
      item_id: item.item_id,
      channel: item.channel,
      slot_at: item.slot_at,
      media_kind: item.media_kind,
      media_url: item.media_url,
      text_line: item.text_line,
      status: item.status,
      role: item.role ?? null,
    })),
  }
}

function failureText(source: 'story' | 'reels', error: unknown): string {
  // the page only says "cannot read"; the reason goes to the server log (no customer data in it)
  console.error('[week-overview]', source, 'read failed:', error instanceof Error ? error.message : 'unknown')
  return 'read failed'
}

export async function buildWeekOverview(input: {
  ports: LiteServicePorts
  db: SupabaseClient
  clientId: string
  actor: LiteActor
  switches: LiteSwitches
  now: Date
}): Promise<LiteResult<WeekOverview>> {
  const { ports, db, clientId, actor, switches, now } = input
  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  // the two reads are independent: run them side by side, and let one failing never hide the other
  const [story, reels, quota] = await Promise.allSettled([
    readStory(ports, clientId, now),
    listClientReels(db, clientId),
    readPublishingQuota(db, clientId),
  ])
  return {
    ok: true,
    value: {
      live: isLiveFor(switches, clientId),
      quota: quota.status === 'fulfilled' ? quota.value : null,
      story: story.status === 'fulfilled' ? story.value : null,
      story_error: story.status === 'rejected' ? failureText('story', story.reason) : null,
      reels: reels.status === 'fulfilled' ? reels.value : [],
      reels_error: reels.status === 'rejected' ? failureText('reels', reels.reason) : null,
      post: { connected: false },
    },
  }
}
