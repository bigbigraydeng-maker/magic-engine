/**
 * 纯日期小工具：新西兰日历日（`YYYY-MM-DD`，不带时区）的加减、周几、相差几天。
 * 全部用 UTC 算「第几天」，机器所在时区、夏令时都不会改变结果。
 */

import type { NzDate } from './types'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** 从 1970-01-01 数起的第几天；不是真实存在的 YYYY-MM-DD → null。 */
export function toDayNumber(date: NzDate): number | null {
  const match = DATE_RE.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return ms / MS_PER_DAY
}

export function fromDayNumber(dayNumber: number): NzDate {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10)
}

/** 往后（正数）或往前（负数）挪几天；日期无效 → null。 */
export function shiftDays(date: NzDate, days: number): NzDate | null {
  const n = toDayNumber(date)
  return n === null ? null : fromDayNumber(n + days)
}

/** 周几：0 = 周日 … 3 = 周三 … 6 = 周六；日期无效 → null。 */
export function weekdayOf(date: NzDate): number | null {
  const n = toDayNumber(date)
  return n === null ? null : new Date(n * MS_PER_DAY).getUTCDay()
}

/** 这个月的第几号（1–31）；日期无效 → null。 */
export function dayOfMonth(date: NzDate): number | null {
  const n = toDayNumber(date)
  return n === null ? null : new Date(n * MS_PER_DAY).getUTCDate()
}

/** `to` 比 `from` 晚几天（`to` 在前面就是负数）；任何一个日期无效 → null。 */
export function daysBetween(from: NzDate, to: NzDate): number | null {
  const a = toDayNumber(from)
  const b = toDayNumber(to)
  return a === null || b === null ? null : b - a
}

/** 「周三」这种中文周几。 */
export function weekdayLabelZh(date: NzDate): string | null {
  const wd = weekdayOf(date)
  return wd === null ? null : `周${'日一二三四五六'.charAt(wd)}`
}

/** `YYYYMMDD`（给信编号 / 模板编号用）；日期无效 → null。 */
export function compactDate(date: NzDate): string | null {
  return toDayNumber(date) === null ? null : date.replace(/-/g, '')
}
