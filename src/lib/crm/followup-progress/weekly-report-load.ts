/**
 * Reads for the weekly follow-up report that the page does not need: the names of the guests it lists, and how many
 * guests the AI pickup page could release today. Read-only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadContactNames } from '@/lib/crm/enquiry-daily-load'
import { DEFAULT_PICKUP_CONFIG } from '@/lib/crm/ai-takeover/pickup'
import { decideAll, latestEnquiries, loadInputs, pickupSwitches } from '@/lib/crm/ai-takeover/pickup-run'

export { loadContactNames }

/**
 * How many guests the AI pickup rules would take today, by the pickup page's own rules (never a second copy of them).
 * null = this client has not opted in to the AI pickup, so the report says nothing about it.
 */
export async function countAiReady(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<number | null> {
  if (!pickupSwitches(env).clients.includes(clientId)) return null
  const leads = await latestEnquiries(sb, clientId, now)
  if (leads.size === 0) return 0
  const inputs = await loadInputs(sb, clientId, [...leads.keys()])
  return decideAll(inputs, leads, now, DEFAULT_PICKUP_CONFIG).length
}
