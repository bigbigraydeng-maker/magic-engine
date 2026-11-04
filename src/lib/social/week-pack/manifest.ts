/**
 * Pure manifest assembly. Callers pass rows they already read.
 * A failed read is `unread`, never an empty list that looks like "nothing this week".
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

import type { ManifestReel, ManifestStory, ReelDateState, WeekPackManifest } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ReelInput {
  id: string
  status: string
  video_state: 'DRAFT' | 'PUBLISHED' | null
  approved_at: string | null
  publish_on: string | null | 'invalid'
  fingerprint: string | null
  title: string
  asset_only: boolean
}

export function emptyStory(): ManifestStory {
  return { read_state: 'ok', pack_id: null, title: null, state: null, content_hash: null, items: [] }
}

export function unreadStory(): ManifestStory {
  return { read_state: 'unread', pack_id: null, title: null, state: null, content_hash: null, items: [] }
}

export function readPublishOn(brief: unknown): string | null | 'invalid' {
  if (!brief || typeof brief !== 'object') return null
  const weekly = (brief as { weekly_pack?: unknown }).weekly_pack
  if (!weekly || typeof weekly !== 'object') return null
  const value = (weekly as { publish_on?: unknown }).publish_on
  if (value == null || value === '') return null
  return typeof value === 'string' && DATE_RE.test(value) ? value : 'invalid'
}

export function readApprovedAt(review: unknown): string | null {
  if (!review || typeof review !== 'object') return null
  const value = (review as { approved_at?: unknown }).approved_at
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function reelTitle(angle: unknown): string {
  const raw = typeof angle === 'string' ? angle : ''
  const head = raw.split(/[:：]/)[0] ?? ''
  const tidy = head.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return (tidy || '未命名视频').slice(0, 40)
}

export function reelLibraryFingerprint(input: {
  workOrderId: string
  status: string
  videoState: string | null
  approvedAt: string | null
  publishOn: string | null
  caption: string
}): string {
  return canonicalHashOfInput({
    work_order_id: input.workOrderId,
    status: input.status,
    video_state: input.videoState,
    approved_at: input.approvedAt,
    publish_on: input.publishOn,
    caption: input.caption,
  })
}

function dateStateOf(publishOn: string | null | 'invalid', weekStart: string, weekEnd: string): ReelDateState | 'other_week' {
  if (publishOn == null) return 'undated'
  if (publishOn === 'invalid') return 'invalid'
  if (publishOn >= weekStart && publishOn <= weekEnd) return 'in_week'
  return 'other_week'
}

/** Review passed and still a draft. Already-public rows are left out. Another week's date is left out. */
export function selectReels(rows: readonly ReelInput[], weekStart: string, weekEnd: string): ManifestReel[] {
  const selected: ManifestReel[] = []
  for (const row of rows) {
    if (row.asset_only || row.video_state === 'PUBLISHED') continue
    const passed = row.status === 'approved' || (row.video_state === 'DRAFT' && Boolean(row.approved_at))
    if (!passed) continue
    if (row.status === 'published' && row.video_state == null) {
      selected.push(reelRow(row, null, 'unverified'))
      continue
    }
    const dateState = dateStateOf(row.publish_on, weekStart, weekEnd)
    if (dateState === 'other_week') continue
    const scheduled = dateState === 'in_week' && typeof row.publish_on === 'string' ? row.publish_on : null
    selected.push(reelRow(row, scheduled, dateState))
  }
  return selected
}

function reelRow(row: ReelInput, scheduled: string | null, dateState: ReelDateState): ManifestReel {
  return {
    work_order_id: row.id,
    title: row.title,
    fingerprint: row.fingerprint,
    scheduled_at_iso: scheduled,
    video_state: row.video_state,
    date_state: dateState,
  }
}

export function buildManifest(input: {
  clientId: string
  weekStart: string
  weekEnd: string
  assembledAt: string
  story: ManifestStory
  reels: { read_state: 'ok' | 'unread'; truncated: boolean; items: ManifestReel[] }
}): WeekPackManifest {
  return {
    client_id: input.clientId.toLowerCase(),
    week_start: input.weekStart,
    week_end: input.weekEnd,
    assembled_at: input.assembledAt,
    story: input.story,
    posts: { connected: false, label: '尚未接入' },
    reels: input.reels,
  }
}
