import { efficiencyFromTotals } from '@/lib/ads-strategy/live-pacing/efficiency'
import { forecastSpendClose } from '@/lib/ads-strategy/live-pacing/forecast'
import { median } from '@/lib/ads-strategy/live-pacing/stats'
import { historicalCumulativeAt, segmentSpendDiff } from '@/lib/ads-strategy/live-pacing/windows'
import { SAMPLE_RETENTION_DAYS } from './constants'
import { accountDayKey, minorToMajor, shiftDay } from './sample'
import type { HistoricalDayCurve } from '@/lib/ads-strategy/live-pacing/types'

export interface StoredSample {
  clientId: string
  adAccountId: string
  accountDay: string
  localMinute: number
  entityLevel: 'campaign' | 'adset'
  entityId: string
  spendMinor: number
  impressions: number | null
  currency: string | null
  timezone: string
  sampledAt: string
}

export interface AccountPace {
  adAccountId: string
  accountDay: string
  timezone: string
  currency: string | null
  sampledAt: string | null
  spendMajor: number | null
  forecastStatus: string
  forecastReason: string | null
  pointMinor: number | null
  pointMajor: number | null
  lowMajor: number | null
  highMajor: number | null
  priorMedianMajor: number | null
  segmentMajor: number | null
  cpm: number | null
}

export interface PacingPayload {
  clientOverCap: boolean
  capMajor: number | null
  forecastMajor: number | null
  currency: string | null
  accounts: AccountPace[]
}

interface Tick {
  adAccountId: string
  accountDay: string
  localMinute: number
  spendMinor: number
  impressions: number
  currency: string | null
  timezone: string
  sampledAt: string
}

export function sinceDay(now: Date): string {
  const today = accountDayKey('UTC', now) ?? now.toISOString().slice(0, 10)
  return shiftDay(today, -(SAMPLE_RETENTION_DAYS + 1))
}

