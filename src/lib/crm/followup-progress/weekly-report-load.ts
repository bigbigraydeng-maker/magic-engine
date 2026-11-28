/**
 * Reads for the weekly follow-up report that the page does not need: the names of the guests it lists, and how many
 * guests the AI pickup page could release today. Read-only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadContactNames } from '@/lib/crm/enquiry-daily-load'
import { DEFAULT_PICKUP_CONFIG } from '@/lib/crm/ai-takeover/pickup'
import { decideAll, latestEnquiries, loadInputs } from '@/lib/crm/ai-takeover/pickup-run'

export { loadContactNames }

/**
 * How many guests match the AI pickup rules today, by the pickup's own rules (never a second copy of them).
 * This is the pool, not what the release page offers in one day: the page takes a limited batch and drops guests
 * it cannot email. The report words it that way.
 */
export async function countAiReady(sb: SupabaseClient, clientId: string, now: Date): Promise<number> {
  const leads = await latestEnquiries(sb, clientId, now)
  if (leads.size === 0) return 0
  const inputs = await loadInputs(sb, clientId, [...leads.keys()])
  return decideAll(inputs, leads, now, DEFAULT_PICKUP_CONFIG).length
}
