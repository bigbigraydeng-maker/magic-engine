/**
 * Chart series for the "按天" table of the ads-health 多维数据 tab. Pure: no I/O.
 *
 * One point per calendar day from the first to the last day that has data, oldest first. Days with no row (no lead-form
 * campaign running, no spend) are filled in as 0 spend / 0 leads so the chart's time axis never silently skips days. `cpl` is that day alone; `cpl7` is the trailing 7 calendar days
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

function dateOf(dayNum: number): string {
  return new Date(dayNum * 86_400_000).toISOString().slice(0, 10)
}

/** Every calendar day between the first and last row; a missing day is an empty row (spend 0, leads 0). */
function fillMissingDays(sorted: readonly ReportRow[]): ReportRow[] {
  if (sorted.length === 0) return []
  const byDate = new Map(sorted.map((r) => [r.key, r] as const))
  const out: ReportRow[] = []
  for (let n = dayNumber(sorted[0].key); n <= dayNumber(sorted[sorted.length - 1].key); n++) {
    const key = dateOf(n)
    out.push(byDate.get(key) ?? { key, spend: 0, impressions: 0, clicks: 0, leads: 0, costPerLead: null, expectedLeads: null, flag: null, spendShare: 0 })
  }
  return out
}

export function buildDaySeries(rows: readonly ReportRow[]): DayPoint[] {
  const sorted = fillMissingDays([...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
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
