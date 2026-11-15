import type { SupabaseClient } from '@supabase/supabase-js'
import { buildEarlyWarningText, type EarlyWarningAlertFacts } from './alert-copy'
import type { EarlyWarningChannels, EarlyWarningEmailStatus } from './channels'
import { loadChatIdsForClientRecipients } from './fde-telegram-persist'
import type { EarlyWarningTelegramStatus } from './notify-telegram'
import type { FdePortalRecipient } from './fde-recipients'

export interface FdeOutreachResult {
  email: EarlyWarningEmailStatus
  telegram: EarlyWarningTelegramStatus | 'skipped'
}

/**
 * Email first (authoritative for receipts in #3880); Telegram is best-effort and never changes email status.
 * Wire into `runPredictiveEarlyWarning` after #3880 merges in place of raw `channels.email`.
 */
export async function deliverEarlyWarningToFde(
  sb: SupabaseClient,
  channels: EarlyWarningChannels,
  clientId: string,
  recipients: readonly FdePortalRecipient[],
  facts: EarlyWarningAlertFacts,
): Promise<FdeOutreachResult> {
  const emails = recipients.map((r) => r.email)
  const email = await channels.email(emails, facts)
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