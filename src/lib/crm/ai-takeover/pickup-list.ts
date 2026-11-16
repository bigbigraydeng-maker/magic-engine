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
 *   queued       — over today's room, or past the mail-check budget (2 × dailyMax checks per list, so a mailbox that
 *                  refuses everyone cannot make the list time out): on a later day's list
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import { isSystemCall } from './call-reach'
import { DEFAULT_PICKUP_CONFIG, type PickupConfig, type PickupRule } from './pickup'
import { decideAll, latestEnquiries, loadInputs, type PickupInputs } from './pickup-run'

export type PickupListStatus = 'ready' | 'tomorrow' | 'cannot_send' | 'queued'

export interface PickupListRow {
  contactId: string
  name: string
  rule: PickupRule
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
  opts: { now?: Date; dailyMax: number; cfg?: PickupConfig },
): Promise<PickupListRow[]> {
  const now = opts.now ?? new Date()
  const leads = await latestEnquiries(sb, clientId, now)
  const inputs = await loadInputs(sb, clientId, [...leads.keys()])
  const picks = decideAll(inputs, leads, now, opts.cfg ?? DEFAULT_PICKUP_CONFIG)
  const names = await deps.loadNames(picks.map((p) => p.contactId))
  const today = todayInZone(now, deps.timeZone)
  const room = Math.max(0, opts.dailyMax - (await deps.sentToday(today)))
  const checkBudget = opts.dailyMax * 2
  const rows: PickupListRow[] = []
  let ready = 0
  let checks = 0
  for (const p of picks) {
    const f = facts(inputs, p.contactId, p.leadAt, today, deps.timeZone)
    const base = { contactId: p.contactId, name: names.get(p.contactId) ?? '（没名字）', rule: p.rule, why: p.why, leadAt: p.leadAt,
      dials: f.dials, lastCallAt: f.lastCallAt, lastNote: f.lastNote, recipient: null, sentLast7Days: null, message: null }
    if (f.contactedToday) {
      rows.push({ ...base, status: 'tomorrow', message: '今天已经联系过，明天再发。' })
      continue
    }
    if (ready >= room || checks >= checkBudget) {
      rows.push({ ...base, status: 'queued', message: '今天的名额满了，排到后面几天。' })
      continue
    }
    checks++
    const c = await deps.compose(p.contactId)
    if (!c.canCompose) {
      rows.push({ ...base, status: 'cannot_send', message: c.message })
      continue
    }
    ready++
    rows.push({ ...base, status: 'ready', recipient: c.recipient, sentLast7Days: c.sentToContactLast7Days })
  }
  return rows
}
