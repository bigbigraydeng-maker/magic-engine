import { MetaReadError } from '../graph-read'
export type Window = { since: string; until: string }
const DAY = 86_400_000
function dateNumber(day: string): number {
  const n = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,10) !== day) throw new MetaReadError('invalid_date_range')
  return n
}
export function resolveWindow(input: Window | undefined, timezone: string, now = new Date()): Window {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const end = dateNumber(today) - DAY
  const result = input ?? { since: new Date(end - 6 * DAY).toISOString().slice(0,10), until: new Date(end).toISOString().slice(0,10) }
  const start = dateNumber(result.since), stop = dateNumber(result.until)
  if (start > stop || stop > end || stop-start >= 90 * DAY) throw new MetaReadError('invalid_date_range')
  return result
}
export function previousWindow(window: Window): Window {
  const start = dateNumber(window.since), end = dateNumber(window.until)
  return { since: new Date(start-(end-start+DAY)).toISOString().slice(0,10), until: new Date(start-DAY).toISOString().slice(0,10) }
}
export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || (typeof value !== 'string' && typeof value !== 'number')) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
export function ratio(a: number | null, b: number | null, scale = 1): number | null {
  return a !== null && b !== null && b > 0 ? a / b * scale : null
}
function action(value: unknown, type: string): number | null {
  if (!Array.isArray(value)) return null
  const row = value.find((item: { action_type?: string }) => item?.action_type === type)
  return numeric(row?.value)
}
const videos = ['video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions','video_thruplay_watched_actions'] as const
export function normaliseInsight(row: Record<string, unknown>, conversion: string, videoRequested=false) {
  const spend = numeric(row.spend), impressions = numeric(row.impressions), clicks = numeric(row.clicks)
  const conversions = action(row.actions, conversion), leads = action(row.actions, 'lead')
  const starts = action(row.video_play_actions, 'video_view')
  const metrics = { spend, impressions, clicks, reach: numeric(row.reach), frequency: numeric(row.frequency),
    ctr: ratio(clicks, impressions), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions,1000),
    leads, cpl: ratio(spend, leads), conversions, cost_per_conversion: ratio(spend, conversions) }
  return { ...Object.fromEntries(['account_id','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','date_start','date_stop',
    'age','gender','publisher_platform','platform_position','device_platform','country']
    .filter(key => typeof row[key] === 'string').map(key => [key, row[key]])), ...metrics,
    availability: { metrics:Object.fromEntries(Object.entries(metrics).map(([name,value])=>[name,value===null ? 'not_reported_or_undefined' : 'available'])),
      video:videoRequested ? (starts === null ? 'not_reported_may_be_inapplicable_or_suppressed' : 'available') : 'not_requested' },
    ...(videoRequested ? { video_starts: starts, ...Object.fromEntries(videos.flatMap(key => {
      const count = action(row[key], 'video_view')
      return [[key, count], [`${key}_retention`, ratio(count, starts)]]
    })) } : {}),
    actions: Array.isArray(row.actions) ? row.actions.filter(item => item && typeof item.action_type === 'string')
      .map(item => ({ action_type: item.action_type as string, value: numeric(item.value) })) : null,
  }
}
export function compareMetrics(current: Record<string, unknown>, previous: Record<string, unknown>) {
  return Object.fromEntries(['spend','impressions','clicks','reach','frequency','ctr','cpc','cpm','leads','cpl','conversions','cost_per_conversion'].map(key => {
    const a = numeric(current[key]), b = numeric(previous[key])
    return [key, { current: a, previous: b, delta: a !== null && b !== null ? a-b : null,
      percent_change: a !== null && b !== null && b > 0 ? (a-b)/b*100 : null }]
  }))
}