/** Account total is the sum of ad sets. Campaign rows are the stored breakdown, not a second total. */
export function ticksFromSamples(rows: readonly StoredSample[]): Tick[] {
  const groups = new Map<string, StoredSample[]>()
  for (const row of rows) {
    const key = `${row.adAccountId}|${row.accountDay}|${row.localMinute}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const ticks: Tick[] = []
  for (const list of groups.values()) {
    const adsets = list.filter((r) => r.entityLevel === 'adset')
    const used = adsets.length > 0 ? adsets : list.filter((r) => r.entityLevel === 'campaign')
    if (used.length > 0) ticks.push(sumTick(used))
  }
  return ticks
}

function sumTick(used: readonly StoredSample[]): Tick {
  const head = used[0]
  let spend = 0
  let impressions = 0
  for (const row of used) {
    spend += row.spendMinor
    impressions += row.impressions ?? 0
  }
  return {
    adAccountId: head.adAccountId,
    accountDay: head.accountDay,
    localMinute: head.localMinute,
    spendMinor: spend,
    impressions,
    currency: head.currency,
    timezone: head.timezone,
    sampledAt: head.sampledAt,
  }
}

function curvesFor(ticks: readonly Tick[], today: string): HistoricalDayCurve[] {
  const byDay = new Map<string, Tick[]>()
  for (const tick of ticks) {
    if (tick.accountDay === today) continue
    const list = byDay.get(tick.accountDay)
    if (list) list.push(tick)
    else byDay.set(tick.accountDay, [tick])
  }
  const curves: HistoricalDayCurve[] = []
  for (const [day, dayTicks] of byDay) {
    const sorted = [...dayTicks].sort((a, b) => a.localMinute - b.localMinute)
    const at = (minute: number) => {
      let value = 0
      for (const tick of sorted) {
        if (tick.localMinute <= minute) value = tick.spendMinor
      }
      return value
    }
    const knots = Array.from({ length: 25 }, (_, hour) => at(hour >= 24 ? 1440 : hour * 60))
    const daySpendTotal = sorted[sorted.length - 1]?.spendMinor ?? 0
    if (daySpendTotal > 0) curves.push({ accountDay: day, cumulativeSpendByHour: knots, daySpendTotal })
  }
  return curves
}

function paceAccount(ticks: readonly Tick[], today: string): AccountPace | null {
  const tz = ticks[0]?.timezone
  if (!tz) return null
  const todayTicks = ticks.filter((t) => t.accountDay === today).sort((a, b) => a.localMinute - b.localMinute)
  const latest = todayTicks[todayTicks.length - 1] ?? null
  const history = curvesFor(ticks, today)
  const forecast = latest && latest.spendMinor > 0
    ? forecastSpendClose({
      today: {
        accountDay: today,
        localMinute: latest.localMinute,
        cumulativeSpend: latest.spendMinor,
        // Clicks and results are stored on the sample. The spend forecast does not use them.
        cumulativeResults: null,
        cumulativeLinkClicks: null,
        cumulativeImpressions: latest.impressions,
      },
      history,
    })
    : null
  const currency = latest?.currency ?? ticks[0].currency
  const prior = priorMedian(history, latest?.localMinute ?? null)
  const segment = latest
    ? segmentSpendDiff(todayTicks.map((t) => ({ localMinute: t.localMinute, cumulativeSpend: t.spendMinor })), Math.max(0, latest.localMinute - 60), latest.localMinute)
    : null
  const spendMajor = latest ? minorToMajor(latest.spendMinor, currency) : null
  const point = forecast && forecast.status === 'ok' ? forecast.point : null
  const low = forecast && forecast.status === 'ok' ? forecast.low : null
  const high = forecast && forecast.status === 'ok' ? forecast.high : null
  const segmentMinor = segment?.deltaSpend ?? null
  return {
    adAccountId: ticks[0].adAccountId,
    accountDay: today,
    timezone: tz,
    currency,
    sampledAt: latest?.sampledAt ?? null,
    spendMajor,
    forecastStatus: forecast?.status ?? 'missing_samples',
    forecastReason: forecast && forecast.status !== 'ok' ? forecast.reason : null,
    pointMinor: point,
    pointMajor: point === null ? null : minorToMajor(point, currency),
    lowMajor: low === null ? null : minorToMajor(low, currency),
    highMajor: high === null ? null : minorToMajor(high, currency),
    priorMedianMajor: prior === null ? null : minorToMajor(prior, currency),
    segmentMajor: segmentMinor === null ? null : minorToMajor(segmentMinor, currency),
    cpm: efficiencyFromTotals(spendMajor, latest?.impressions ?? null, null).cpm,
  }
}

function priorMedian(history: readonly HistoricalDayCurve[], minute: number | null): number | null {
  if (minute === null) return null
  const recent = [...history].sort((a, b) => a.accountDay < b.accountDay ? 1 : -1).slice(0, 7)
  const values: number[] = []
  for (const day of recent) {
    const at = historicalCumulativeAt(day.cumulativeSpendByHour, minute)
    if (at !== null) values.push(at)
  }
  return median(values)
}

export function pacingFromSamples(
  rows: readonly StoredSample[],
  capMinor: number | null,
  now: Date,
): PacingPayload {
  const byAccount = new Map<string, Tick[]>()
  for (const tick of ticksFromSamples(rows)) {
    const list = byAccount.get(tick.adAccountId)
    if (list) list.push(tick)
    else byAccount.set(tick.adAccountId, [tick])
  }
  const accounts: AccountPace[] = []
  let forecastMinor = 0
  let ok = 0
  let blocked = false
  const currencies = new Set<string>()
  for (const ticks of byAccount.values()) {
    const today = accountDayKey(ticks[0].timezone, now)
    if (!today) continue
    const pace = paceAccount(ticks, today)
    if (!pace) continue
    accounts.push(pace)
    const latestSpend = ticks.filter((t) => t.accountDay === today).sort((a, b) => a.localMinute - b.localMinute).at(-1)
    if (latestSpend && latestSpend.spendMinor > 0 && pace.forecastStatus !== 'ok') blocked = true
    if (pace.forecastStatus === 'ok' && pace.pointMinor !== null) {
      ok += 1
      forecastMinor += pace.pointMinor
      if (pace.currency) currencies.add(pace.currency)
    }
  }
  const currency = currencies.size === 1 ? [...currencies][0] : null
  const clientOverCap = !blocked && ok > 0 && currency !== null && capMinor !== null && capMinor > 0 && forecastMinor > capMinor
  return {
    clientOverCap,
    capMajor: capMinor === null || currency === null ? null : minorToMajor(capMinor, currency),
    forecastMajor: clientOverCap || (ok > 0 && !blocked && currency !== null) ? minorToMajor(forecastMinor, currency) : null,
    currency,
    accounts,
  }
}
