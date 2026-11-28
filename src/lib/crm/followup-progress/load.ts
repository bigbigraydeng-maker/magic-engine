/**
 * Reads one client's whole guest book and sorts every guest into a follow-up group (`groups.ts`), plus what happened
 * in the last 7 days. Read-only: not one write. Every read throws on error — a half-read book would show small
 * numbers that look like progress.
 *
 * Used by the page "跟进进度" (live) and by the daily snapshot (`inngest/functions/crm-followup-progress-daily`).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { isHumanFollowup } from '@/lib/crm/lead-followup-due'
import { isMarketingAction, type MarketingAction } from '@/lib/crm/pipeline'
import { engagementFromMetadata } from '@/lib/crm/segments'
import { ENQUIRY_FORM_CHANNELS } from '@/lib/crm/enquiry-daily-digest'
import { countGroups, groupOf, type GroupConfig, type GroupCounts, type GroupVerdict, type GuestFacts, DEFAULT_GROUP_CONFIG } from './groups'

const DAY_MS = 86_400_000
export const WEEK_DAYS = 7

/** Channels where an inbound row is the guest's own words. Messenger is one row per whole thread, so it cannot say who spoke last. */
const GUEST_MESSAGE_CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp', 'phone', 'sms'])

interface ContactRow {
  id: string
  do_not_contact: boolean | null
  stage: string | null
  ai_takeover_since: string | null
  primary_email: string | null
  primary_phone: string | null
}

export interface TouchRow {
  contact_id: string | null
  channel: string
  direction: string | null
  source: string | null
  occurred_at: string
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
}

function later(a: string | null, b: string): string {
  return a === null || Date.parse(b) > Date.parse(a) ? b : a
}

function isGuestMessage(t: TouchRow): boolean {
  if (t.direction !== 'inbound' || !GUEST_MESSAGE_CHANNELS.has(t.channel)) return false
  if (engagementFromMetadata(t.metadata) !== null) return false
  // A call the guest made and nobody answered still counts: the guest reached out and is waiting for us.
  return t.source !== 'mailchimp'
}

function isEnquiry(t: TouchRow): boolean {
  return t.direction === 'inbound' && (ENQUIRY_FORM_CHANNELS as readonly string[]).includes(t.channel)
}

function isEngagement(t: TouchRow): boolean {
  return t.direction === 'inbound' && (engagementFromMetadata(t.metadata) !== null || t.source === 'mailchimp')
}

export interface Acc { staff: string | null; guest: string | null; enquiry: string | null; engaged: string | null; dnc: DncTouch[] }

/** One pass over a guest's touchpoints → the dated facts the groups read. Exported for tests. */
export function touchFacts(touches: readonly TouchRow[]): Acc {
  const a: Acc = { staff: null, guest: null, enquiry: null, engaged: null, dnc: [] }
  for (const t of touches) {
    const outcome = typeof t.metadata?.outcome === 'string' ? t.metadata.outcome : null
    a.dnc.push({ outcome, flagged: t.metadata?.do_not_contact === true, occurredAt: t.occurred_at })
    if (isEnquiry(t)) a.enquiry = later(a.enquiry, t.occurred_at)
    else if (isEngagement(t)) a.engaged = later(a.engaged, t.occurred_at)
    else if (isGuestMessage(t)) a.guest = later(a.guest, t.occurred_at)
    // A call the guest made and we answered is both: the guest spoke and a person on our side took it.
    if (isHumanFollowup({ channel: t.channel, direction: t.direction, occurredAt: t.occurred_at, source: t.source, metadata: t.metadata })) {
      a.staff = later(a.staff, t.occurred_at)
    }
  }
  return a
}

