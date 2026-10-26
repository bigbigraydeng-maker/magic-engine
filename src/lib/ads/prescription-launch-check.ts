/**
 * Plain-language check after a prescription's ad is already live.
 * Reads numbers the caller already loaded. Does not call Meta, write, or spend.
 */

const NZ = 'Pacific/Auckland'
const HOUR_MS = 3_600_000
const LEADS = new Set(['线索', 'lead', 'leads', 'leads_count'])
const COSTS = new Set(['成本', 'cpl', 'cost'])

const HOURS = [
  { kpiMetric: 'launch_check_24h', label: '24 小时', hours: 24 },
  { kpiMetric: 'launch_check_48h', label: '48 小时', hours: 48 },
] as const

const DAYS = [
  { kpiMetric: 'launch_check_day7', label: '第 7 天', offset: 6 },
  { kpiMetric: 'launch_check_day14', label: '第 14 天', offset: 13 },
] as const

export const LAUNCH_CHECK_METRICS = [
  'launch_check_24h',
  'launch_check_48h',
  'launch_check_day7',
  'launch_check_day14',
] as const

export const NOT_LAUNCHED_LINE = '还没对上已开投的广告，所以还不知道。'
export const UNSAVED_CASE_LINE = '这份结论还没写进复盘记录，因为没有案例行。'

export type LaunchVerdict = 'met' | 'missed' | 'unknown' | 'pending'

export interface PrescriptionRef {
  id: string
  goalId: string
  status: string
  approvedAt: string | null
}

export interface LaunchRef {
  id: string
  clientId: string
  authorizedAt: string
  campaignId: string
}

export interface PlanRef {
  goalId: string
  approvedAt: string
}

export interface SiblingRef {
  id: string
  approvedAt: string
}

export interface InsightRef {
  insightDate: string | null
  spend: number | null
  results: number | null
}

export interface KpiRef {
  metric: string
  target: number | null
  unit: string
}

export interface ActionRow {
  id: string
  clientId: string
  payload: unknown
}

export interface LaunchCheckpoint {
  kpiMetric: (typeof LAUNCH_CHECK_METRICS)[number]
  due: boolean
  verdict: LaunchVerdict
  sentence: string
}

export interface LaunchAssessment {
  lines: string[]
  checkpoints: LaunchCheckpoint[]
  campaignId: string | null
}

export type LaunchMatch =
  | { kind: 'not_launched'; lines: string[] }
  | { kind: 'unmatched'; lines: string[] }
  | { kind: 'matched'; launch: LaunchRef }

export interface ExistingOutcome {
  id: string
  kpiMetric: string
  unit: string | null
  dimension: string | null
}

export type OutcomeWrite =
  | { op: 'insert'; kpiMetric: string; unit: 'met' | 'missed' | 'unknown'; dimension: string }
  | { op: 'update'; id: string; kpiMetric: string; unit: 'met' | 'missed' | 'unknown'; dimension: string }

interface Judged {
  verdict: 'met' | 'missed' | 'unknown'
  parts: string[]
}

export function nzCalendarDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

export function readMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function kpisFromContent(content: unknown): KpiRef[] {
  const record = asRecord(content)
  const raw = record?.kpi_targets
  if (!Array.isArray(raw)) return []
  const out: KpiRef[] = []
  for (const item of raw) {
    const row = asRecord(item)
    const metric = typeof row?.metric === 'string' ? row.metric.trim() : ''
    if (metric === '') continue
    const unit = typeof row?.unit === 'string' ? row.unit.trim() : ''
    out.push({ metric, target: readMetric(row?.target_value), unit })
  }
  return out
}

export function parseExecutedLaunches(rows: readonly ActionRow[]): {
  launches: LaunchRef[]
  missingCampaign: number
} {
  const launches: LaunchRef[] = []
  let missingCampaign = 0
  for (const row of rows) {
    const parsed = parseOneLaunch(row)
    if (parsed === 'missing') missingCampaign += 1
    else if (parsed) launches.push(parsed)
  }
  return { launches, missingCampaign }
}

