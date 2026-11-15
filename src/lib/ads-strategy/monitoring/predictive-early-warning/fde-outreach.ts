import type { SupabaseClient } from '@supabase/supabase-js'
import { bareAddress, isInternalEmail } from '@/lib/ads-strategy/portfolio/diagnostics/internal-email'
import { buildEarlyWarningText, type EarlyWarningAlertFacts } from './alert-copy'
import type { EarlyWarningChannels, EarlyWarningEmailStatus } from './channels'
import { loadChatIdsForClientRecipients } from './fde-telegram-persist'
import type { EarlyWarningTelegramStatus } from './notify-telegram'

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
    if (!email || !isInternalEmail(email) || seen.has(row.id)) continue
    seen.add(row.id)
    out.push({ portalUserId: row.id, email })
  }
  return out
}

export interface FdeOutreachResult {
  email: EarlyWarningEmailStatus
  telegram: EarlyWarningTelegramStatus | 'skipped'
}

export async function deliverEarlyWarningToFde(
  sb: SupabaseClient,
  channels: EarlyWarningChannels,
  clientId: string,
  recipients: readonly FdePortalRecipient[],
  facts: EarlyWarningAlertFacts,
): Promise<FdeOutreachResult> {
  const email = await channels.email(
    recipients.map((r) => r.email),
    facts,
  )
  let telegram: EarlyWarningTelegramStatus | 'skipped' = 'skipped'
  const fn = channels.telegram
  if (fn && recipients.length > 0) {
    const chatIds = await loadChatIdsForClientRecipients(
      sb,
      clientId,
      recipients.map((r) => r.portalUserId),
    )
    try {
      telegram = await fn(chatIds, buildEarlyWarningText(facts))
    } catch {
      telegram = 'send_failed'
    }
  }
  return { email, telegram }
}