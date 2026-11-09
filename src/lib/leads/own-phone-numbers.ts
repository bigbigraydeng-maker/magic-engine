/**
 * Read a client's "own people" phone list (sales, owner) from clients.leads_config.
 *
 * Used to tell, inside a WhatsApp group, which participants are the client's own
 * staff. Numbers live only in the client's own config — never in shared code.
 */

import { supabaseAdmin } from '@/lib/supabase'

const E164_RE = /^\+\d{8,15}$/

/** Pure: pull the validated, deduped E.164 list out of a leads_config value. */
export function readOwnPhoneNumbers(leadsConfig: unknown): string[] {
  const raw = (leadsConfig as Record<string, unknown> | null | undefined)?.ownPhoneNumbers
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.filter((x): x is string => typeof x === 'string' && E164_RE.test(x))))
}

/** Load one client's list. Throws on a read failure (never returns "empty" for "unreadable"). */
export async function loadOwnPhoneNumbers(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`读 leads_config 失败: ${error.message}`)
  return readOwnPhoneNumbers(data?.leads_config)
}
