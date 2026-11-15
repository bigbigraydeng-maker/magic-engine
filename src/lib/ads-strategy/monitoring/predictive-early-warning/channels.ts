import { deliverEarlyWarningTelegram, type EarlyWarningTelegramStatus } from './notify-telegram'
import type { EarlyWarningAlertFacts } from './alert-copy'

export type EarlyWarningEmailStatus = 'sent' | 'no_recipients' | 'no_api_key' | 'send_failed'
export type EarlyWarningChannelResult = EarlyWarningEmailStatus | EarlyWarningTelegramStatus

export interface EarlyWarningChannels {
  email(to: string[], facts: EarlyWarningAlertFacts): Promise<EarlyWarningChannelResult>
  telegram?(chatIds: string[], text: string): Promise<EarlyWarningTelegramStatus>
}

export function createEarlyWarningTelegramChannel(): NonNullable<EarlyWarningChannels['telegram']> {
  return (chatIds, text) => deliverEarlyWarningTelegram(chatIds, text)
}