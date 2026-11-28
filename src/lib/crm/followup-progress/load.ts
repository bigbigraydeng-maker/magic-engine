/**
 * Reads one client's whole guest book and sorts every guest into a follow-up group (`groups.ts`), plus what happened
 * in the last 7 days. Read-only: not one write. Every read throws on error — a half-read book would show small
 * numbers that look like progress.
 *
 * Used by the page "跟进进度" (live) and by the daily snapshot (`inngest/functions/crm-followup-progress-daily`).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll, fetchAllParallel } from '@/lib/supabase-paginate'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { isHumanFollowup } from '@/lib/crm/lead-followup-due'
import { isMarketingAction, type MarketingAction } from '@/lib/crm/pipeline'
import { engagementFromMetadata } from '@/lib/crm/segments'
import { ENQUIRY_FORM_CHANNELS, isMeTestContact } from '@/lib/crm/enquiry-daily-digest'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { contactKindOf, isSystemAccountName, readDomainRules, type DomainRules } from '@/lib/crm/contact-kind'
import { isAutoReply } from '@/lib/microsoft/auto-reply'
import { hasHumanProgressed } from '@/lib/crm/contact-list-view'
import { senderShapeOf } from '@/lib/crm/enquiry-screen/sender-shape'
import { countGroups, groupOf, type GroupConfig, type GroupCounts, type GroupVerdict, type GuestFacts, DEFAULT_GROUP_CONFIG } from './groups'

const DAY_MS = 86_400_000
export const WEEK_DAYS = 7

/** Channels where an inbound row is the guest's own words. Messenger is one row per whole thread, so it cannot say who spoke last. */
const GUEST_MESSAGE_CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp', 'phone', 'sms'])

interface ContactRow {
  id: string
  display_name: string | null
  do_not_contact: boolean | null
  stage: string | null
  ai_takeover_since: string | null
  snooze_until: string | null
  primary_email: string | null
  primary_phone: string | null
}

interface IdentityRow { contact_id: string; kind: string; value: string }

