/**
 * CRM「到期日历」的纯函数：把台账验收日、客人约好的回电，整理成「某一天有什么」。
 * 取数（读台账文件、查触点）在 API 路由里做，这里只管归类与算日期，方便单测钉住。
 */
import type { LedgerEntry } from '@/lib/ledger/types'

export const DUE_CALENDAR_TIMEZONE = 'Pacific/Auckland'

export type DueItemKind = 'callback' | 'verify'

export interface DueItem {
  /** YYYY-MM-DD（新西兰日期） */
  date: string
  kind: DueItemKind
  title: string
  /** 回电：HH:mm（新西兰时间）；验收：null */
  time: string | null
  /** 回电：客人 id；验收：台账卡 id */
  refId: string
  /** 回电：电话（没有则 null） */
  phone: string | null
  /** 验收：卡片当前状态 */
  status: string | null
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

export function currentMonthNz(now: Date = new Date()): string {
  return nzDateOf(now.toISOString()).slice(0, 7)
}

/** ISO 时间 → 新西兰日期 YYYY-MM-DD；无法解析返回 null */
export function nzDateOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUE_CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function nzTimeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUE_CALENDAR_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

/** 台账里还没验完的卡（decided / done）按验收日排进日历；verified / failed 已经有结论，不再提醒 */
export function ledgerDueItems(entries: readonly LedgerEntry[], month: string): DueItem[] {
  return entries
    .filter((e) => e.verifyBy && e.verifyBy.startsWith(month) && (e.status === 'decided' || e.status === 'done'))
    .map((e) => ({
      date: e.verifyBy as string,
      kind: 'verify' as const,
      title: e.title,
      time: null,
      refId: e.id,
      phone: null,
      status: e.status,
    }))
}

export interface CallbackTouchRow {
  contact_id: string
  occurred_at: string
  metadata: { callback_at?: unknown } | null
}

export interface CallbackContactRow {
  id: string
  display_name: string | null
  primary_phone: string | null
  do_not_contact: boolean
}

/**
 * 每个客人只取「最近一次」约的回电（后约的盖掉先约的），落在本月才显示；
 * 标了不要再联系的客人不排。
 */
export function callbackItems(
  touches: readonly CallbackTouchRow[],
  contacts: readonly CallbackContactRow[],
  month: string,
): DueItem[] {
  const byContact = new Map(contacts.map((c) => [c.id, c]))
  const latest = new Map<string, CallbackTouchRow>()
  for (const t of touches) {
    if (typeof t.metadata?.callback_at !== 'string') continue
    const prev = latest.get(t.contact_id)
    if (!prev || t.occurred_at > prev.occurred_at) latest.set(t.contact_id, t)
  }
  const items: DueItem[] = []
  for (const [contactId, t] of latest) {
    const contact = byContact.get(contactId)
    const iso = t.metadata?.callback_at as string
    const date = nzDateOf(iso)
    if (!contact || contact.do_not_contact || !date.startsWith(month)) continue
    items.push({
      date,
      kind: 'callback',
      title: contact.display_name?.trim() || contact.primary_phone || '未命名客人',
      time: nzTimeOf(iso),
      refId: contactId,
      phone: contact.primary_phone,
      status: null,
    })
  }
  return items
}

export function sortDueItems(items: readonly DueItem[]): DueItem[] {
  return [...items].sort((a, b) =>
    a.date === b.date ? (a.time ?? '99:99').localeCompare(b.time ?? '99:99') : a.date.localeCompare(b.date),
  )
}
