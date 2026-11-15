import type { SupabaseClient } from '@supabase/supabase-js'
import { bareAddress, isInternalEmail } from '@/lib/ads-strategy/portfolio/diagnostics/internal-email'

export interface FdePortalRecipient {
  portalUserId: string
  email: string
}

export async function listFdePortalRecipients(sb: SupabaseClient, clientId: string): Promise<FdePortalRecipient[]> {
  const { data, error } = await sb
    .from('client_portal_users')
    .select('id, email, access_type')
    .eq('client_id', clientId)
    .in('access_type', ['fde', 'both'])
  if (error) return []
  const out: FdePortalRecipient[] = []
  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ id?: string; email?: string | null }>) {
    if (typeof row.id !== 'string') continue
    const email = typeof row.email === 'string' ? bareAddress(row.email.trim()) : ''
    if (!email || !isInternalEmail(email)) continue
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push({ portalUserId: row.id, email })
  }
  return out
}

export function fdeEmailsFromRecipients(recipients: readonly FdePortalRecipient[]): string[] {
  return Array.from(new Set(recipients.map((r) => r.email)))
}