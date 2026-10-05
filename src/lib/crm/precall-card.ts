/**
 * Read side of the "30 seconds before the call" card (read-only).
 *
 * Reads the stored brief for a contact's conversations and the client's industry,
 * then hands everything to the pure builders in `precall-brief.ts`. Writes
 * nothing, sends nothing, adds no database column.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { hasIndustryFeature } from '@/lib/clients/industry-features'
import { isDoNotContact } from './dnc'
import { NZ_NATIONAL_HOLIDAYS } from './holiday-calendars'
import { toDncTouches, type LeadTouch } from './lead-followup-due'
import {
  assessLeadPromise,
  buildPrecallBrief,
  pickLatestBriefRow,
  type LeadPromiseStatus,
  type PrecallBrief,
  type PrecallBriefRow,
  type PrecallMessage,
} from './precall-brief'
import { TOURISM_PRECALL_ASK_ITEMS, type PrecallAskItem } from './precall-profiles'

export interface PrecallCard {
  brief: PrecallBrief | null
  /** True when the stored brief could not be read (show "could not load", not "empty"). */
  briefReadFailed: boolean
  lead: LeadPromiseStatus
}

export interface LoadPrecallCardArgs {
  clientId: string
  conversationIds: readonly string[]
  contact: { phone: string | null; email: string | null; doNotContactFlag: boolean }
  touches: readonly LeadTouch[]
  messages: readonly PrecallMessage[]
  now: Date
}

const BRIEF_COLUMNS =
  'summary, intent_level, next_action, customer_needs, promises_made, risk_flags, trip, contact, generated_at'

/** Travel clients get the travel "ask on the call" list; other industries get none. */
async function loadAskItems(clientId: string): Promise<readonly PrecallAskItem[]> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('industry')
    .eq('id', clientId)
    .maybeSingle()
  const industry = (data as { industry?: string | null } | null)?.industry ?? null
  return hasIndustryFeature(industry, 'tailor_made') ? TOURISM_PRECALL_ASK_ITEMS : []
}

async function loadLatestBriefRow(
  clientId: string,
  conversationIds: readonly string[],
): Promise<{ row: PrecallBriefRow | null; failed: boolean }> {
  if (conversationIds.length === 0) return { row: null, failed: false }
  const { data, error } = await supabaseAdmin
    .from('conversation_briefs')
    .select(BRIEF_COLUMNS)
    .eq('client_id', clientId)
    .in('conversation_id', [...conversationIds])
  if (error) return { row: null, failed: true }
  return { row: pickLatestBriefRow((data ?? []) as PrecallBriefRow[]), failed: false }
}

/**
 * Build the card for one contact. Returns null when there is nothing to show
 * (no brief, no form submission, and no read failure) so the UI stays quiet.
 */
export async function loadPrecallCard(args: LoadPrecallCardArgs): Promise<PrecallCard | null> {
  const [askItems, latest] = await Promise.all([
    loadAskItems(args.clientId),
    loadLatestBriefRow(args.clientId, args.conversationIds),
  ])

  const touches = [...args.touches]
  const lead = assessLeadPromise({
    messages: args.messages,
    touches,
    now: args.now,
    holidays: new Set(NZ_NATIONAL_HOLIDAYS),
    doNotContact: isDoNotContact(args.contact.doNotContactFlag, toDncTouches(touches)),
  })
  const brief = buildPrecallBrief(latest.row, args.contact, askItems)

  if (!brief && !lead.isFormLead && !latest.failed) return null
  return { brief, briefReadFailed: latest.failed, lead }
}