async function readBook(sb: SupabaseClient, clientId: string) {
  const [contacts, touches, stages, bookings, cfg] = await Promise.all([
    fetchAll<ContactRow>((from, to) =>
      sb.from('contacts').select('id, do_not_contact, stage, ai_takeover_since, primary_email, primary_phone')
        .eq('client_id', clientId).order('id', { ascending: true }).range(from, to)),
    fetchAll<TouchRow>((from, to) =>
      sb.from('contact_touchpoints').select('contact_id, channel, direction, source, occurred_at, metadata')
        .eq('client_id', clientId).order('id', { ascending: true }).range(from, to)),
    fetchAll<StageRow>((from, to) =>
      sb.from('client_pipeline_stages').select('stage_key, marketing_action, is_terminal')
        .eq('client_id', clientId).order('stage_key', { ascending: true }).range(from, to)),
    fetchAll<{ contact_id: string; created_at: string }>((from, to) =>
      sb.from('crm_bookings').select('contact_id, created_at')
        .eq('client_id', clientId).eq('status', 'active').order('id', { ascending: true }).range(from, to)),
    sb.from('ad_strategy_configs').select('qualified_stage_keys').eq('client_id', clientId).maybeSingle(),
  ])
  if (cfg.error) throw new Error(cfg.error.message)
  const keys = (cfg.data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  const qualified = new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [])
  return { contacts, touches, stages, bookings, qualified }
}

async function readWeekEvents(sb: SupabaseClient, clientId: string, sinceIso: string) {
  const [stageEvents, takeovers] = await Promise.all([
    fetchAll<{ contact_id: string; to_stage: string | null }>((from, to) =>
      sb.from('contact_stage_events').select('contact_id, to_stage')
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
}

function bookIndex(book: { stages: StageRow[]; bookings: Array<{ contact_id: string }>; touches: TouchRow[] }): BookIndex {
  const stageOf: BookIndex['stageOf'] = new Map()
  for (const s of book.stages) stageOf.set(s.stage_key, { action: isMarketingAction(s.marketing_action) ? s.marketing_action : null, terminal: s.is_terminal === true })
  const touchesOf = new Map<string, TouchRow[]>()
  for (const t of book.touches) {
    if (t.contact_id === null) continue
    const list = touchesOf.get(t.contact_id)
    if (list) list.push(t)
    else touchesOf.set(t.contact_id, [t])
  }
  return { stageOf, booked: new Set(book.bookings.map((b) => b.contact_id)), touchesOf }
}

function guestFacts(c: ContactRow, a: Acc, index: BookIndex, qualified: ReadonlySet<string>): GuestFacts {
  const st = c.stage === null ? undefined : index.stageOf.get(c.stage)
  return {
    doNotContact: isDoNotContact(c.do_not_contact === true, a.dnc),
    hasActiveBooking: index.booked.has(c.id),
    stage: c.stage,
    stageAction: st?.action ?? null,
    stageTerminal: st?.terminal ?? false,
    qualified: c.stage !== null && qualified.has(c.stage),
    aiTakeover: c.ai_takeover_since !== null,
    hasEmail: nonEmpty(c.primary_email),
    hasPhone: nonEmpty(c.primary_phone),
    lastStaffAt: a.staff,
    lastGuestMessageAt: a.guest,
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
  const staffWeek = new Set<string>()
  const repliedWeek = new Set<string>()
  const enquiryWeek = new Set<string>()
  for (const c of book.contacts) {
    const a = touchFacts(index.touchesOf.get(c.id) ?? [])
    verdicts.set(c.id, groupOf(guestFacts(c, a, index, book.qualified), now, cfg))
    if (a.staff !== null && Date.parse(a.staff) >= sinceMs) staffWeek.add(c.id)
    if (a.guest !== null && Date.parse(a.guest) >= sinceMs) repliedWeek.add(c.id)
    if (a.enquiry !== null && Date.parse(a.enquiry) >= sinceMs) enquiryWeek.add(c.id)
  }

  const movedToQualified = new Set(weekEvents.stageEvents.filter((e) => e.to_stage !== null && book.qualified.has(e.to_stage)).map((e) => e.contact_id))
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
  }
}
