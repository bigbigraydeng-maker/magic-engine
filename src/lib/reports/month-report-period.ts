/**
 * Month-to-date window for the FDE monthly report, anchored in the client's ad
 * account timezone when we have one (AU/NZ). Falls back to UTC — same as ads
 * diagnostics when no snapshot timezone exists.
 */

import { accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { localDayEndUtc, shiftDate } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { supabaseAdmin } from '@/lib/supabase'

export interface MonthReportPeriod {
  /** IANA zone used for boundaries; null = UTC. */
  timezone: string | null
  /** Inclusive calendar dates for `ad_daily_insights.insight_date`. */
  periodFrom: string
  periodTo: string
  /** UTC instants for timestamptz tables (CRM, flywheel_actions). */
  periodStartIso: string
  periodEndIso: string
  /** Human label, e.g. 2026年11月（至今）. */
  periodLabel: string
  periodScopeNote: string
}

const PREFERRED_TZ = ['Pacific/Auckland', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane']

function pickTimezone(zones: readonly string[]): string | null {
  if (zones.length === 0) return null
  if (zones.length === 1) return zones[0]
  for (const pref of PREFERRED_TZ) {
    if (zones.includes(pref)) return pref
  }
  return [...zones].sort()[0]
}

async function loadAccountTimezones(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('timezone_name, captured_at')
    .eq('client_id', clientId)
    .eq('level', 'account')
    .order('captured_at', { ascending: false })
    .limit(40)
  if (error || !data?.length) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data as Array<{ timezone_name: string | null }>) {
    const tz = row.timezone_name?.trim()
    if (!tz || seen.has(tz)) continue
    seen.add(tz)
    out.push(tz)
  }
  return out
}

export async function resolveMonthReportPeriod(
  clientId: string,
  now: Date = new Date(),
): Promise<MonthReportPeriod> {
  const zones = await loadAccountTimezones(clientId)
  const timezone = pickTimezone(zones)
  const todayKey = accountDayKey(timezone, now)
  const [year, month] = todayKey.split('-')
  const periodFrom = `${year}-${month}-01`
  const periodTo = todayKey
  const periodStartIso = new Date(
    localDayEndUtc(shiftDate(periodFrom, -1), timezone) + 1,
  ).toISOString()
  const periodEndIso = new Date(localDayEndUtc(periodTo, timezone)).toISOString()

  const periodLabel = new Date(`${periodFrom}T12:00:00Z`).toLocaleDateString('zh-CN', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: 'long',
  })
  const tzLabel = timezone ?? 'UTC'
  const periodScopeNote = `统计范围：${periodFrom} 至 ${periodTo}（${tzLabel}，本月至今）`

  return {
    timezone,
    periodFrom,
    periodTo,
    periodStartIso,
    periodEndIso,
    periodLabel: `${periodLabel}（至今）`,
    periodScopeNote,
  }
}