export function matchLaunch(input: {
  prescription: PrescriptionRef
  launches: readonly LaunchRef[]
  plans: readonly PlanRef[]
  siblings: readonly SiblingRef[]
  missingCampaign: boolean
}): LaunchMatch {
  if (input.launches.length === 0 && !input.missingCampaign) {
    return { kind: 'not_launched', lines: [NOT_LAUNCHED_LINE] }
  }
  const blocked = blockedReason(input.prescription)
  if (blocked) return { kind: 'unmatched', lines: [`不知道。${blocked}`] }
  if (input.launches.length === 0) {
    return { kind: 'unmatched', lines: ['不知道。开投记录没有广告编号，对不上。'] }
  }
  return classifyLaunches(input.prescription, input.launches, input.plans, input.siblings)
}

export function judgeLaunch(input: {
  launch: LaunchRef
  insights: readonly InsightRef[]
  kpis: readonly KpiRef[]
  now: Date
}): LaunchAssessment {
  const launchMs = Date.parse(input.launch.authorizedAt)
  if (Number.isNaN(launchMs)) return invalidLaunch(input.launch.campaignId)
  const judged = judgeNumbers(input.insights, input.kpis, nzCalendarDay(new Date(launchMs)), nzCalendarDay(input.now))
  const checkpoints = [
    ...HOURS.map(spec => hourPoint(spec, launchMs, input.now.getTime(), judged)),
    ...DAYS.map(spec => dayPoint(spec, nzCalendarDay(new Date(launchMs)), nzCalendarDay(input.now), judged)),
  ]
  return { lines: checkpoints.map(point => point.sentence), checkpoints, campaignId: input.launch.campaignId }
}

export function linesForCard(assessment: LaunchAssessment, saved: boolean): string[] {
  const due = assessment.checkpoints.some(point => point.due && point.verdict !== 'pending')
  if (saved || !due) return assessment.lines
  return [...assessment.lines, UNSAVED_CASE_LINE]
}

export function planOutcomeWrites(
  checkpoints: readonly LaunchCheckpoint[],
  existing: readonly ExistingOutcome[],
): OutcomeWrite[] {
  const writes: OutcomeWrite[] = []
  for (const point of checkpoints) {
    const write = writeFor(point, existing.find(row => row.kpiMetric === point.kpiMetric))
    if (write) writes.push(write)
  }
  return writes
}

export function pickLatestCase(rows: readonly { id: string; createdAt: string }[]): string | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((left, right) => {
    if (left.createdAt === right.createdAt) return left.id < right.id ? 1 : -1
    return left.createdAt < right.createdAt ? 1 : -1
  })
  return sorted[0]?.id ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseOneLaunch(row: ActionRow): LaunchRef | 'missing' | null {
  const payload = asRecord(row.payload)
  const activation = asRecord(payload?.activation)
  if (!payload || payload.status !== 'active' || activation?.status !== 'executed') return null
  const authorizedAt = typeof activation.authorized_at === 'string' ? activation.authorized_at : ''
  if (authorizedAt === '' || Number.isNaN(Date.parse(authorizedAt))) return null
  const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId.trim() : ''
  if (campaignId === '') return 'missing'
  const id = row.id.trim() === '' ? campaignId : row.id
  return { id, clientId: row.clientId, authorizedAt, campaignId }
}

function blockedReason(prescription: PrescriptionRef): string | null {
  if (prescription.status !== 'approved') return '这份处方还没通过，对不上已开投的广告。'
  if (!prescription.approvedAt || Number.isNaN(Date.parse(prescription.approvedAt))) {
    return '这份处方没有通过时间，对不上已开投的广告。'
  }
  if (prescription.goalId.trim() === '') return '这份处方没有目标，对不上已开投的广告。'
  return null
}

