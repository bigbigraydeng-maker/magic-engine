/**
 * Read-only pushes. The flag defaults off: unset or any value other than
 * the exact string "true" sends nothing and does not call fetch.
 */

import { DAY_THEMES, ZH_DAYS, type TodoView } from '@/lib/pm-todo/daily-todo'
import { sendTelegramText, type TelegramSendDeps } from './client'
import { readTelegramOwner, telegramBotToken, telegramPushEnabled } from './config'
import { formatIssuedCard, formatMorningTodo } from './messages'

export interface CardNotice {
  clientId: string
  what: string
  account: string
  amount: string
  date: string
  scope: string
  expiresLabel: string
}

async function sendAll(deps: TelegramSendDeps, parts: string[]): Promise<void> {
  for (const part of parts) await sendTelegramText(deps, part)
}

function sender(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): TelegramSendDeps | null {
  const token = telegramBotToken(env)
  const owner = readTelegramOwner(env)
  if (!token || !owner) return null
  return { token, chatId: owner.chatId, fetchImpl }
}

export async function pushMorningTodo(args: {
  weekday: number
  dateLabel: string
  view: TodoView
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<'sent' | 'skipped'> {
  const env = args.env ?? process.env
  if (!telegramPushEnabled(env)) return 'skipped'
  const deps = sender(env, args.fetchImpl)
  if (!deps) return 'skipped'
  const theme = DAY_THEMES[args.weekday] ?? { title: '日常', hint: '' }
  const parts = formatMorningTodo({
    weekdayName: ZH_DAYS[args.weekday] ?? '今天',
    themeTitle: theme.title,
    themeHint: theme.hint,
    dateLabel: args.dateLabel,
    view: args.view,
  })
  await sendAll(deps, parts)
  return 'sent'
}

export async function notifyIssuedConfirmationCard(args: CardNotice & {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<'sent' | 'skipped'> {
  const env = args.env ?? process.env
  if (!telegramPushEnabled(env)) return 'skipped'
  const deps = sender(env, args.fetchImpl)
  if (!deps) return 'skipped'
  await sendTelegramText(deps, formatIssuedCard(args))
  return 'sent'
}
