/**
 * The PM page's 「最近发送」: the live ledger rows of one client's welcome letter (real sending only; the rehearsal's
 * shadow rows never show here): EVERY letter whose outcome is unknown first (the page is the only place a person settles
 * them, so newer activity must not push one off the page; counted here, not on the page), then the latest others, newest
 * activity first: what happened to each letter and why, when, whether the provider took it, and how a person settled
 * it. No guest address, no subject line, no body: the guest is a contact id (the page links to the CRM). Read-only.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §17.4, §17.7 (之二乙).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { leftProvider, NOT_SENT_CONFIRMED } from './receipt'
import { resolutionOf, type Resolution } from './resolve-unknown'

/** How many of the other rows the page shows; it says so under the list. */
export const RECENT_SENDS_LIMIT = 20
/** Unknown outcomes shown at most; more than this = the page says "at least" (a person must look in the ledger). */
export const UNKNOWN_SENDS_LIMIT = 200

const COLUMNS =
  'id, contact_id, status, reason_code, last_block_reason, bounce_kind, provider_impact, attempts, first_attempt_at, sent_at, last_event_type, last_event_at, created_at, updated_at, annotations'

interface DbRow {
  id: string
  contact_id: string
  status: string
  reason_code: string | null
  last_block_reason: string | null
  bounce_kind: string | null
  provider_impact: string
  attempts: number | null
  first_attempt_at: string | null
  sent_at: string | null
  last_event_type: string | null
  last_event_at: string | null
  created_at: string
  updated_at: string
  annotations: unknown
}

export interface RecentSend {
  id: string
  contact_id: string
  status: string
  reason_code: string | null
  last_block_reason: string | null
  bounce_kind: string | null
  provider_impact: string
  attempts: number
  first_attempt_at: string | null
  sent_at: string | null
  last_event_type: string | null
  last_event_at: string | null
  created_at: string
  updated_at: string
  /** How a person settled a letter whose outcome nobody could tell (who and when); null otherwise. */
  resolution: Pick<Resolution, 'outcome' | 'by' | 'at'> | null
  /** Marked 「没发出」, but a later receipt shows it left the provider: the timeline may still say it did not go. */
  went_out_after_not_sent: boolean
  /** Marked 「已发出」, but a later receipt says it did not go (`suppressed` / `failed`): the guest has no welcome letter. */
  not_sent_after_sent: boolean
}

export type RecentSendsRead =
  | { ok: true; rows: RecentSend[]; unknownCount: number; unknownMore: boolean }
  | { ok: false; error: string }

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'error'
}

function toView(r: DbRow): RecentSend {
  const resolution = resolutionOf(r.annotations)
  return {
    id: r.id,
    contact_id: r.contact_id,
    status: r.status,
    reason_code: r.reason_code,
    last_block_reason: r.last_block_reason,
    bounce_kind: r.bounce_kind,
    provider_impact: r.provider_impact,
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    first_attempt_at: r.first_attempt_at,
    sent_at: r.sent_at,
    last_event_type: r.last_event_type,
    last_event_at: r.last_event_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    resolution: resolution === null ? null : { outcome: resolution.outcome, by: resolution.by, at: resolution.at },
    went_out_after_not_sent: r.reason_code === NOT_SENT_CONFIRMED && leftProvider(r.status),
    not_sent_after_sent: resolution?.outcome === 'sent' && (r.status === 'failed' || r.status === 'suppressed'),
  }
}

/** This client's live welcome-letter rows (never the rehearsal's). */
function liveRows(db: SupabaseClient, clientId: string) {
  return db.from('triggered_sends').select(COLUMNS).eq('client_id', clientId).eq('trigger_key', 'welcome').eq('channel', 'email').eq('dedupe_scope', 'lifetime')
}

export async function readRecentSends(db: SupabaseClient, clientId: string, limit: number = RECENT_SENDS_LIMIT): Promise<RecentSendsRead> {
  try {
    // One more than shown: only then is "there are more" known, not guessed from a full page.
    const unknown = await liveRows(db, clientId).eq('status', 'unknown_outcome').order('first_attempt_at', { ascending: true }).limit(UNKNOWN_SENDS_LIMIT + 1)
    if (unknown.error) return { ok: false, error: `recent sends: ${codeOf(unknown.error)}` }
    const recent = await liveRows(db, clientId).order('updated_at', { ascending: false }).limit(limit)
    if (recent.error) return { ok: false, error: `recent sends: ${codeOf(recent.error)}` }
    if (!Array.isArray(unknown.data) || !Array.isArray(recent.data)) return { ok: false, error: 'recent sends: no rows array' }
    const unknownRows = unknown.data as DbRow[]
    const pinned = unknownRows.slice(0, UNKNOWN_SENDS_LIMIT).map(toView)
    const shown = new Set(pinned.map((r) => r.id))
    const others = (recent.data as DbRow[]).filter((r) => !shown.has(r.id)).map(toView)
    return { ok: true, rows: [...pinned, ...others], unknownCount: pinned.length, unknownMore: unknownRows.length > UNKNOWN_SENDS_LIMIT }
  } catch {
    return { ok: false, error: 'recent sends: read threw' }
  }
}
