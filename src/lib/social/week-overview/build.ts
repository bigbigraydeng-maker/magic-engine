/**
 * Week overview — one read-only look at what is planned for the week, per kind of content.
 * Reads Story packs (story-lite) and this client's factory Reels; Posts are not wired in yet.
 * Server side only: every read is filtered by client id here, never in the browser.
 * Nothing in this file publishes, authorises or switches anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { packState, requireGlobalAdmin, type LitePackState, type LiteResult, type LiteServicePorts } from '../story-lite/service'
import { isLiveFor, type LiteActor, type LiteChannel, type LiteItemStatus, type LiteMediaKind, type LiteSwitches } from '../story-lite/types'
import { toPublishedView } from '../../factory/publish/publish-display'

export interface OverviewStoryItem {
  item_id: string
  channel: LiteChannel
  slot_at: string
  media_kind: LiteMediaKind
  media_url: string
  text_line: string
  status: LiteItemStatus
}

export interface OverviewStoryPack {
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

export interface WeekOverview {
  /** True only when real publishing is switched on for this client. */
  live: boolean
  /** The newest Story pack that is still in play (not stopped, not expired); null when there is none. */
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

async function readStory(ports: LiteServicePorts, clientId: string, now: Date): Promise<OverviewStoryPack | null> {
  const rows = await ports.store.listPacksForClient(clientId, 10)
  const current = rows.find(({ pack }) => {
    const state = packState(pack, now)
    return state === 'DRAFT' || state === 'AUTHORIZED'
  })
  if (!current) return null
  const items = await ports.store.getItems(current.pack.id, clientId)
  return {
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
    })),
  }
}

function failureText(error: unknown): string {
  void error
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
  const [story, reels] = await Promise.allSettled([readStory(ports, clientId, now), listClientReels(db, clientId)])
  return {
    ok: true,
    value: {
      live: isLiveFor(switches, clientId),
      story: story.status === 'fulfilled' ? story.value : null,
      story_error: story.status === 'rejected' ? failureText(story.reason) : null,
      reels: reels.status === 'fulfilled' ? reels.value : [],
      reels_error: reels.status === 'rejected' ? failureText(reels.reason) : null,
      post: { connected: false },
    },
  }
}
