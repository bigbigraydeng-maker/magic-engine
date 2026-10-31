/**
 * Which time zone a client's "today" is in. Same rule the rest of the CRM already uses for a client's relative dates
 * (see crm/touchpoints/route.ts): Australian clients are on Sydney time, everyone else on New Zealand time.
 * "Today" matters twice here: which departures are still in the future, and whether "we spoke today" or "yesterday".
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_TIME_ZONE = 'Pacific/Auckland'

export function timeZoneForCountry(country: unknown): string {
  return typeof country === 'string' && country.trim().toUpperCase() === 'AU' ? 'Australia/Sydney' : DEFAULT_TIME_ZONE
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The client's zone; if it cannot be read, the default (and the failure is logged, not hidden). */
export async function loadClientTimeZone(db: SupabaseClient, clientId: string): Promise<string> {
  const { data, error } = await db.from('clients').select('country').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`clients.country: ${error.message}`)
  return timeZoneForCountry((data as { country?: unknown } | null)?.country)
}
