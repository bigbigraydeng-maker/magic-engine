/**
 * Env names for the existing ME Telegram bot.
 * This module never calls the Bot API and never calls setWebhook.
 * Values stay in the environment; nothing here is a default token or id.
 */

import { timingSafeEqual } from 'crypto'

export function telegramPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TELEGRAM_TODO_PUSH_ENABLED === 'true'
}

export interface TelegramOwnerConfig {
  readonly userId: string
  readonly chatId: string
  /** ME login email of the OPC approver. Empty until Ray sets it. */
  readonly email: string
}

export function readTelegramOwner(env: NodeJS.ProcessEnv = process.env): TelegramOwnerConfig | null {
  const userId = env.TELEGRAM_OWNER_USER_ID?.trim() ?? ''
  const chatId = env.TELEGRAM_OWNER_CHAT_ID?.trim() ?? ''
  const email = env.TELEGRAM_OWNER_EMAIL?.trim().toLowerCase() ?? ''
  if (!userId || !chatId) return null
  return { userId, chatId, email }
}

export function telegramBotToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? ''
  return token.length > 0 ? token : null
}

export function telegramWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? ''
  return secret.length > 0 ? secret : null
}

/** Constant-time compare. A missing or different-length header never matches. */
export function secretHeaderMatches(header: string | null, secret: string): boolean {
  if (!header || header.length !== secret.length || secret.length === 0) return false
  return timingSafeEqual(Buffer.from(header), Buffer.from(secret))
}
