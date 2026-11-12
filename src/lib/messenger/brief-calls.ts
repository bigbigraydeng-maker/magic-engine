/**
 * Phone calls as an input of a conversation brief.
 *
 * A brief is written from the conversation thread (email / Facebook / WhatsApp). A phone call is not part of that
 * thread, so a customer who was just rung kept showing a summary that knew nothing about the call (CTS, 2026-11-10: a
 * 17-minute call whose content never reached the summary line). This module reads the AI call notes
 * (`telephony_call_analyses.summary`) of one contact so that:
 *   1. the brief prompt can include them (`recentCallLines`), and
 *   2. a call that finished after the last brief makes the conversation due for a rewrite (`hasCallSinceBrief`),
 *      because the "new messages" rule alone never fires on a call.
 *
 * Reads only; never writes. A failed read is NOT passed on as "no calls" by the loader: it throws, and the two callers
 * in `brief-cycle.ts` decide to carry on exactly as before this module existed (fail-open, logged).
 * Design: docs/ledger/2026-11-11-crm-brief-include-phone-calls.md
 */

import { supabaseAdmin } from '@/lib/supabase'

/** Calls older than this are history, not "where the conversation stands". */
export const CALL_LOOKBACK_DAYS = 30
/** At most this many of the newest calls go into one brief prompt. */
export const MAX_CALLS_IN_BRIEF = 3
const MAX_NOTE_CHARS = 500
/** PostgREST puts `in (...)` in the URL: keep each list short. */
const ID_CHUNK = 100

export interface CallNote {
  /** When the call happened (`contact_touchpoints.occurred_at`). */
  occurredAt: string
  /** When the AI call note was written (`telephony_call_analyses.created_at`). */
  analysisCreatedAt: string
  summary: string
}

/** contact id → that contact's recent call notes, oldest first. */
export type CallActivity = Map<string, CallNote[]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface CallTouch {
  contactId: string
  occurredAt: string
  analysisId: string
}

async function loadCallTouches(contactIds: readonly string[], sinceIso: string): Promise<CallTouch[]> {
  const out: CallTouch[] = []
  for (const ids of chunks(contactIds, ID_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id, occurred_at, metadata')
      .in('contact_id', ids)
      .eq('channel', 'phone')
      .gte('occurred_at', sinceIso)
    if (error) throw new Error(`call touchpoints read: ${error.message}`)
    for (const row of Array.isArray(data) ? data : []) {
      if (!isRecord(row) || typeof row.contact_id !== 'string' || typeof row.occurred_at !== 'string') continue
      const analysisId = isRecord(row.metadata) ? row.metadata.call_analysis_id : undefined
      if (typeof analysisId === 'string') out.push({ contactId: row.contact_id, occurredAt: row.occurred_at, analysisId })
    }
  }
  return out
}

async function loadAnalyses(analysisIds: readonly string[]): Promise<Map<string, { summary: string; createdAt: string }>> {
  const out = new Map<string, { summary: string; createdAt: string }>()
  for (const ids of chunks([...new Set(analysisIds)], ID_CHUNK)) {
    const { data, error } = await supabaseAdmin.from('telephony_call_analyses').select('id, summary, created_at').in('id', ids)
    if (error) throw new Error(`call analyses read: ${error.message}`)
    for (const row of Array.isArray(data) ? data : []) {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.created_at !== 'string') continue
      const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
      if (summary) out.set(row.id, { summary, createdAt: row.created_at })
    }
  }
  return out
}

/** Recent AI call notes of these contacts. Throws when a read fails (see the file header). */
export async function loadCallActivity(contactIds: readonly string[], now: Date): Promise<CallActivity> {
  const activity: CallActivity = new Map()
  const unique = [...new Set(contactIds)]
  if (unique.length === 0) return activity
  const sinceIso = new Date(now.getTime() - CALL_LOOKBACK_DAYS * 86_400_000).toISOString()
  const touches = await loadCallTouches(unique, sinceIso)
  if (touches.length === 0) return activity
  const analyses = await loadAnalyses(touches.map((t) => t.analysisId))
  for (const t of touches) {
    const a = analyses.get(t.analysisId)
    if (!a) continue
    const list = activity.get(t.contactId) ?? []
    list.push({ occurredAt: t.occurredAt, analysisCreatedAt: a.createdAt, summary: a.summary })
    activity.set(t.contactId, list)
  }
  for (const list of activity.values()) list.sort((x, y) => Date.parse(x.occurredAt) - Date.parse(y.occurredAt))
  return activity
}

/** Same read, for the contacts of the candidates of one run; a failed read is logged and means "no call info". */
export async function loadCallActivityOrEmpty(contactIds: readonly string[], now: Date): Promise<CallActivity> {
  try {
    return await loadCallActivity(contactIds, now)
  } catch (err) {
    console.error('[messenger/brief] call notes unreadable, briefs are written without phone calls this round:', err)
    return new Map()
  }
}

/** A call note was written after the stored brief was: the brief does not know about it. No brief yet = not "since". */
export function hasCallSinceBrief(notes: readonly CallNote[] | undefined, briefGeneratedAt: string | null | undefined): boolean {
  if (!notes || notes.length === 0 || !briefGeneratedAt) return false
  const generated = Date.parse(briefGeneratedAt)
  if (Number.isNaN(generated)) return false
  return notes.some((n) => Date.parse(n.analysisCreatedAt) > generated)
}

/** The lines the prompt shows, newest last: `2026-11-10 call: <note>`. Notes are AI text, never the customer's words. */
export function recentCallLines(notes: readonly CallNote[] | undefined): string[] {
  if (!notes) return []
  return notes.slice(-MAX_CALLS_IN_BRIEF).map((n) => {
    const day = n.occurredAt.slice(0, 10)
    const text = n.summary.length > MAX_NOTE_CHARS ? `${n.summary.slice(0, MAX_NOTE_CHARS)}…` : n.summary
    return `${day} call: ${text}`
  })
}