export interface TouchRow {
  contact_id: string | null
  channel: string
  direction: string | null
  source: string | null
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

interface StageRow { stage_key: string; marketing_action: string | null; is_terminal: boolean | null }

/** What happened in the last 7 days, counted in guests (not in messages). */
export interface WeekActivity {
  /** Guests a person on our side contacted. */
  guestsContactedByStaff: number
  /** Guests who wrote or rang in their own words. */
  guestsWhoReplied: number
  /** Guests who filled an enquiry form. */
  newEnquiries: number
  /** Guests moved into one of the client's qualified stages. */
  movedToQualified: number
  /** New active bookings. */
  newBookings: number
  /** Guests the AI follow-up took on. */
  takenByAi: number
}

export interface FollowupProgress {
  clientId: string
  at: string
  counts: GroupCounts
  week: WeekActivity
}

/** Contact id → the verdict, for callers that need names per group later. */
export interface FollowupProgressDetail extends FollowupProgress {
  verdicts: Map<string, GroupVerdict>
  /** Contact id → when the guest last filled a form / last spoke, for callers that list a group in order. */
  dates: Map<string, { lastEnquiryAt: string | null; lastGuestMessageAt: string | null }>
}

function later(a: string | null, b: string): string {
  return a === null || Date.parse(b) > Date.parse(a) ? b : a
}

/** The mail's subject: the sync keeps it in metadata, older rows only in the summary. */
function subjectOf(t: TouchRow): string | null {
  const s = t.metadata?.subject
  return typeof s === 'string' ? s : t.summary
}

/** The guest's own words. Not a machine: an out-of-office or a bounce after a bulk send is nobody speaking. */
function isGuestMessage(t: TouchRow): boolean {
  if (t.direction !== 'inbound' || !GUEST_MESSAGE_CHANNELS.has(t.channel)) return false
  if (isAutomatedTouch(t.source, t.metadata)) return false
  // A call the guest made and nobody answered still counts: the guest reached out and is waiting for us.
  return !(t.channel === 'email' && isAutoReply(subjectOf(t)))
}

function isEnquiry(t: TouchRow): boolean {
  return t.direction === 'inbound' && (ENQUIRY_FORM_CHANNELS as readonly string[]).includes(t.channel)
}

function isEngagement(t: TouchRow): boolean {
  return t.direction === 'inbound' && (engagementFromMetadata(t.metadata) !== null || t.source === 'mailchimp')
}

export interface Acc { staff: string | null; guest: string | null; guestChannel: string | null; enquiry: string | null; engaged: string | null; dnc: DncTouch[] }

/** One pass over a guest's touchpoints → the dated facts the groups read. Exported for tests. */
export function touchFacts(touches: readonly TouchRow[]): Acc {
  const a: Acc = { staff: null, guest: null, guestChannel: null, enquiry: null, engaged: null, dnc: [] }
  for (const t of touches) {
    const outcome = typeof t.metadata?.outcome === 'string' ? t.metadata.outcome : null
    a.dnc.push({ outcome, flagged: t.metadata?.do_not_contact === true, occurredAt: t.occurred_at })
    if (isEnquiry(t)) a.enquiry = later(a.enquiry, t.occurred_at)
    else if (isEngagement(t)) a.engaged = later(a.engaged, t.occurred_at)
    else if (isGuestMessage(t) && later(a.guest, t.occurred_at) === t.occurred_at) {
      a.guest = t.occurred_at
      a.guestChannel = t.channel
    }
    // A call the guest made and we answered is both: the guest spoke and a person on our side took it.
    if (isHumanFollowup({ channel: t.channel, direction: t.direction, occurredAt: t.occurred_at, source: t.source, metadata: t.metadata })) {
      a.staff = later(a.staff, t.occurred_at)
    }
  }
  return a
}

async function readBook(sb: SupabaseClient, clientId: string) {
  const [contacts, touches, stages, bookings, identities, cfg, client] = await Promise.all([
    fetchAll<ContactRow>((from, to) =>
      sb.from('contacts').select('id, display_name, do_not_contact, stage, ai_takeover_since, snooze_until, primary_email, primary_phone')
        .eq('client_id', clientId).order('id', { ascending: true }).range(from, to)),
    // Many pages for a busy client: read them at once. `id` is the tie-break that keeps page edges stable and
    // proves the read is complete (same pattern as the "今天先联系" list).
    fetchAllParallel<TouchRow & { id: string }>(
      (from, to, withCount) =>
        sb.from('contact_touchpoints').select('id, contact_id, channel, direction, source, occurred_at, summary, metadata', withCount ? { count: 'exact' } : undefined)
          .eq('client_id', clientId).order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
      (row) => row.id,
    ),
    fetchAll<StageRow>((from, to) =>
      sb.from('client_pipeline_stages').select('stage_key, marketing_action, is_terminal')
        .eq('client_id', clientId).order('stage_key', { ascending: true }).range(from, to)),
    fetchAll<{ contact_id: string; created_at: string }>((from, to) =>
      sb.from('crm_bookings').select('contact_id, created_at')
        .eq('client_id', clientId).eq('status', 'active').order('id', { ascending: true }).range(from, to)),
    // Every address and number a guest has, not just the first one kept on the contact row.
    fetchAll<IdentityRow>((from, to) =>
      sb.from('contact_identities').select('contact_id, kind, value')
        .eq('client_id', clientId).in('kind', ['email', 'phone']).order('id', { ascending: true }).range(from, to)),
    sb.from('ad_strategy_configs').select('qualified_stage_keys').eq('client_id', clientId).maybeSingle(),
    sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle(),
  ])
  if (cfg.error) throw new Error(cfg.error.message)
  if (client.error) throw new Error(client.error.message)
  const rules = readDomainRules((client.data as { leads_config?: unknown } | null)?.leads_config)
  const keys = (cfg.data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  const qualified = new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [])
  return { contacts, touches, stages, bookings, identities, qualified, rules }
}

async function readWeekEvents(sb: SupabaseClient, clientId: string, sinceIso: string) {
  const [stageEvents, takeovers] = await Promise.all([
    fetchAll<{ contact_id: string; from_stage: string | null; to_stage: string | null }>((from, to) =>
      sb.from('contact_stage_events').select('contact_id, from_stage, to_stage')
        .eq('client_id', clientId).gte('created_at', sinceIso).order('id', { ascending: true }).range(from, to)),
    fetchAll<{ contact_id: string }>((from, to) =>
      sb.from('contact_automation_events').select('contact_id')
        .eq('client_id', clientId).eq('kind', 'ai_takeover_on').gte('created_at', sinceIso).order('id', { ascending: true }).range(from, to)),
  ])
  return { stageEvents, takeovers }
}

function nonEmpty(v: string | null): boolean {
  return v !== null && v.trim() !== ''
}

interface BookIndex {
  stageOf: Map<string, { action: MarketingAction | null; terminal: boolean }>
  booked: Set<string>
  touchesOf: Map<string, TouchRow[]>
  emailsOf: Map<string, string[]>
  hasPhone: Set<string>
  rules: DomainRules
}

function bookIndex(book: { stages: StageRow[]; bookings: Array<{ contact_id: string }>; touches: TouchRow[]; identities: IdentityRow[]; rules: DomainRules }): BookIndex {
  const stageOf: BookIndex['stageOf'] = new Map()
  for (const s of book.stages) stageOf.set(s.stage_key, { action: isMarketingAction(s.marketing_action) ? s.marketing_action : null, terminal: s.is_terminal === true })
  const touchesOf = new Map<string, TouchRow[]>()
  for (const t of book.touches) {
    if (t.contact_id === null) continue
    const list = touchesOf.get(t.contact_id)
    if (list) list.push(t)
    else touchesOf.set(t.contact_id, [t])
  }
  const emailsOf = new Map<string, string[]>()
  const hasPhone = new Set<string>()
  for (const i of book.identities) {
    if (i.kind === 'phone') hasPhone.add(i.contact_id)
    else emailsOf.set(i.contact_id, [...(emailsOf.get(i.contact_id) ?? []), i.value])
  }
  return { stageOf, booked: new Set(book.bookings.map((b) => b.contact_id)), touchesOf, emailsOf, hasPhone, rules: book.rules }
}

/**
 * A sender that does not look like a guest enquiring (bulk mail, supplier notice, sales pitch, platform account).
 * Only for a contact nobody has touched in any way: no person moved the stage on, the contact never filled a form,
 * and we never called or wrote. That is the same narrow range as the "今天先联系" list's own rule
 * (`demoteNonEnquirySender`, new-and-untouched only): a guest who enquired is never dropped for an odd address.
 */
export function looksLikeNonEnquiry(c: { stage: string | null; primary_email: string | null; display_name: string | null }, a: Pick<Acc, 'enquiry' | 'staff'>): boolean {
  if (a.enquiry !== null || a.staff !== null || hasHumanProgressed(c.stage)) return false
  return senderShapeOf({ email: c.primary_email, displayName: c.display_name }) !== null
}

function guestFacts(c: ContactRow, a: Acc, index: BookIndex, qualified: ReadonlySet<string>, now: Date): GuestFacts {
  const st = c.stage === null ? undefined : index.stageOf.get(c.stage)
  const emails = [...(index.emailsOf.get(c.id) ?? [])]
  if (nonEmpty(c.primary_email) && !emails.includes(c.primary_email as string)) emails.push(c.primary_email as string)
  const snooze = c.snooze_until === null ? NaN : Date.parse(c.snooze_until)
  return {
    doNotContact: isDoNotContact(c.do_not_contact === true, a.dnc),
    // Same judgement as the "今天先联系" list: by email domain, by system-account name, by the test-lead name.
    notGuest: contactKindOf(emails, index.rules) !== 'retail' || isSystemAccountName(c.display_name) || isMeTestContact(c.display_name) || looksLikeNonEnquiry(c, a),
    hasActiveBooking: index.booked.has(c.id),
    stage: c.stage,
    stageAction: st?.action ?? null,
    stageTerminal: st?.terminal ?? false,
    qualified: c.stage !== null && qualified.has(c.stage),
    aiTakeoverSince: c.ai_takeover_since,
    snoozed: Number.isFinite(snooze) && snooze > now.getTime(),
    hasEmail: emails.length > 0,
    hasPhone: nonEmpty(c.primary_phone) || index.hasPhone.has(c.id),
    lastStaffAt: a.staff,
    lastGuestMessageAt: a.guest,
    lastGuestMessageChannel: a.guestChannel,
    lastEnquiryAt: a.enquiry,
    lastEngagedAt: a.engaged,
  }
}

/** Everything the page and the snapshot need for one client. */
export async function loadFollowupProgress(
  sb: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
  cfg: GroupConfig = DEFAULT_GROUP_CONFIG,
): Promise<FollowupProgressDetail> {
  const sinceMs = now.getTime() - WEEK_DAYS * DAY_MS
  const sinceIso = new Date(sinceMs).toISOString()
  const [book, weekEvents] = await Promise.all([readBook(sb, clientId), readWeekEvents(sb, clientId, sinceIso)])

  const index = bookIndex(book)
  const verdicts = new Map<string, GroupVerdict>()
  const dates: FollowupProgressDetail['dates'] = new Map()
  const staffWeek = new Set<string>()
  const repliedWeek = new Set<string>()
  const enquiryWeek = new Set<string>()
  for (const c of book.contacts) {
    const a = touchFacts(index.touchesOf.get(c.id) ?? [])
    const verdict = groupOf(guestFacts(c, a, index, book.qualified, now), now, cfg)
    verdicts.set(c.id, verdict)
    dates.set(c.id, { lastEnquiryAt: a.enquiry, lastGuestMessageAt: a.guest })
    // The week's numbers count guests: people in the follow-up work or already booked. Staff, trade partners,
    // sales pitches and closed contacts are not "guests who wrote".
    if (!verdict.inScope && verdict.why !== 'booked') continue
    if (a.staff !== null && Date.parse(a.staff) >= sinceMs) staffWeek.add(c.id)
    if (a.guest !== null && Date.parse(a.guest) >= sinceMs) repliedWeek.add(c.id)
    if (a.enquiry !== null && Date.parse(a.enquiry) >= sinceMs) enquiryWeek.add(c.id)
  }

  // Into a qualified stage from outside them: a move between two qualified stages is not a new qualified guest.
  const movedToQualified = new Set(weekEvents.stageEvents.filter((e) => e.to_stage !== null && book.qualified.has(e.to_stage) && !(e.from_stage !== null && book.qualified.has(e.from_stage))).map((e) => e.contact_id))
  return {
    clientId,
    at: now.toISOString(),
    counts: countGroups(verdicts.values()),
    week: {
      guestsContactedByStaff: staffWeek.size,
      guestsWhoReplied: repliedWeek.size,
      newEnquiries: enquiryWeek.size,
      movedToQualified: movedToQualified.size,
      newBookings: book.bookings.filter((b) => Date.parse(b.created_at) >= sinceMs).length,
      takenByAi: new Set(weekEvents.takeovers.map((t) => t.contact_id)).size,
    },
    verdicts,
    dates,
  }
}
