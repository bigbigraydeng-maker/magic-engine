/**
 * 作战地图用到的几个小工具（纯函数）。
 *
 * 日期口径：倒计时、「数据停了几天」按新西兰的今天算（看这页的人在新西兰）；
 * 观众池「哪一天」按各自账户的时区划（与 D11 诊断同一把尺）。
 */

const NZ_TZ = 'Pacific/Auckland'

/** 某个时刻在新西兰是哪一天，YYYY-MM-DD */
export function nzDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** fromDay 到 toDay 隔几天（toDay 晚于 fromDay 为正） */
export function diffDays(fromDay: string, toDay: string): number {
  const [y1, m1, d1] = fromDay.split('-').map(Number)
  const [y2, m2, d2] = toDay.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** 'YYYY-MM-DD' → '10/4' */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-')
  return `${parseInt(m ?? '', 10)}/${parseInt(d ?? '', 10)}`
}

/** 给人看的整数：44500 → '44,500' */
export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

/** 某个日期往前 / 往后挪几天 */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

/** 某个时刻距现在过去了几个小时；读不出时间返回 null */
export function hoursSince(iso: string | null, nowIso: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  const n = Date.parse(nowIso)
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null
  return (n - t) / 3_600_000
}
