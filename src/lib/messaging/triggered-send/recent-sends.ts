/**
 * The PM page's 「最近发送」: the latest live ledger rows of one client's welcome letter (real sending only; the
 * rehearsal's shadow rows never show here), newest activity first: what happened to each letter and why, when, whether
 * the provider took it, and how a person settled it. No address, no subject line, no body: the guest is a contact id
 * (the page links to the CRM). Read-only.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §17.4 (之二乙).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolutionOf, type Resolution } from './resolve-unknown'

/** How many rows the page shows; it says so under the list. */
export const RECENT_SENDS_LIMIT = 20

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
}

export type RecentSendsRead = { ok: true; rows: RecentSend[] } | { ok: false; error: string }

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
  }
}

export async function readRecentSends(db: SupabaseClient, clientId: string, limit: number = RECENT_SENDS_LIMIT): Promise<RecentSendsRead> {
  try {
    const { data, error } = await db
      .from('triggered_sends')
      .select(COLUMNS)
      .eq('client_id', clientId)
      .eq('trigger_key', 'welcome')
      .eq('channel', 'email')
      .eq('dedupe_scope', 'lifetime')
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error) return { ok: false, error: `recent sends: ${codeOf(error)}` }
    if (!Array.isArray(data)) return { ok: false, error: 'recent sends: no rows array' }
    return { ok: true, rows: (data as DbRow[]).map(toView) }
  } catch {
    return { ok: false, error: 'recent sends: read threw' }
  }
}
