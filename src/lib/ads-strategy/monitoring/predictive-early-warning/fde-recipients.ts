/**
 * Resolve per-client FDE inboxes from client_portal_users (access_type = fde).
 * No hardcoded people; empty = caller skips outbound email.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bareAddress, isInternalEmail } from '@/lib/ads-strategy/portfolio/diagnostics/internal-email'

export interface FdeRecipientResolve {
  emails: string[]
  skippedNonInternal: number
}

export async function loadFdeEmailsForClient(sb: SupabaseClient, clientId: string): Promise<FdeRecipientResolve> {
  const { data, error } = await sb
    .from('client_portal_users')
    .select('email, access_type')
    .eq('client_id', clientId)
    .eq('access_type', 'fde')
  if (error) throw new Error(`client_portal_users: ${error.message}`)
  const raw = (data ?? []) as Array<{ email?: string | null }>
  const cleaned = raw
    .map((row) => (typeof row.email === 'string' ? bareAddress(row.email.trim()) : ''))
    .filter((email) => email.length > 0)
  const internal = cleaned.filter(isInternalEmail)
  return {
    emails: Array.from(new Set(internal)),
    skippedNonInternal: cleaned.length - internal.length,
  }
}