/**
 * Weekly social pack — in-memory manifest and the receipt of one approval.
 * Nothing here is stored in a new table. Assembled time is not part of the fingerprint.
 */

export type ReadState = 'ok' | 'unread'

export interface ManifestStoryItem {
  item_id: string
  channel: string
  slot_at: string
  fingerprint: string
  status: string
  /** False when the slot falls outside the target Monday–Sunday. Still part of the pack. */
  in_target_week: boolean
}

export interface ManifestStory {
  read_state: ReadState
  pack_id: string | null
  title: string | null
  state: 'DRAFT' | 'AUTHORIZED' | 'REVOKED' | 'EXPIRED' | null
  content_hash: string | null
  items: ManifestStoryItem[]
}

export type ReelDateState = 'in_week' | 'undated' | 'invalid' | 'unverified'

export interface ManifestReel {
  work_order_id: string
  title: string
  fingerprint: string | null
  /** ISO date (NZ calendar) when known and inside the week; otherwise null. */
  scheduled_at_iso: string | null
  video_state: 'DRAFT' | 'PUBLISHED' | null
  date_state: ReelDateState
}

export interface WeekPackManifest {
  client_id: string
  week_start: string
  week_end: string
  /** Not part of the content fingerprint. */
  assembled_at: string
  story: ManifestStory
  posts: { readonly connected: false; readonly label: '尚未接入' }
  reels: { read_state: ReadState; truncated: boolean; items: ManifestReel[] }
}

export interface WeekPackLine {
  kind: 'story' | 'post' | 'reel'
  stable_id: string | null
  code: string
  ok: boolean
  text: string
}

export interface WeekPackReceipt {
  client_id: string
  subject_key: string
  run_id: string | null
  rolled_back: false
  lines: WeekPackLine[]
}