function classifyLaunches(
  prescription: PrescriptionRef,
  launches: readonly LaunchRef[],
  plans: readonly PlanRef[],
  siblings: readonly SiblingRef[],
): LaunchMatch {
  const pool = siblingPool(prescription, siblings)
  let tie = false
  const matches: LaunchRef[] = []
  for (const launch of launches) {
    const mark = markLaunch(prescription, launch, plans, pool)
    if (mark === 'tie') tie = true
    else if (mark === 'match') matches.push(launch)
  }
  if (tie) return { kind: 'unmatched', lines: ['不知道。同一时间通过了不止一份处方，对不上是哪一份。'] }
  if (matches.length > 1) return { kind: 'unmatched', lines: ['不知道。对上了不止一条已开投的广告。'] }
  if (matches.length === 1) return { kind: 'matched', launch: matches[0] }
  return { kind: 'unmatched', lines: ['不知道。已开投的广告对不上这份处方。'] }
}

function siblingPool(prescription: PrescriptionRef, siblings: readonly SiblingRef[]): SiblingRef[] {
  const pool = siblings.filter(item => item.approvedAt !== '')
  const approvedAt = prescription.approvedAt
  if (approvedAt && !pool.some(item => item.id === prescription.id)) {
    pool.push({ id: prescription.id, approvedAt })
  }
  return pool
}

function markLaunch(
  prescription: PrescriptionRef,
  launch: LaunchRef,
  plans: readonly PlanRef[],
  pool: readonly SiblingRef[],
): 'match' | 'tie' | 'skip' {
  const covered = plans.some(plan =>
    plan.goalId === prescription.goalId && atOrBefore(plan.approvedAt, launch.authorizedAt))
  if (!covered) return 'skip'
  const eligible = pool.filter(item => atOrBefore(item.approvedAt, launch.authorizedAt))
  if (eligible.length === 0) return 'skip'
  const latest = eligible.reduce((max, item) => (atOrBefore(max, item.approvedAt) ? item.approvedAt : max), eligible[0].approvedAt)
  const leaders = eligible.filter(item => sameTime(item.approvedAt, latest))
  if (!leaders.some(item => item.id === prescription.id)) return 'skip'
  return leaders.length > 1 ? 'tie' : 'match'
}

function atOrBefore(left: string, right: string): boolean {
  const earlier = Date.parse(left)
  const later = Date.parse(right)
  return !Number.isNaN(earlier) && !Number.isNaN(later) && earlier <= later
}

function sameTime(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right)
}

function invalidLaunch(campaignId: string): LaunchAssessment {
  const judged: Judged = { verdict: 'unknown', parts: ['开投时间读不出来。'] }
  const checkpoints = [
    ...HOURS.map(spec => finish(spec.kpiMetric, spec.label, judged)),
    ...DAYS.map(spec => finish(spec.kpiMetric, spec.label, judged)),
  ]
  return { lines: checkpoints.map(point => point.sentence), checkpoints, campaignId }
}

function hourPoint(
  spec: (typeof HOURS)[number],
  launchMs: number,
  nowMs: number,
  judged: Judged,
): LaunchCheckpoint {
  if (nowMs < launchMs + spec.hours * HOUR_MS) {
    return {
      kpiMetric: spec.kpiMetric,
      due: false,
      verdict: 'pending',
      sentence: `${spec.label}：还不知道。开投后还没满 ${spec.hours} 小时。`,
    }
  }
  return finish(spec.kpiMetric, spec.label, judged)
}

function dayPoint(
  spec: (typeof DAYS)[number],
  launchDay: string,
  today: string,
  judged: Judged,
): LaunchCheckpoint {
  if (today < addCalendarDays(launchDay, spec.offset)) {
    return {
      kpiMetric: spec.kpiMetric,
      due: false,
      verdict: 'pending',
      sentence: `${spec.label}：还不知道。还没到${spec.label}。`,
    }
  }
  return finish(spec.kpiMetric, spec.label, judged)
}

function finish(
  kpiMetric: LaunchCheckpoint['kpiMetric'],
  label: string,
  judged: Judged,
): LaunchCheckpoint {
  const word = judged.verdict === 'met' ? '达标' : judged.verdict === 'missed' ? '没达标' : '不知道'
  return { kpiMetric, due: true, verdict: judged.verdict, sentence: `${label}：${word}。${judged.parts.join('')}` }
}

