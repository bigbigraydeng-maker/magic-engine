/**
 * Chart series for the "按天" table of the ads-health 多维数据 tab. Pure: no I/O.
 *
 * One point per calendar day, oldest first. `cpl` is that day alone; `cpl7` is the trailing 7 calendar days
 * (spend ÷ leads over the window), which keeps a thin day from swinging the line. A day or window with no
 * leads has no cost per lead (null — a gap in the chart, never 0).
 */
import type { ReportRow } from './report-types'

export interface DayPoint {
  date: string
  /** MM-DD, for the axis */
  label: string
  spend: number
  leads: number
  cpl: number | null
  cpl7: number | null
}

export const TREND_WINDOW_DAYS = 7

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function buildDaySeries(rows: readonly ReportRow[]): DayPoint[] {
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return sorted.map((row) => {
    const today = dayNumber(row.key)
    let spend7 = 0
    let leads7 = 0
    for (const r of sorted) {
      const n = dayNumber(r.key)
      if (n > today || n <= today - TREND_WINDOW_DAYS) continue
      spend7 += r.spend
      leads7 += r.leads ?? 0
    }
    const leads = row.leads ?? 0
    return {
      date: row.key,
      label: row.key.slice(5),
      spend: row.spend,
      leads,
      cpl: leads > 0 ? row.spend / leads : null,
      cpl7: leads7 > 0 ? spend7 / leads7 : null,
    }
  })
}
