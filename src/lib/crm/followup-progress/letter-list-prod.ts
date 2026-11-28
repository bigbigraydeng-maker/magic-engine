/**
 * The real reads behind the "跟进信" list (`letter-list.ts`), for one client. Read-only.
 * Kept apart from the rules so the rules import no database code and can be tested with plain objects.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import type { ContactRowLike, StageMetaLike, TouchpointRowLike } from '@/lib/crm/contact-model'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { loadSiteReading } from '@/lib/crm/email-templates/link-tracking/site-reading-prod'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { loadContactNames } from '@/lib/crm/enquiry-daily-load'
import { isMarketingAction, stageSuppressesWorklist } from '@/lib/crm/pipeline'
import { DEFAULT_GROUP_CONFIG } from './groups'
import { loadFollowupProgress } from './load'
import type { GuestRows, LetterListDeps } from './letter-list'

const ID_CHUNK = 100

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += ID_CHUNK) out.push(xs.slice(i, i + ID_CHUNK))
  return out
}

type RawTouch = Omit<TouchpointRowLike, 'direction'> & { direction: string | null }

async function loadGuestRows(sb: SupabaseClient, clientId: string, ids: readonly string[], now: Date): Promise<GuestRows> {
  const contacts: ContactRowLike[] = []
  const touches: TouchpointRowLike[] = []
  for (const part of chunks(ids)) {
    const [c, t] = await Promise.all([
      fetchAll<ContactRowLike>((from, to) =>
        sb.from('contacts').select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage')
          .eq('client_id', clientId).in('id', part).order('id', { ascending: true }).range(from, to)),
      fetchAll<RawTouch>((from, to) =>
        sb.from('contact_touchpoints').select('contact_id, channel, direction, occurred_at, source, raw, metadata')
          .eq('client_id', clientId).in('contact_id', part).order('id', { ascending: true }).range(from, to)),
    ])
    contacts.push(...c)
    for (const row of t) if (row.direction === 'inbound' || row.direction === 'outbound') touches.push({ ...row, direction: row.direction })
  }
  const stages = await fetchAll<{ stage_key: string; label: string | null; marketing_action: string | null; is_terminal: boolean | null }>((from, to) =>
    sb.from('client_pipeline_stages').select('stage_key, label, marketing_action, is_terminal')
      .eq('client_id', clientId).order('stage_key', { ascending: true }).range(from, to))
  const stageMeta = new Map<string, StageMetaLike>()
  // Same reading as the "今天先联系" list: an action the code does not know is treated as "stop marketing".
  for (const s of stages) stageMeta.set(s.stage_key, { label: s.label ?? s.stage_key, suppressed: stageSuppressesWorklist(isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress', s.is_terminal) })
  return { contacts, touches, stageMeta, siteReading: await loadSiteReading(sb, clientId, now) }
}

/** contactId → every pending / sent e-mail of ours in the send log (`conversation_outbound_log`), for these guests. */
export async function loadSendTimesFromLog(sb: SupabaseClient, clientId: string, contactIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const part of chunks(contactIds)) {
    const convos = await fetchAll<{ id: string; contact_id: string }>((from, to) =>
      sb.from('conversations').select('id, contact_id').eq('client_id', clientId).eq('channel', 'email')
        .in('contact_id', part).order('id', { ascending: true }).range(from, to))
    const owner = new Map(convos.map((c) => [c.id, c.contact_id]))
    for (const convoPart of chunks(convos.map((c) => c.id))) {
      const logs = await fetchAll<{ id: string; conversation_id: string; created_at: string }>((from, to) =>
        sb.from('conversation_outbound_log').select('id, conversation_id, created_at').eq('client_id', clientId)
          .in('conversation_id', convoPart).in('status', ['pending', 'sent']).order('id', { ascending: true }).range(from, to))
      for (const l of logs) {
        const contact = owner.get(l.conversation_id)
        if (contact !== undefined) out.set(contact, [...(out.get(contact) ?? []), l.created_at])
      }
    }
  }
  return out
}

/**
 * "Write it yourself" letters that left the sales mailbox since a moment: sent receipts with no template.
 * A letter released from the "跟进信" page is one of these, and so is a letter a staff member wrote by hand:
 * the page's daily cap counts both, so it can only be lower than the true number of AI letters, never higher.
 */
async function countSentSince(sb: SupabaseClient, clientId: string, sinceIso: string): Promise<number> {
  const { count, error } = await sb.from('crm_email_send_receipts').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('outcome', 'sent').is('template_key', null).gte('created_at', sinceIso)
  if (error) throw new Error(`crm_email_send_receipts: ${error.message}`)
  if (typeof count !== 'number') throw new Error('crm_email_send_receipts: no count')
  return count
}

/** The client's own "at most N mails per guest per 7 days"; null when it has none or uses another window. */
async function loadWeeklyMax(sb: SupabaseClient, clientId: string): Promise<number | null> {
  const loaded = await loadEmailSettings(sb, clientId)
  if (loaded.kind !== 'ok') return null
  const cap = loaded.settings.frequencyCap
  return cap !== null && cap.windowDays === 7 ? cap.max : null
}

export async function createLetterListDeps(sb: SupabaseClient, clientId: string, now: Date): Promise<LetterListDeps> {
  const mailDeps = createMailNewDeps(clientId)
  const [timeZone, weeklyMax] = await Promise.all([loadClientTimeZone(sb, clientId), loadWeeklyMax(sb, clientId)])
  return {
    timeZone,
    weeklyMax,
    loadProgress: (only) => loadFollowupProgress(sb, clientId, now, DEFAULT_GROUP_CONFIG, only),
    loadGuestRows: (ids) => loadGuestRows(sb, clientId, ids, now),
    loadSendTimes: (ids) => loadSendTimesFromLog(sb, clientId, ids),
    countSentSince: (sinceIso) => countSentSince(sb, clientId, sinceIso),
    loadNames: (ids) => loadContactNames(sb, clientId, ids),
    compose: (contactId) => previewCompose({ clientId, contactId }, mailDeps),
  }
}
