/**
 * Pure helpers of the 「发信统计」 page: a short group name from a template's own name, grouping by day and mail
 * type, the four summary numbers, and each row's status. Nothing here knows a client or an industry: the group name
 * comes from the client's template names.
 */

import type { SendStatRow } from './types'

export const HAND_WRITTEN_LABEL = '自己写的信'
export const UNKNOWN_TEMPLATE_LABEL = '其他信'

/** 「倒计时信·离出发 4 个月·…」→「倒计时信」; 「④一键发目录：…」→「一键发目录」. Cut at the first separator, drop a leading ①-⑩. */
export function groupLabelOf(row: Pick<SendStatRow, 'templateKey' | 'templateName'>): string {
  if (row.templateKey === null) return HAND_WRITTEN_LABEL
  const name = row.templateName?.trim()
  if (!name) return UNKNOWN_TEMPLATE_LABEL
  const withoutNumber = name.replace(/^[①-⑳❶-❿]\s*/u, '')
  const cut = withoutNumber.split(/[·：:（(]/u)[0]?.trim() ?? ''
  return cut.length > 0 ? cut : withoutNumber
}

export type RowStatus =
  | { kind: 'blocked' }
  | { kind: 'failed' }
  | { kind: 'unknown' }
  | { kind: 'sent'; clicked: boolean; clicksReadable: boolean; reacted: boolean }

export function statusOf(row: SendStatRow): RowStatus {
  if (row.outcome === 'blocked') return { kind: 'blocked' }
  if (row.outcome === 'failed') return { kind: 'failed' }
  if (row.outcome !== 'sent') return { kind: 'unknown' }
  return { kind: 'sent', clicked: (row.clicks?.length ?? 0) > 0, clicksReadable: row.clicks !== null, reacted: row.reaction !== null }
}

export interface Summary {
  sent: number
  clicked: number
  reacted: number
  notDelivered: number
  /** At least one mail that went out has clicks that could not be read: `clicked` is then a floor, not the number. */
  clicksUnreadable: boolean
}

export function summarise(rows: readonly SendStatRow[]): Summary {
  const out: Summary = { sent: 0, clicked: 0, reacted: 0, notDelivered: 0, clicksUnreadable: false }
  for (const row of rows) {
    const s = statusOf(row)
    if (s.kind !== 'sent') {
      out.notDelivered++
      continue
    }
    out.sent++
    if (!s.clicksReadable) out.clicksUnreadable = true
    if (s.clicked) out.clicked++
    if (s.reacted) out.reacted++
  }
  return out
}

/** 0 = reacted, 1 = clicked, 2 = nothing yet, 3 = did not go out: the people who responded come first. */
function rank(row: SendStatRow): number {
  const s = statusOf(row)
  if (s.kind !== 'sent') return 3
  if (s.reacted) return 0
  return s.clicked ? 1 : 2
}

export interface MailGroup {
  /** `YYYY-MM-DD` in the viewer's time zone. */
  day: string
  label: string
  rows: SendStatRow[]
  summary: Summary
}

/** The viewer-local calendar day of an instant (`YYYY-MM-DD`). */
export function localDay(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Groups by day (newest first) then mail type; inside a group, people who responded come first, then newest. */
export function groupRows(rows: readonly SendStatRow[], timeZone?: string): MailGroup[] {
  const map = new Map<string, MailGroup>()
  for (const row of rows) {
    const day = localDay(row.createdAt, timeZone)
    const label = groupLabelOf(row)
    const key = `${day}|${label}`
    const g = map.get(key) ?? { day, label, rows: [], summary: summarise([]) }
    g.rows.push(row)
    map.set(key, g)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.rows.sort((a, b) => rank(a) - rank(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    g.summary = summarise(g.rows)
  }
  return groups.sort((a, b) => b.day.localeCompare(a.day) || b.rows.length - a.rows.length || a.label.localeCompare(b.label))
}

/** The mail types present in these rows, most mails first (the filter chips). */
export function labelsOf(rows: readonly SendStatRow[]): string[] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(groupLabelOf(row), (counts.get(groupLabelOf(row)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label)
}

/** 「今天」/「昨天」/「11 月 8 日」 for a `YYYY-MM-DD` day, relative to `now`. */
export function dayTitle(day: string, now: Date, timeZone?: string): string {
  if (day === localDay(now.toISOString(), timeZone)) return '今天'
  if (day === localDay(new Date(now.getTime() - 86_400_000).toISOString(), timeZone)) return '昨天'
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${Number(m[1])} 月 ${Number(m[2])} 日` : day
}
