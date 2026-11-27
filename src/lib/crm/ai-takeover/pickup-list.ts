/**
 * The "交给 AI 跟进" page's list: the guests the AI pickup rules would take today, in the order they would go.
 * Read-only. The page sends each ticked guest through the existing "发送 2027 目录" route, which sends first and
 * marks "AI 跟进中" only after a confirmed send — so nobody leaves the staff list until their catalogue is out.
 *
 * Per guest, in order (oldest enquiry first):
 *   tomorrow     — contacted today already (any outbound call / email / message today, client's time zone): one touch a
 *                  day is enough, the guest moves to tomorrow's list
 *   cannot_send  — the mail check says no (no usable email, mailbox not connected, …), with its message
 *   ready        — can go today; at most `dailyMax` minus the catalogues already sent today (the client mailbox's daily
 *                  room, and the guests leave the staff list once sent) — so a refresh after a batch adds nobody
 * Guests whose staff note asks for the catalogue (catalogue-ask.ts) come first, the same day the note is written
 * (no "tomorrow" for them: the note IS today's contact), and stay with staff after the send (`keepWithStaff`).
 *   queued       — over today's room, or past the mail-check budget (2 × dailyMax checks per list, so a mailbox that
 *                  refuses everyone cannot make the list time out): on a later day's list
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import { askAll, DEFAULT_ASK_WORDS } from './catalogue-ask'
import { isSystemCall } from './call-reach'
import { DEFAULT_PICKUP_CONFIG, type PickupConfig, type PickupRule } from './pickup'
import { decideAll, latestEnquiries, loadInputs, type PickupInputs } from './pickup-run'

export type PickupListStatus = 'ready' | 'tomorrow' | 'cannot_send' | 'queued'

export interface PickupListRow {
  contactId: string
  name: string
  rule: PickupRule | 'catalogue_asked'
  /** true = send the catalogue only; the guest stays on the staff list (no "AI 跟进中"). */
  keepWithStaff: boolean
  why: string
  leadAt: string
  /** Staff dial-outs through the phone system since the enquiry. */
  dials: number
  lastCallAt: string | null
  /** The latest staff note since the enquiry, trimmed. */
  lastNote: string | null
  status: PickupListStatus
  /** ready / queued: who it goes to; cannot_send: why not. */
  recipient: string | null
  sentLast7Days: number | null
  message: string | null
}

export interface PickupListDeps {
  compose(contactId: string): Promise<ComposePreview>
  timeZone: string
  loadNames(ids: string[]): Promise<Map<string, string>>
  /** Catalogues this client already sent (or may have sent) today, in the client's time zone. */
  sentToday(today: string): Promise<number>
}

/** How many mail checks run at once. */
const PARALLEL_CHECKS = 8

const NOTE_SOURCES: ReadonlySet<string> = new Set(['me_manual', 'sheet_followup', 'manual'])

function facts(inputs: PickupInputs, contactId: string, leadAt: string, today: string, zone: string) {
  const after = inputs.touches.filter((t) => t.contact_id === contactId && Date.parse(t.occurred_at) > Date.parse(leadAt))
  const dials = after.filter((t) => t.channel === 'phone' && t.direction === 'outbound' && isSystemCall(t.source))
  const notes = after.filter((t) => t.channel === 'phone' && t.source !== null && NOTE_SOURCES.has(t.source))
  const lastNote = notes.length === 0 ? null : (notes[notes.length - 1].raw ?? notes[notes.length - 1].summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || null
  const contactedToday = after.some((t) => t.direction === 'outbound' && todayInZone(new Date(t.occurred_at), zone) === today)
  return { dials: dials.length, lastCallAt: dials.length === 0 ? null : dials[dials.length - 1].occurred_at, lastNote, contactedToday }
}

export async function loadPickupList(
  sb: SupabaseClient,
  clientId: string,
  deps: PickupListDeps,
  opts: { now?: Date; dailyMax: number; cfg?: PickupConfig; askWords?: readonly string[] },
): Promise<PickupListRow[]> {
  const now = opts.now ?? new Date()
  const leads = await latestEnquiries(sb, clientId, now)
  const inputs = await loadInputs(sb, clientId, [...leads.keys()])
  const picks = decideAll(inputs, leads, now, opts.cfg ?? DEFAULT_PICKUP_CONFIG)
  const taken = new Set(picks.map((p) => p.contactId))
  // A guest the pickup rules already take keeps that rule (rang, never reached: the AI follows up, PM 11-16).
  const asks = askAll(inputs, leads, now, opts.askWords ?? DEFAULT_ASK_WORDS).filter((a) => !taken.has(a.contactId))
  const names = await deps.loadNames([...asks.map((a) => a.contactId), ...picks.map((p) => p.contactId)])
  const today = todayInZone(now, deps.timeZone)
  const room = Math.max(0, opts.dailyMax - (await deps.sentToday(today)))
  const checkBudget = opts.dailyMax * 2
  const askRows: PickupListRow[] = asks.map((a) => {
    const f = facts(inputs, a.contactId, a.leadAt, today, deps.timeZone)
    return { contactId: a.contactId, name: names.get(a.contactId) ?? '（没名字）', rule: 'catalogue_asked', keepWithStaff: true,
      why: '员工留言要发目录。发出后客人仍留在员工名单上，不交给 AI。', leadAt: a.leadAt,
      dials: f.dials, lastCallAt: f.lastCallAt, lastNote: a.note, recipient: null, sentLast7Days: null, message: null, status: 'queued' }
  })
  const pickRows: PickupListRow[] = picks.map((p) => {
    const f = facts(inputs, p.contactId, p.leadAt, today, deps.timeZone)
    return { contactId: p.contactId, name: names.get(p.contactId) ?? '（没名字）', rule: p.rule, keepWithStaff: false, why: p.why, leadAt: p.leadAt,
      dials: f.dials, lastCallAt: f.lastCallAt, lastNote: f.lastNote, recipient: null, sentLast7Days: null, message: null,
      status: f.contactedToday ? 'tomorrow' : 'queued' }
  })
  const rows = [...askRows, ...pickRows]
  for (const r of rows) r.message = r.status === 'tomorrow' ? '今天已经联系过，明天再发。' : '今天的名额满了，排到后面几天。'
  // Mail checks run a few at a time (each is a dozen reads; one by one took over a minute in production), in list
  // order, never more at once than the room left, so the oldest enquiries still get the places.
  const open = rows.filter((r) => r.status === 'queued')
  let ready = 0
  let checks = 0
  let i = 0
  while (i < open.length && ready < room && checks < checkBudget) {
    const batch = open.slice(i, i + Math.min(PARALLEL_CHECKS, room - ready, checkBudget - checks))
    i += batch.length
    checks += batch.length
    const results = await Promise.all(batch.map((r) => deps.compose(r.contactId)))
    batch.forEach((r, k) => {
      const c = results[k]
      if (!c.canCompose) Object.assign(r, { status: 'cannot_send', message: c.message })
      else Object.assign(r, { status: 'ready', recipient: c.recipient, sentLast7Days: c.sentToContactLast7Days, message: null })
      if (c.canCompose) ready++
    })
  }
  return rows
}
