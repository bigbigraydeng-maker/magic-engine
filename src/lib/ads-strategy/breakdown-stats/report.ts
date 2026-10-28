import {
  BreakdownReport,
  FLAG_MIN_EXPECTED,
  FLAG_Z,
  LEAD_OBJECTIVES,
  NonLeadSpend,
  REGION_TOP_N,
  ReportAccount,
  ReportRow,
  RowFlag,
} from './report-types'

export interface StatInput {
  ad_account_id: string
  campaign_id: string | null
  stat_date: string
  breakdown_key: string
  breakdown_value: Record<string, string | number>
  spend: number
  impressions: number
  clicks: number
  meta_leads: number | null
}

export interface LeadInput {
  ad_account_id: string
  local_date: string
  local_hour: number
}

/** 'YYYY-MM-DD' -> 1..7 (Mon=1..Sun=7) using UTC calendar. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay()
  return day === 0 ? 7 : day
}

interface FlagInput {
  key: string
  spend: number
  impressions: number
  clicks: number
  leads: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function flagRows(rows: FlagInput[]): ReportRow[] {
  let totalSpend = 0
  let totalLeads = 0
  for (const r of rows) {
    totalSpend += r.spend
    if (r.leads !== null) totalLeads += r.leads
  }
  const perDollar = totalSpend > 0 ? totalLeads / totalSpend : 0

  return rows.map((r) => {
    const spendShare = totalSpend > 0 ? r.spend / totalSpend : 0
    if (r.leads === null) {
      return {
        key: r.key,
        spend: round2(r.spend),
        impressions: r.impressions,
        clicks: r.clicks,
        leads: null,
        costPerLead: null,
        expectedLeads: null,
        flag: null,
        spendShare,
      }
    }
    const costPerLead = r.leads > 0 ? round2(r.spend / r.leads) : null
    const expectedLeads = r.spend * perDollar
    const z = expectedLeads > 0 ? (r.leads - expectedLeads) / Math.sqrt(expectedLeads) : 0
    let flag: RowFlag
    if (expectedLeads < FLAG_MIN_EXPECTED) flag = 'too_few'
    else if (z < -FLAG_Z) flag = 'costly'
    else if (z > FLAG_Z) flag = 'cheap'
    else flag = 'normal'
    return {
      key: r.key,
      spend: round2(r.spend),
      impressions: r.impressions,
      clicks: r.clicks,
      leads: r.leads,
      costPerLead,
      expectedLeads: round1(expectedLeads),
      flag,
      spendShare,
    }
  })
}

interface Acc {
  spend: number
  impressions: number
  clicks: number
  leads: number
}

function emptyAcc(): Acc {
  return { spend: 0, impressions: 0, clicks: 0, leads: 0 }
}

function addTo(acc: Acc, s: StatInput, leads: number): void {
  acc.spend += s.spend
  acc.impressions += s.impressions
  acc.clicks += s.clicks
  acc.leads += leads
}

function toFlagInput(key: string, acc: Acc): FlagInput {
  return {
    key,
    spend: acc.spend,
    impressions: acc.impressions,
    clicks: acc.clicks,
    leads: acc.leads,
  }
}

function isLeadObjective(
  s: StatInput,
  objectives: ReadonlyMap<string, string | null>,
): boolean {
  if (!s.campaign_id) return false
  const obj = objectives.get(s.campaign_id)
  return obj !== null && obj !== undefined && LEAD_OBJECTIVES.includes(obj)
}

function objectiveOf(
  s: StatInput,
  objectives: ReadonlyMap<string, string | null>,
): string {
  if (!s.campaign_id) return 'UNKNOWN'
  const obj = objectives.get(s.campaign_id)
  return obj ?? 'UNKNOWN'
}

function strVal(v: string | number | undefined): string {
  return v === undefined ? '' : String(v)
}

function numVal(v: string | number | undefined): number {
  if (v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function sortBySpendDesc(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort((a, b) => b.spend - a.spend)
}

function groupByKey(
  stats: readonly StatInput[],
  keyFn: (s: StatInput) => string,
  leadsFn: (s: StatInput) => number,
): Map<string, Acc> {
  const map = new Map<string, Acc>()
  for (const s of stats) {
    const k = keyFn(s)
    const acc = map.get(k) ?? emptyAcc()
    addTo(acc, s, leadsFn(s))
    map.set(k, acc)
  }
  return map
}

function buildHour(
  stats: readonly StatInput[],
  leads: readonly LeadInput[],
): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) => strVal(s.breakdown_value.hour),
    () => 0,
  )
  const leadCounts = new Array<number>(24).fill(0)
  for (const l of leads) {
    if (l.local_hour >= 0 && l.local_hour < 24) leadCounts[l.local_hour] += 1
  }
  const rows: FlagInput[] = []
  for (let h = 0; h < 24; h++) {
    const acc = map.get(String(h)) ?? emptyAcc()
    rows.push({
      key: String(h),
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      leads: leadCounts[h],
    })
  }
  return flagRows(rows)
}

function buildWeekday(
  stats: readonly StatInput[],
  leads: readonly LeadInput[],
): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) => String(isoWeekday(s.stat_date)),
    () => 0,
  )
  const leadCounts = new Array<number>(8).fill(0)
  for (const l of leads) {
    const wd = isoWeekday(l.local_date)
    leadCounts[wd] += 1
  }
  const rows: FlagInput[] = []
  for (let wd = 1; wd <= 7; wd++) {
    const acc = map.get(String(wd)) ?? emptyAcc()
    rows.push({
      key: String(wd),
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      leads: leadCounts[wd],
    })
  }
  return flagRows(rows)
}

function buildPlacement(stats: readonly StatInput[]): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) =>
      `${strVal(s.breakdown_value.platform)} · ${strVal(s.breakdown_value.position)}`,
    (s) => s.meta_leads ?? 0,
  )
  const rows: FlagInput[] = []
  for (const [key, acc] of map) rows.push(toFlagInput(key, acc))
  return sortBySpendDesc(flagRows(rows))
}

function buildDevice(stats: readonly StatInput[]): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) => strVal(s.breakdown_value.device),
    (s) => s.meta_leads ?? 0,
  )
  const rows: FlagInput[] = []
  for (const [key, acc] of map) rows.push(toFlagInput(key, acc))
  return sortBySpendDesc(flagRows(rows))
}

function buildAgeGender(stats: readonly StatInput[]): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) =>
      `${strVal(s.breakdown_value.age)} · ${strVal(s.breakdown_value.gender)}`,
    (s) => s.meta_leads ?? 0,
  )
  const rows: FlagInput[] = []
  for (const [key, acc] of map) rows.push(toFlagInput(key, acc))
  return sortBySpendDesc(flagRows(rows))
}

function buildRegion(stats: readonly StatInput[]): ReportRow[] {
  const map = groupByKey(
    stats,
    (s) => strVal(s.breakdown_value.region),
    () => 0,
  )
  const rows: FlagInput[] = []
  for (const [key, acc] of map) {
    rows.push({
      key,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      leads: null,
    })
  }
  return sortBySpendDesc(flagRows(rows)).slice(0, REGION_TOP_N)
}

function buildNonLeadSpend(
  stats: readonly StatInput[],
  objectives: ReadonlyMap<string, string | null>,
): NonLeadSpend[] {
  const map = new Map<string, number>()
  for (const s of stats) {
    const obj = objectiveOf(s, objectives)
    map.set(obj, (map.get(obj) ?? 0) + s.spend)
  }
  const out: NonLeadSpend[] = []
  for (const [objective, spend] of map) {
    if (spend >= 0.01) out.push({ objective, spend: round2(spend) })
  }
  return out.sort((a, b) => b.spend - a.spend)
}

interface Totals {
  spendAll: number
  spendLeadObjective: number
  metaLeads: number
  crmLeads: number
  matchRate: number | null
  costPerCrmLead: number | null
}

function buildTotals(
  placementDevice: readonly StatInput[],
  objectives: ReadonlyMap<string, string | null>,
  crmLeads: number,
): Totals {
  let spendAll = 0
  let spendLeadObjective = 0
  let metaLeads = 0
  for (const s of placementDevice) {
    spendAll += s.spend
    if (isLeadObjective(s, objectives)) {
      spendLeadObjective += s.spend
      metaLeads += s.meta_leads ?? 0
    }
  }
  const matchRate = metaLeads > 0 ? crmLeads / metaLeads : null
  const costPerCrmLead = crmLeads > 0 ? round2(spendLeadObjective / crmLeads) : null
  return {
    spendAll: round2(spendAll),
    spendLeadObjective: round2(spendLeadObjective),
    metaLeads,
    crmLeads,
    matchRate,
    costPerCrmLead,
  }
}

export function buildBreakdownReport(input: {
  since: string
  until: string
  days: number
  accounts: ReportAccount[]
  stats: readonly StatInput[]
  leads: readonly LeadInput[]
  objectives: ReadonlyMap<string, string | null>
}): BreakdownReport {
  const { since, until, days, accounts, stats, leads, objectives } = input

  const placementDevice = stats.filter((s) => s.breakdown_key === 'placement_device')
  const leadStats = stats.filter((s) => isLeadObjective(s, objectives))

  const hourStats = leadStats.filter((s) => s.breakdown_key === 'hour_account_tz')
  // There is no 'weekday' breakdown in the table: weekdays are the hourly rows grouped by stat_date.
  const weekdayStats = leadStats.filter((s) => s.breakdown_key === 'hour_account_tz')
  const placementStats = leadStats.filter((s) => s.breakdown_key === 'placement_device')
  const deviceStats = leadStats.filter((s) => s.breakdown_key === 'device')
  const ageGenderStats = leadStats.filter((s) => s.breakdown_key === 'age_gender')
  const regionStats = leadStats.filter((s) => s.breakdown_key === 'region')

  return {
    window: { since, until, days },
    accounts,
    totals: buildTotals(placementDevice, objectives, leads.length),
    nonLeadSpend: buildNonLeadSpend(placementDevice.filter((s) => !isLeadObjective(s, objectives)), objectives),
    hour: buildHour(hourStats, leads),
    weekday: buildWeekday(weekdayStats, leads),
    placement: buildPlacement(placementStats),
    device: buildDevice(deviceStats),
    ageGender: buildAgeGender(ageGenderStats),
    region: buildRegion(regionStats),
  }
}
