import { buildEarlyWarningText, type EarlyWarningAlertFacts } from './alert-copy'
import { deliverEarlyWarningTelegram, type EarlyWarningTelegramStatus } from './notify-telegram'

/** Aligns with PR #3880 `EarlyWarningChannels` once merged. */
export type EarlyWarningEmailStatus = 'sent' | 'no_recipients' | 'no_api_key' | 'send_failed'

export type EarlyWarningChannelResult = EarlyWarningEmailStatus | EarlyWarningTelegramStatus

export interface EarlyWarningChannels {
  email(to: string[], facts: EarlyWarningAlertFacts): Promise<EarlyWarningChannelResult>
  telegram?(chatIds: string[], text: string): Promise<EarlyWarningTelegramStatus>
}

/**
 * Drop-in Telegram handler for `defaultEarlyWarningChannels()` after PR #3880 merges:
 * replace the stub with `createEarlyWarningTelegramChannel()`.
 */
export function createEarlyWarningTelegramChannel(): NonNullable<EarlyWarningChannels['telegram']> {
  return (chatIds, text) => deliverEarlyWarningTelegram(chatIds, text)
}

export function earlyWarningTelegramFromFacts(
  chatIds: readonly string[],
  facts: EarlyWarningAlertFacts,
): Promise<EarlyWarningTelegramStatus> {
  return deliverEarlyWarningTelegram(chatIds, buildEarlyWarningText(facts))
}