/**
 * "Staff wrote: send the catalogue" — the guests whose staff note since their enquiry asks for the catalogue and who
 * have not been mailed from the CRM mailbox since (PM 2026-11-28: a note saying "follow up catalogue" used to send
 * nothing; the catalogue went out a day or two later, when somebody remembered, or never).
 *
 * These guests go to the top of the "交给 AI 跟进" page the same day. Releasing one sends the catalogue through the
 * existing route and leaves the guest WITH STAFF (no "AI 跟进中" mark): staff talked to them, or we cannot tell
 * (PM 11-12: once a person is in touch the guest stays with people). A guest the pickup rules already take
 * (rang, never reached) keeps that rule and goes to the AI as before.
 *
 * Not listed when anything says the ask may be settled or withdrawn (lean to "do nothing"):
 *   · a later staff note exists (it may say "no need" or "sent already": the ask must be the latest note),
 *   · staff messaged the guest personally since the enquiry (email / WhatsApp / Messenger: the catalogue may have gone
 *     from their own mailbox, which the send log does not see),
 *   · notes written by the system or with an approximate time (imported sheets) never count.
 * The note is only a hint for the list: rows are NOT pre-ticked, a person reads the note, ticks and releases, and
 * every send check still runs (the send itself refuses a guest who already has the catalogue).
 * Words are the caller's (a client can pass its own); the default is the plain vocabulary for a catalogue.
 */

import { isDoNotContact } from '@/lib/crm/dnc'
import { judgeEligibility, type EligibilityStage } from '@/lib/crm/catalogue-line/eligibility'
import { staffMessaged } from './pickup'
import type { PickupInputs } from './pickup-run'

export const DEFAULT_ASK_WORDS: readonly string[] = ['catalog', 'brochure', '目录', '宣传册', '手册']
/** Staff notes (not phone-system rows, not mail). */
const NOTE_SOURCES: ReadonlySet<string> = new Set(['me_manual', 'sheet_followup', 'manual'])
const NOTE_MAX = 140

export interface AskNote {
  occurredAt: string
  /** What staff wrote, for the list. */
  text: string
  /** Everything searched for the words (the note as typed and as shown). */
  search: string
  /** Written by the system, or with an approximate time (an imported sheet row): never an ask, never "the latest". */
  automated: boolean
}

export interface AskInput {
  /** The latest enquiry; null = none in the window. */
  leadAt: string | null
  /** Staff notes after the enquiry. */
  notes: readonly AskNote[]
  /** Staff sent the guest a personal email / chat message since the enquiry. */
  staffMessagedSinceLead: boolean
  hasTakeoverHistory: boolean
  /** The catalogue line's eligibility (do-not-contact, stage, snooze). */
  eligible: boolean
  hasActiveBooking: boolean
  hasEmail: boolean
  /** A mail went out (or may have) from the CRM mailbox since the enquiry: never a second catalogue. */
  crmMailedSinceLead: boolean
}

export interface AskDecision {
  leadAt: string
  noteAt: string
  /** The note, trimmed for the list. */
  note: string
}

export function mentionsCatalogue(text: string, words: readonly string[]): boolean {
  const t = text.toLowerCase()
  return words.some((w) => w !== '' && t.includes(w.toLowerCase()))
}

export function decideCatalogueAsk(input: AskInput, words: readonly string[] = DEFAULT_ASK_WORDS): AskDecision | null {
  if (input.leadAt === null || Number.isNaN(Date.parse(input.leadAt))) return null
  if (input.hasTakeoverHistory || !input.eligible || input.hasActiveBooking || !input.hasEmail || input.crmMailedSinceLead) return null
  if (input.staffMessagedSinceLead) return null
  const notes = input.notes
    .filter((n) => !n.automated && !Number.isNaN(Date.parse(n.occurredAt)))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  // The ask must be the latest thing staff wrote: a later note may withdraw it.
  const last = notes[notes.length - 1]
  if (last === undefined || !mentionsCatalogue(last.search, words)) return null
  return { leadAt: input.leadAt, noteAt: last.occurredAt, note: last.text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) }
}

/** Every guest with an enquiry in the window whose staff note asks for the catalogue; oldest note first. */
export function askAll(
  inputs: PickupInputs,
  leads: Map<string, string>,
  now: Date,
  words: readonly string[] = DEFAULT_ASK_WORDS,
): Array<AskDecision & { contactId: string }> {
  const idsOf = (rows: Array<{ contact_id: string }>) => new Set(rows.map((r) => r.contact_id))
  const withEvents = idsOf(inputs.events)
  const withEmail = idsOf(inputs.emails)
  const booked = idsOf(inputs.bookings)
  const stages: EligibilityStage[] = inputs.stages.map((s) => ({ stageKey: s.stage_key, marketingAction: s.marketing_action, isTerminal: s.is_terminal }))
  const touchesOf = new Map<string, PickupInputs['touches']>()
  for (const t of inputs.touches) touchesOf.set(t.contact_id, [...(touchesOf.get(t.contact_id) ?? []), t])
  const out: Array<AskDecision & { contactId: string }> = []
  for (const c of inputs.contacts) {
    const leadAt = leads.get(c.id) ?? null
    if (leadAt === null || c.ai_takeover_since !== null) continue
    const all = touchesOf.get(c.id) ?? []
    const dnc = isDoNotContact(c.do_not_contact === true, all.map((t) => ({
      outcome: typeof t.metadata?.outcome === 'string' ? t.metadata.outcome : null,
      flagged: t.metadata?.do_not_contact === true,
      occurredAt: t.occurred_at,
    })))
    const mailed = inputs.crmMailed.get(c.id)
    const after = all.filter((t) => Date.parse(t.occurred_at) > Date.parse(leadAt))
    const decision = decideCatalogueAsk({
      leadAt,
      notes: after
        .filter((t) => t.source !== null && NOTE_SOURCES.has(t.source))
        .map((t) => ({
          occurredAt: t.occurred_at, text: t.raw ?? t.summary ?? '', search: `${t.raw ?? ''} ${t.summary ?? ''}`,
          automated: t.metadata?.automated === true || t.metadata?.time_is_approximate === true,
        })),
      staffMessagedSinceLead: staffMessaged(after.map((t) => ({ channel: t.channel, direction: t.direction, source: t.source, occurredAt: t.occurred_at, metadata: t.metadata }))),
      hasTakeoverHistory: withEvents.has(c.id),
      eligible: judgeEligibility({ doNotContact: dnc, stage: c.stage, snoozeUntil: c.snooze_until }, stages, now).ok,
      hasActiveBooking: booked.has(c.id),
      hasEmail: withEmail.has(c.id),
      crmMailedSinceLead: mailed !== undefined && Date.parse(mailed) > Date.parse(leadAt),
    }, words)
    if (decision !== null) out.push({ contactId: c.id, ...decision })
  }
  return out.sort((a, b) => Date.parse(a.noteAt) - Date.parse(b.noteAt))
}
