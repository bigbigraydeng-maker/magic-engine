/** Date helpers for investigation tools (UTC calendar days). */

export function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export function shiftIsoDate(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** Monday-start week containing `anchor` (UTC). */
export function weekRangeContaining(anchor: string): { start: string; end: string } {
  const d = new Date(`${anchor}T12:00:00Z`)
  const dow = d.getUTCDay() // 0 Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const start = shiftIsoDate(anchor, mondayOffset)
  const end = shiftIsoDate(start, 6)
  return { start, end }
}

export function presetWeekVsPrior(anchor?: string): {
  period_a: { start: string; end: string }
  period_b: { start: string; end: string }
} {
  const day = anchor ?? isoTodayUtc()
  const thisWeek = weekRangeContaining(day)
  const lastWeekEnd = shiftIsoDate(thisWeek.start, -1)
  const lastWeek = weekRangeContaining(lastWeekEnd)
  return { period_a: thisWeek, period_b: lastWeek }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseIsoDate(raw: unknown, label: string): string | { error: string } {
  if (typeof raw !== 'string' || !ISO_RE.test(raw)) {
    return { error: `${label} 必须是 YYYY-MM-DD` }
  }
  const t = Date.parse(`${raw}T00:00:00Z`)
  if (!Number.isFinite(t)) return { error: `${label} 日期无效` }
  return raw
}