function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function judgeNumbers(
  insights: readonly InsightRef[],
  kpis: readonly KpiRef[],
  launchDay: string,
  today: string,
): Judged {
  const windowed = insights.filter(row =>
    row.insightDate !== null && row.insightDate >= launchDay && row.insightDate <= today)
  const dateGap = insights.some(row => row.insightDate === null)
  const parts: string[] = []
  const comparisons: boolean[] = []
  if (windowed.length === 0) parts.push('开投后还没有这一条广告的每日花费和线索。')
  else pushReadable(windowed, kpis, parts, comparisons)
  if (dateGap) parts.push('有几天的日期读不出来。')
  for (const kpi of kpis) pushUnrecognized(kpi, parts)
  if (kpis.length === 0) parts.push('这份处方没有写下能对照的线索或成本目标。')
  return { verdict: verdictOf(comparisons, parts.length > comparisons.length), parts }
}

function pushReadable(
  rows: readonly InsightRef[],
  kpis: readonly KpiRef[],
  parts: string[],
  comparisons: boolean[],
): void {
  const leads = sumColumn(rows, 'results')
  const spend = sumColumn(rows, 'spend')
  for (const kpi of kpis) {
    const kind = metricKind(kpi.metric)
    if (kind === 'leads') pushLead(kpi, leads, parts, comparisons)
    else if (kind === 'cost') pushCost(kpi, leads, spend, parts, comparisons)
  }
}

function sumColumn(rows: readonly InsightRef[], key: 'results' | 'spend'): number | null {
  let total = 0
  for (const row of rows) {
    const value = row[key]
    if (value === null) return null
    total += value
  }
  return total
}

function pushLead(kpi: KpiRef, leads: number | null, parts: string[], comparisons: boolean[]): void {
  if (kpi.target === null) {
    parts.push(`「${kpi.metric}」没有写下目标。`)
    return
  }
  if (leads === null) {
    parts.push('有几天的线索是空的，不能当成 0。')
    return
  }
  comparisons.push(leads >= kpi.target)
  parts.push(pairText('线索', leads, kpi.target, kpi.unit))
}

function pushCost(
  kpi: KpiRef,
  leads: number | null,
  spend: number | null,
  parts: string[],
  comparisons: boolean[],
): void {
  if (kpi.target === null) {
    parts.push(`「${kpi.metric}」没有写下目标。`)
    return
  }
  if (leads === null) {
    parts.push('线索读不全，算不出单条成本。')
    return
  }
  if (leads === 0) {
    parts.push('线索是 0，算不出单条成本。')
    return
  }
  if (spend === null) {
    parts.push('有几天的花费是空的，不能当成 0。')
    return
  }
  const each = spend / leads
  comparisons.push(each <= kpi.target)
  parts.push(pairText('单条成本', each, kpi.target, kpi.unit))
}

function pushUnrecognized(kpi: KpiRef, parts: string[]): void {
  if (metricKind(kpi.metric) !== 'other') return
  parts.push(`有一个指标认不出来：${kpi.metric}。`)
}

function metricKind(metric: string): 'leads' | 'cost' | 'other' {
  const key = metric.trim().toLowerCase()
  if (LEADS.has(key)) return 'leads'
  if (COSTS.has(key)) return 'cost'
  return 'other'
}

function pairText(label: string, actual: number, target: number, unit: string): string {
  const suffix = unit === '' ? '' : ` ${unit}`
  return `${label} ${fmt(actual)}${suffix}，目标 ${fmt(target)}${suffix}。`
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function verdictOf(comparisons: readonly boolean[], hasGap: boolean): Judged['verdict'] {
  if (comparisons.some(met => !met)) return 'missed'
  if (hasGap || comparisons.length === 0) return 'unknown'
  return 'met'
}

function writeFor(point: LaunchCheckpoint, prior: ExistingOutcome | undefined): OutcomeWrite | null {
  if (!point.due || point.verdict === 'pending') return null
  if (!prior) return { op: 'insert', kpiMetric: point.kpiMetric, unit: point.verdict, dimension: point.sentence }
  if (prior.unit === 'met' || prior.unit === 'missed') return null
  if (prior.unit === point.verdict && prior.dimension === point.sentence) return null
  return { op: 'update', id: prior.id, kpiMetric: point.kpiMetric, unit: point.verdict, dimension: point.sentence }
}
