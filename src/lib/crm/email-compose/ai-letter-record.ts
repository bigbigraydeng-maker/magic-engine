/**
 * The record of a letter the AI drafted for a guest (table `crm_ai_letters`), so every AI letter can be told apart,
 * followed and learned from (PM 2026-11-28: 「ai 写的信一定要有标记，做跟踪和学习，分析」).
 *
 * Two writes, nothing else:
 *   1. `recordAiDraft` — when the AI hands a draft to a page: where, what it wrote, its checks, who asked.
 *   2. `linkAiLetterForSend` — when a person presses send, BEFORE the send runs: the request id of this send, the
 *      text that will go, whether it was edited, who released it.
 * Fail-closed both ways: a draft that cannot be recorded is not handed out, and a send whose link cannot be written does
 * not run — an AI letter must never reach a guest unmarked.
 *
 * Whether the mail went, and what the guest did next, is NOT stored here: it is read by request id from the send
 * receipts and the guest's touchpoints, stage and bookings, so there is one source of truth.
 * Design: docs/specs/2026-11-28-crm-ai-letter-tracking-design-v0.md
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const AI_LETTER_SURFACES = ['drawer', 'letters_page', 'day7_page'] as const
export type AiLetterSurface = (typeof AI_LETTER_SURFACES)[number]
export type AiDraftKind = 'first' | 'follow_up'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Missing = the drawer (the only caller before pages said where they are). Anything else unknown = invalid. */
export function parseSurface(v: unknown): AiLetterSurface | null {
  if (v === undefined || v === null) return 'drawer'
  return typeof v === 'string' && (AI_LETTER_SURFACES as readonly string[]).includes(v) ? (v as AiLetterSurface) : null
}

/** Missing = not an AI letter. Present but not a uuid = invalid (never silently treated as "not AI"). */
export function parseAiLetterId(v: unknown): { ok: true; id: string | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, id: null }
  return typeof v === 'string' && UUID_RE.test(v) ? { ok: true, id: v } : { ok: false }
}

export interface AiDraftRecord {
  clientId: string
  contactId: string
  surface: AiLetterSurface
  kind: AiDraftKind
  subject: string
  body: string
  checks: ReadonlyArray<{ id: string; status: string; label: string; detail: string }>
  actorEmail: string
}

/** Writes the draft and returns its id. Throws when it cannot: the caller must not hand the draft out then. */
export async function recordAiDraft(db: SupabaseClient, r: AiDraftRecord): Promise<string> {
  const { data, error } = await db
    .from('crm_ai_letters')
    .insert({
      client_id: r.clientId, contact_id: r.contactId, surface: r.surface, draft_kind: r.kind,
      ai_subject: r.subject, ai_body: r.body, ai_checks: r.checks, drafted_by: r.actorEmail,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`crm_ai_letters insert: ${error?.message ?? 'no row'}`)
  return (data as { id: string }).id
}

export interface AiLetterLink {
  clientId: string
  contactId: string
  aiLetterId: string
  requestId: string
  actorEmail: string
  subject: string
  body: string
  now: Date
}

export type LinkResult = { ok: true; edited: boolean } | { ok: false; reason: 'not_found' | 'other_send' | 'write_failed' }

/** A send attempt that went out, or whose outcome is not known yet, counts as used. */
async function requestWasSent(db: SupabaseClient, clientId: string, requestId: string): Promise<boolean | null> {
  const { data, error } = await db
    .from('crm_email_send_receipts')
    .select('id')
    .eq('client_id', clientId)
    .eq('request_id', requestId)
    .in('outcome', ['sent', 'unknown'])
    .limit(1)
  if (error) return null
  return (data ?? []).length > 0
}

/**
 * Another AI letter already holds this request id (staff redrafted after a refused send, and the page kept the same
 * request id). If that send never went, the older letter lets go of the id; if it went, or might have, refuse.
 */
async function freeRequestId(db: SupabaseClient, l: AiLetterLink): Promise<LinkResult | null> {
  const other = await db
    .from('crm_ai_letters')
    .select('id')
    .eq('client_id', l.clientId)
    .eq('request_id', l.requestId)
    .neq('id', l.aiLetterId)
    .maybeSingle()
  if (other.error) return { ok: false, reason: 'write_failed' }
  if (other.data === null) return null
  const sent = await requestWasSent(db, l.clientId, l.requestId)
  if (sent === null) return { ok: false, reason: 'write_failed' }
  if (sent) return { ok: false, reason: 'other_send' }
  const cleared = await db
    .from('crm_ai_letters')
    .update({ request_id: null, released_by: null, released_at: null, final_subject: null, final_body: null, edited: null })
    .eq('id', (other.data as { id: string }).id)
    .eq('client_id', l.clientId)
    .eq('request_id', l.requestId)
  return cleared.error ? { ok: false, reason: 'write_failed' } : null
}

/**
 * Ties one send to its AI letter, before the send. The letter must belong to this client and this guest.
 * A letter already tied to a different send is refused: one AI letter, one send (a retry of the same send keeps its
 * request id and passes). The update only lands while the letter is still free or tied to this same send, so two
 * sends racing for one letter cannot both pass.
 */
export async function linkAiLetterForSend(db: SupabaseClient, l: AiLetterLink): Promise<LinkResult> {
  const read = await db
    .from('crm_ai_letters')
    .select('id, ai_subject, ai_body, request_id')
    .eq('id', l.aiLetterId)
    .eq('client_id', l.clientId)
    .eq('contact_id', l.contactId)
    .maybeSingle()
  if (read.error) return { ok: false, reason: 'write_failed' }
  const row = read.data as { ai_subject: string; ai_body: string; request_id: string | null } | null
  if (row === null) return { ok: false, reason: 'not_found' }
  if (row.request_id !== null && row.request_id !== l.requestId) return { ok: false, reason: 'other_send' }
  const edited = row.ai_subject !== l.subject || row.ai_body !== l.body
  const freed = await freeRequestId(db, l)
  if (freed !== null) return freed
  const write = await db
    .from('crm_ai_letters')
    .update({
      request_id: l.requestId, released_by: l.actorEmail, released_at: l.now.toISOString(),
      final_subject: l.subject, final_body: l.body, edited,
    })
    .eq('id', l.aiLetterId)
    .eq('client_id', l.clientId)
    .eq('contact_id', l.contactId)
    .or(`request_id.is.null,request_id.eq.${l.requestId}`)
    .select('id')
  if (write.error || (write.data ?? []).length !== 1) return { ok: false, reason: 'write_failed' }
  return { ok: true, edited }
}

/** What staff read when the link refuses the send. Nothing has been sent in any of these cases. */
// All 409: in every case nothing was sent, and the pages read 502/503 as "outcome unknown, do not resend".
export const LINK_REFUSAL: Record<Exclude<LinkResult, { ok: true }>['reason'], { status: 409; message: string }> = {
  not_found: { status: 409, message: '这封信对不上 AI 起草的记录（可能是别的客人的稿子），没有发。请重新让 AI 起草。' },
  other_send: { status: 409, message: '这份 AI 稿子已经发过一次了，没有再发。要再写一封，请重新让 AI 起草。' },
  write_failed: { status: 409, message: '「AI 起草」的标记没记上，这封没有发。稍后再点一次发送。' },
}
