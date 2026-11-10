/**
 * "Did the guest get in touch after this mail?": the first thing the guest did after the mail went out, judged by the
 * SAME rule the AI-takeover "came back" check uses (`customerCameBack`): a real email reply (not a Mailchimp open /
 * click, not an auto-reply, not a STOP), an answered inbound call, a chat message, or a form. Within
 * `REACTION_WINDOW_DAYS` of the mail, so a call three months later is not credited to it. Read-only. A failed or
 * incomplete read returns `null` (never "nobody reacted").
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { customerCameBack, toReengageTouchRow, type CameBackRow } from '@/lib/crm/ai-takeover/came-back'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import type { SendStatReaction } from './types'

/** Channels a guest can reach us on. Everything else the guest does (a Mailchimp open, a click) is not reaching out. */
export const REACTION_CHANNELS = ['email', 'phone', 'whatsapp', 'messenger', 'meta_lead_form', 'web_form'] as const
export const REACTION_WINDOW_DAYS = 14
const ID_CHUNK = 100
/** Rows per database page, and how many pages one batch of guests may take before the read counts as failed. */
const PAGE_SIZE = 1000
const MAX_PAGES = 10
const COLUMNS = 'contact_id, channel, direction, occurred_at, summary, raw, metadata, source'

export interface SentMail {
  /** Any key the caller wants back (the receipt id). */
  key: string
  contactId: string
  sentAt: string
}

export type ContactTouchRow = CameBackRow & { contact_id: string }

function isTouchRow(value: unknown): value is ContactTouchRow {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.contact_id === 'string' &&
    typeof v.channel === 'string' &&
    typeof v.occurred_at === 'string' &&
    (v.direction === 'inbound' || v.direction === 'outbound')
  )
}

/** Pure: the first qualifying thing each guest did after each mail (inside the window). */
export function firstReactions(sends: readonly SentMail[], rows: readonly ContactTouchRow[], now: Date): Map<string, SendStatReaction> {
  const byContact = new Map<string, ReengageTouch[]>()
  for (const r of rows) {
    const list = byContact.get(r.contact_id) ?? []
    list.push(toReengageTouchRow(r))
    byContact.set(r.contact_id, list)
  }
  const out = new Map<string, SendStatReaction>()
  for (const s of sends) {
    const until = Date.parse(s.sentAt) + REACTION_WINDOW_DAYS * 86_400_000
    const inWindow = (byContact.get(s.contactId) ?? []).filter((t) => Date.parse(t.occurredAt) <= until)
    const back = customerCameBack(inWindow, s.sentAt, now)
    if (back !== null) out.set(s.key, { at: back.at, kind: back.kind })
  }
  return out
}

async function readRows(db: SupabaseClient, clientId: string, ids: readonly string[], earliest: string): Promise<ContactTouchRow[]> {
  const rows: ContactTouchRow[] = []
  // The database hands back at most one page per call and cuts the rest silently: read page after page, in a fixed
  // order, until a short page. Too many pages = unreadable, never a quietly shortened list.
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error('too many inbound touches to read')
    const { data, error } = await db
      .from('contact_touchpoints')
      .select(COLUMNS)
      .eq('client_id', clientId)
      .eq('direction', 'inbound')
      .in('channel', [...REACTION_CHANNELS])
      .in('contact_id', [...ids])
      .gte('occurred_at', earliest)
      .order('occurred_at', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const got = Array.isArray(data) ? data : []
    for (const row of got) if (isTouchRow(row)) rows.push(row)
    if (got.length < PAGE_SIZE) return rows
  }
}

/** Reads the inbound touches of these mails' contacts since the earliest mail. `null` when a read fails. */
export async function loadReactions(
  db: SupabaseClient,
  clientId: string,
  sends: readonly SentMail[],
  now: Date = new Date(),
): Promise<Map<string, SendStatReaction> | null> {
  if (sends.length === 0) return new Map()
  const contactIds = [...new Set(sends.map((s) => s.contactId))]
  const earliest = sends.reduce((min, s) => (Date.parse(s.sentAt) < Date.parse(min) ? s.sentAt : min), sends[0]?.sentAt ?? '')
  const rows: ContactTouchRow[] = []
  try {
    for (let i = 0; i < contactIds.length; i += ID_CHUNK) rows.push(...(await readRows(db, clientId, contactIds.slice(i, i + ID_CHUNK), earliest)))
  } catch (err) {
    console.error('[crm/send-stats] 读客人回应失败（页面照常显示，回应那格标「读不到」）:', err instanceof Error ? err.message : err)
    return null
  }
  return firstReactions(sends, rows, now)
}
