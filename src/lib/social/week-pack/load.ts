/**
 * Read-only assembly of one client's weekly pack.
 * Story uses the same pack choice as the week overview: an authorised pack, otherwise the newest draft.
 * A failed read stays `unread`. It is never reported as zero items.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { buildReelPostCaption } from '@/lib/social/reel-publishing'
import { computeItemFingerprint, computePackContentHash } from '@/lib/social/story-lite/fingerprint'
import { packState, type LiteServicePorts } from '@/lib/social/story-lite/service'

import { nzDateKey, targetWeek } from './cadence'
import {
  buildManifest,
  emptyStory,
  readApprovedAt,
  readPublishOn,
  reelLibraryFingerprint,
  reelTitle,
  selectReels,
  unreadStory,
  type ReelInput,
} from './manifest'
import type { ManifestStory, WeekPackManifest } from './types'

const STORY_LIFETIME_DAYS = 7
const REEL_CAP = 30

export interface ClientPackSettings {
  label: string
  config: unknown
  configReadable: boolean
}

export async function readClientPackSettings(db: SupabaseClient, clientId: string): Promise<ClientPackSettings> {
  const { data, error } = await db.from('clients').select('name, publishing_calendar_config').eq('id', clientId).maybeSingle()
  if (error) return { label: '这位客户', config: null, configReadable: false }
  const row = data as { name?: unknown; publishing_calendar_config?: unknown } | null
  const name = typeof row?.name === 'string' ? row.name.trim() : ''
  return { label: name || '这位客户', config: row?.publishing_calendar_config ?? null, configReadable: true }
}

export async function loadWeekPackManifest(input: {
  ports: LiteServicePorts
  db: SupabaseClient
  clientId: string
  now: Date
}): Promise<WeekPackManifest> {
  const week = targetWeek(input.now)
  const [story, reels] = await Promise.all([
    loadStory(input.ports, input.clientId, input.now, week.weekStart, week.weekEnd),
    loadReels(input.db, input.clientId, week.weekStart, week.weekEnd),
  ])
  return buildManifest({
    clientId: input.clientId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    assembledAt: input.now.toISOString(),
    story,
    reels,
  })
}

async function loadStory(
  ports: LiteServicePorts,
  clientId: string,
  now: Date,
  weekStart: string,
  weekEnd: string,
): Promise<ManifestStory> {
  try {
    const rows = await ports.store.listPacksForClient(clientId, 10)
    const authorised = rows.find(({ pack }) => packState(pack, now) === 'AUTHORIZED')
    const draft = rows.find(({ pack }) => packState(pack, now) === 'DRAFT')
    const current = authorised ?? draft
    if (!current) return emptyStory()
    const items = await ports.store.getItems(current.pack.id, clientId)
    return {
      read_state: 'ok',
      pack_id: current.pack.id,
      title: current.pack.title,
      state: packState(current.pack, now),
      content_hash: computePackContentHash(items, STORY_LIFETIME_DAYS),
      items: items.map((item) => ({
        item_id: item.item_id,
        channel: item.channel,
        slot_at: item.slot_at,
        fingerprint: computeItemFingerprint(item),
        status: item.status,
        in_target_week: inWeek(item.slot_at, weekStart, weekEnd),
      })),
    }
  } catch (error) {
    console.error('[week-pack] story read failed', error instanceof Error ? error.message : 'unknown')
    return unreadStory()
  }
}

function inWeek(slotAt: string, weekStart: string, weekEnd: string): boolean {
  const day = nzDateKey(slotAt)
  return day.length > 0 && day >= weekStart && day <= weekEnd
}

async function loadReels(
  db: SupabaseClient,
  clientId: string,
  weekStart: string,
  weekEnd: string,
): Promise<WeekPackManifest['reels']> {
  const { data, error } = await db
    .from('content_work_orders')
    .select('id, status, angle, review_ref, published_ref, brief')
    .eq('client_id', clientId)
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false })
    .limit(REEL_CAP + 1)
  if (error) {
    console.error('[week-pack] reel read failed', error.message)
    return { read_state: 'unread', truncated: false, items: [] }
  }
  const rows = Array.isArray(data) ? data : []
  const inputs = rows.slice(0, REEL_CAP).flatMap((row) => {
    const parsed = toReelInput(row)
    return parsed ? [parsed] : []
  })
  return { read_state: 'ok', truncated: rows.length > REEL_CAP, items: selectReels(inputs, weekStart, weekEnd) }
}

function toReelInput(row: unknown): ReelInput | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.status !== 'string') return null
  const published = toPublishedView(record.published_ref)
  const publishOn = readPublishOn(record.brief)
  const approvedAt = readApprovedAt(record.review_ref)
  return {
    id: record.id,
    status: record.status,
    video_state: published?.video_state ?? null,
    approved_at: approvedAt,
    publish_on: publishOn,
    title: reelTitle(record.angle),
    asset_only: isAssetOnly(record.brief),
    fingerprint: reelLibraryFingerprint({
      workOrderId: record.id,
      status: record.status,
      videoState: published?.video_state ?? null,
      approvedAt,
      publishOn: publishOn === 'invalid' ? 'invalid' : publishOn,
      caption: captionOf(record.brief),
    }),
  }
}

function isAssetOnly(brief: unknown): boolean {
  if (!brief || typeof brief !== 'object') return false
  const remotion = (brief as { remotion?: unknown }).remotion
  if (!remotion || typeof remotion !== 'object') return false
  return (remotion as { deliverable?: unknown }).deliverable === 'asset_only'
}

function captionOf(brief: unknown): string {
  if (!brief || typeof brief !== 'object') return ''
  const copy = (brief as { copy?: unknown }).copy
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return ''
  return buildReelPostCaption(copy as Record<string, unknown>)
}
