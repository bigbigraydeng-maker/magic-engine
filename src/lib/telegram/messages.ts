/**
 * Plain Chinese bodies. No inline keyboard: a tap is not an approval in this PR.
 * Items without a confirmation card are a reminder plus a link.
 */

import type { TodoView } from '@/lib/pm-todo/daily-todo'

const APP = 'https://app.magicengine.com.au'
const MAX_CHARS = 3500

export function chunkTelegramText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS)
    const cut = window.lastIndexOf('\n')
    const at = cut > 200 ? cut : MAX_CHARS
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest.length > 0) parts.push(rest)
  return parts
}

export function formatMorningTodo(args: {
  weekdayName: string
  themeTitle: string
  themeHint: string
  dateLabel: string
  view: Pick<TodoView, 'sections' | 'totalItems' | 'blindSpots'>
}): string[] {
  const lines = [
    `今日待办 · ${args.weekdayName} ${args.dateLabel}`,
    args.themeHint ? `${args.themeTitle} — ${args.themeHint}` : args.themeTitle,
    '没有按钮。在这里打字不算批准。',
  ]
  if (args.view.totalItems > 0) lines.push(`共 ${args.view.totalItems} 件。`)
  for (const note of args.view.blindSpots) lines.push(`今天没查成：${note}`)
  if (args.view.sections.length === 0 && args.view.blindSpots.length === 0) {
    lines.push('今天没有待办。')
  }
  for (const section of args.view.sections) {
    lines.push('')
    lines.push(`${section.emoji} ${section.title}`)
    for (const row of section.rows) {
      lines.push(`${row.client_name}：${row.what}`)
      lines.push(row.href || '（这条没有链接）')
    }
  }
  lines.push('')
  lines.push(`同一份清单：${APP}/dashboard/today`)
  return chunkTelegramText(lines.join('\n'))
}

export function formatIssuedCard(args: {
  clientId: string
  what: string
  account: string
  amount: string
  date: string
  scope: string
  expiresLabel: string
}): string {
  const href = `${APP}/dashboard/clients/${encodeURIComponent(args.clientId)}/confirmation-cards`
  return [
    '新的确认卡（只是提醒，这里没有按钮）',
    `要做的事：${args.what}`,
    `账户：${args.account}`,
    `金额：${args.amount}`,
    `日期：${args.date}`,
    `范围：${args.scope}`,
    `页面上的时限：${args.expiresLabel}`,
    '请打开下面的页面点。在 Telegram 里打字不算批准。',
    href,
  ].join('\n')
}
