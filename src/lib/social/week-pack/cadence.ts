/**
 * When a client drafts, approves and starts publishing a weekly pack.
 * Platform default is Thursday / Friday / Monday, New Zealand time.
 * A client overrides it in `publishing_calendar_config.weekly_pack`. No client is named here.
 */

export interface WeeklyPackCadence {
  draftWeekday: number
  approveWeekday: number
  publishWeekday: number
}

export const DEFAULT_WEEKLY_PACK_CADENCE: WeeklyPackCadence = {
  draftWeekday: 4,
  approveWeekday: 5,
  publishWeekday: 1,
}

const NZ = 'Pacific/Auckland'
const WEEKDAY_SHORT: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

export const WEEKDAY_ZH = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export interface NzDay {
  year: number
  month: number
  day: number
  weekday: number
}

export function nzCalendar(now: Date): NzDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_SHORT[get('weekday')] ?? 0,
  }
}

export function addCalendarDays(year: number, month: number, day: number, delta: number): NzDay {
  const utc = new Date(Date.UTC(year, month - 1, day + delta))
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate(), weekday: 0 }
}

export function isoDate(parts: Pick<NzDay, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/** NZ calendar date of an instant, or '' when it cannot be read. */
export function nzDateKey(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

/**
 * The Monday–Sunday the pack is for.
 * Thu–Sun look ahead to the coming Monday. Mon–Wed look at the Monday after that,
 * because this week's pack was the one approved last Friday.
 */
export function targetWeek(now: Date): { weekStart: string; weekEnd: string } {
  const today = nzCalendar(now)
  if (today.weekday < 1) throw new Error('week-pack: calendar weekday unreadable')
  const daysUntilMonday = today.weekday === 1 ? 7 : 8 - today.weekday
  const start = addCalendarDays(today.year, today.month, today.day, daysUntilMonday)
  const end = addCalendarDays(start.year, start.month, start.day, 6)
  return { weekStart: isoDate(start), weekEnd: isoDate(end) }
}

function oneWeekday(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7 ? value : fallback
}

/** Missing or invalid days stay on the platform default. Never invents a client. */
export function cadenceFromConfig(raw: unknown): WeeklyPackCadence {
  const root = raw && typeof raw === 'object' ? (raw as { weekly_pack?: unknown }).weekly_pack : null
  const pack = root && typeof root === 'object' ? root as Record<string, unknown> : {}
  return {
    draftWeekday: oneWeekday(pack.draft_weekday, DEFAULT_WEEKLY_PACK_CADENCE.draftWeekday),
    approveWeekday: oneWeekday(pack.approve_weekday, DEFAULT_WEEKLY_PACK_CADENCE.approveWeekday),
    publishWeekday: oneWeekday(pack.publish_weekday, DEFAULT_WEEKLY_PACK_CADENCE.publishWeekday),
  }
}

export function isWeekday(now: Date, weekday: number): boolean {
  return nzCalendar(now).weekday === weekday
}

export function cadenceSentence(cadence: WeeklyPackCadence): string {
  const draft = WEEKDAY_ZH[cadence.draftWeekday] ?? '周四'
  const approve = WEEKDAY_ZH[cadence.approveWeekday] ?? '周五'
  const publish = WEEKDAY_ZH[cadence.publishWeekday] ?? '周一'
  return `${draft}出草稿，${approve}批，${publish}起按计划发。时间是新西兰时间。这三天写在客户配置里，没写就用这个默认。`
}
