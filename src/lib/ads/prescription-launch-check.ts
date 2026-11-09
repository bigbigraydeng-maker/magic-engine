/**
 * Plain-language check after a prescription's ad is already live.
 * Reads numbers the caller already loaded. Does not call Meta, write, or spend.
 */

const NZ = 'Pacific/Auckland'
const HOUR_MS = 3_600_000
const LEADS = new Set(['线索', 'lead', 'leads', 'leads_count'])
const COSTS = new Set(['成本', 'cpl', 'cost'])
// 个人 IP：私信对话数单独汇总 messaging_conversations。
// 没读到对话数就是不知道，不能用 results（线索与私信的较大值）代替。
// 看完数汇总 video_thruplays；没读到观看数就是不知道，不能用 results 代替。
const CONVERSATIONS = new Set(['对话数', '私信对话数', 'conversations', 'dm_conversations'])
const VIEWS = new Set(['看完数', '视频看完数', 'thruplays', 'video_views'])

// 营销计划流程写下的 KPI 是中文长句，靠关键词认。
const COST_PHRASES = ['线索的成本', '线索成本', '单条成本', '每条成本', '留资成本', 'CPL', 'cpl']
const LEAD_PHRASES = ['留资', '线索']
// 比例、上限、筛选过的线索都不是「线索条数越多越好」，不能拿总条数去比（复审 P1）
const NOT_A_LEAD_COUNT = ['率', '占比', '比例', '%', '上限', '不超过', '最多', '低于', '以内', '≤', '无效', '合格']
const LEAD_COUNT_UNITS = new Set(['', '条', '个', '人', 'leads'])
// 整个周期（日期范围）、结算线、每天的上限：开投后这几个时间点判不了
const PERIOD_RANGE = /\d{4}-\d{1,2}-\d{1,2}\s*至/
// 只有说的是花费、留资、成交这类的长句，才因为时间范围被放到检查之外；认不出的仍然报「认不出来」
const PLAN_LEVEL_WORDS = ['花费', '预算', '成本', '留资', '线索', '保本', '单']
const RECENT_DAYS = /最近\s*(\d+)\s*天/

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
  /** ThruPlays。null / 缺省 = 这天没读到观看数，不能当成 0。 */
  videoThruplays?: number | null
  /** 私信对话数。null / 缺省 = 这天没读到对话数，不能用 results 代替，也不能当成 0。 */
  messagingConversations?: number | null
}

export interface KpiRef {
  metric: string
  target: number | null
  unit: string
  /** 考核时间范围，例如「最近 7 天」「2026-10-25 至 2026-11-30」「每天」。缺省为 ''。 */
  timeframe?: string
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
    const timeframe = typeof row?.timeframe === 'string' ? row.timeframe.trim() : ''
    out.push({ metric, target: readMetric(row?.target_value), unit, timeframe })
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
  /** Timezone the ad account's daily rows are cut in; null when it could not be read. */
  accountTimezone: string | null
}): LaunchAssessment {
  const launchMs = Date.parse(input.launch.authorizedAt)
  if (Number.isNaN(launchMs)) return invalidLaunch(input.launch.campaignId)
  const launchDay = nzCalendarDay(new Date(launchMs))
  const zoneGap = zoneGapFor(input.accountTimezone)
  const judgeUpTo = (endDay: string): Judged =>
    zoneGap ?? judgeNumbers(input.insights, input.kpis, launchDay, endDay)
  const checkpoints = [
    ...HOURS.map(spec => hourPoint(spec, launchMs, input.now.getTime(), judgeUpTo, zoneGap)),
    ...DAYS.map(spec => dayPoint(spec, launchDay, nzCalendarDay(input.now), judgeUpTo)),
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

/**
 * 开投后检查能用的指标种类。
 * 先按精确词认（保持旧行为），再按营销计划写下的中文长句认。
 * 整个周期的总数、结算线、每天的上限不在开投后这个时间点检查。
 */
export function launchKpiKind(
  kpi: KpiRef,
): 'leads' | 'cost' | 'conversations' | 'views' | 'out_of_scope' | 'other' {
  const exact = metricKind(kpi.metric)
  if (exact !== 'other') return exact
  const timeframe = kpi.timeframe ?? ''
  const planLevel = PERIOD_RANGE.test(timeframe) || timeframe.includes('结算') || timeframe.startsWith('每天')
  if (planLevel && PLAN_LEVEL_WORDS.some(word => kpi.metric.includes(word))) return 'out_of_scope'
  if (COST_PHRASES.some(word => kpi.metric.includes(word))) return 'cost'
  if (LEAD_PHRASES.some(word => kpi.metric.includes(word)) && !kpi.metric.includes('成本')
    && LEAD_COUNT_UNITS.has(kpi.unit) && !NOT_A_LEAD_COUNT.some(word => kpi.metric.includes(word))) return 'leads'
  return 'other'
}

/**
 * 长句里的条数目标（例如「最近 7 天 新增留资 50 条」）只在窗口天数刚好对上时比：
 * 第 14 天拿 14 天的累计去比 7 天的目标会假达标，24 小时拿 1 天去比会假不达标（复审 P1）。
 * 精确词写的旧目标、成本这类比值不受影响。
 */
function inWindow(kpi: KpiRef, windowDays: number): boolean {
  if (metricKind(kpi.metric) !== 'other') return true
  const kind = launchKpiKind(kpi)
  if (kind === 'cost' || kind === 'other' || kind === 'out_of_scope') return true
  const match = RECENT_DAYS.exec(kpi.timeframe ?? '')
  return match !== null && Number(match[1]) === windowDays
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
  if (matches.length > 1) {
    // 同一支广告暂停后又开投，会有多条开投记录；同一 campaign 只算一次，从最早那次算起。
    const campaignId = matches[0].campaignId
    if (matches.every(launch => launch.campaignId === campaignId)) {
      return { kind: 'matched', launch: earliestLaunch(matches) }
    }
    return { kind: 'unmatched', lines: ['不知道。对上了不止一条已开投的广告。'] }
  }
  if (matches.length === 1) return { kind: 'matched', launch: matches[0] }
  return { kind: 'unmatched', lines: ['不知道。已开投的广告对不上这份处方。'] }
}

function earliestLaunch(launches: readonly LaunchRef[]): LaunchRef {
  return launches.reduce((earliest, launch) =>
    Date.parse(launch.authorizedAt) < Date.parse(earliest.authorizedAt) ? launch : earliest)
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

// Daily rows are cut in the ad account's own timezone; the windows are New Zealand days.
function zoneGapFor(zone: string | null): Judged | null {
  if (zone === NZ) return null
  const why = zone === null ? '读不到广告账户的时区' : `广告账户按 ${zone} 切每日数据，不是新西兰时区`
  return { verdict: 'unknown', parts: [`${why}，每日数据对不上新西兰的检查窗口，不能下结论。`] }
}

function hourPoint(
  spec: (typeof HOURS)[number],
  launchMs: number,
  nowMs: number,
  judgeUpTo: (endDay: string) => Judged,
  zoneGap: Judged | null,
): LaunchCheckpoint {
  if (nowMs < launchMs + spec.hours * HOUR_MS) {
    return {
      kpiMetric: spec.kpiMetric,
      due: false,
      verdict: 'pending',
      sentence: `${spec.label}：还不知道。开投后还没满 ${spec.hours} 小时。`,
    }
  }
  if (zoneGap) return finish(spec.kpiMetric, spec.label, zoneGap)
  const deadline = launchMs + spec.hours * HOUR_MS
  const deadlineDay = nzCalendarDay(new Date(deadline))
  // Daily rows only prove the window when the deadline falls on an NZ midnight;
  // otherwise part of the deadline day (before the deadline) is not covered.
  if (nzCalendarDay(new Date(deadline - 1)) === deadlineDay) {
    const gap: Judged = {
      verdict: 'unknown',
      parts: [`开投时间不在新西兰整点零点，每日数据凑不出刚好满 ${spec.hours} 小时的窗口（截止日 ${deadlineDay} 只走了一部分），不能下结论。`],
    }
    return finish(spec.kpiMetric, spec.label, gap)
  }
  return finish(spec.kpiMetric, spec.label, judgeUpTo(addCalendarDays(deadlineDay, -1)))
}

function dayPoint(
  spec: (typeof DAYS)[number],
  launchDay: string,
  today: string,
  judgeUpTo: (endDay: string) => Judged,
): LaunchCheckpoint {
  const endDay = addCalendarDays(launchDay, spec.offset)
  if (today < endDay) {
    return {
      kpiMetric: spec.kpiMetric,
      due: false,
      verdict: 'pending',
      sentence: `${spec.label}：还不知道。还没到${spec.label}。`,
    }
  }
  return finish(spec.kpiMetric, spec.label, judgeUpTo(endDay))
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
  endDay: string,
): Judged {
  const windowed = insights.filter(row =>
    row.insightDate !== null && row.insightDate >= launchDay && row.insightDate <= endDay)
  const dateGap = insights.some(row => row.insightDate === null)
  const missing = missingDays(windowed, launchDay, endDay)
  if (missing.length > 0) {
    return { verdict: 'unknown', parts: [`这段时间缺 ${missing.length} 天的每日数据：${missing.join('、')}，不能下结论。`] }
  }
  const parts: string[] = []
  const comparisons: boolean[] = []
  const windowDays = dayCount(launchDay, endDay)
  const checkable = kpis.filter(kpi => inWindow(kpi, windowDays))
  pushReadable(windowed, checkable, parts, comparisons)
  if (dateGap) parts.push('有几天的日期读不出来。')
  for (const kpi of checkable) pushUnrecognized(kpi, parts)
  if (kpis.length === 0) parts.push('这份处方没有写下能对照的线索或成本目标。')
  // 先定结论，再补「另有 N 项不在这个时间点检查」的说明，免得整周期的目标把结论拖成不知道。
  const verdict = verdictOf(comparisons, parts.length > comparisons.length)
  const outOfScope = kpis.filter(kpi => launchKpiKind(kpi) === 'out_of_scope').length
  if (outOfScope > 0) {
    parts.push(`另有 ${outOfScope} 项是整个周期的总数、结算线或每天的上限，不在开投后这个时间点检查。`)
  }
  const offWindow = kpis.length - checkable.length
  if (offWindow > 0) parts.push(`另有 ${offWindow} 项条数目标的时间范围跟这个时间点对不上，这次不比。`)
  return { verdict, parts }
}

function dayCount(from: string, to: string): number {
  let count = 0
  for (let day = from; day <= to; day = addCalendarDays(day, 1)) count += 1
  return count
}

function missingDays(rows: readonly InsightRef[], from: string, to: string): string[] {
  const have = new Set(rows.map(row => row.insightDate))
  const out: string[] = []
  for (let day = from; day <= to; day = addCalendarDays(day, 1)) {
    if (!have.has(day)) out.push(day)
  }
  return out
}

function pushReadable(
  rows: readonly InsightRef[],
  kpis: readonly KpiRef[],
  parts: string[],
  comparisons: boolean[],
): void {
  const leads = sumColumn(rows, 'results')
  const spend = sumColumn(rows, 'spend')
  const views = sumColumn(rows, 'videoThruplays')
  const conversations = sumColumn(rows, 'messagingConversations')
  for (const kpi of kpis) {
    const kind = launchKpiKind(kpi)
    if (kind === 'leads') pushLead(kpi, leads, parts, comparisons)
    else if (kind === 'conversations') pushCount(kpi, '对话数', conversations, parts, comparisons)
    else if (kind === 'views') pushCount(kpi, '看完数', views, parts, comparisons)
    else if (kind === 'cost') pushCost(kpi, leads, spend, parts, comparisons)
  }
}

function sumColumn(
  rows: readonly InsightRef[],
  key: 'results' | 'spend' | 'videoThruplays' | 'messagingConversations',
): number | null {
  let total = 0
  for (const row of rows) {
    const value = row[key]
    if (value === null || value === undefined) return null
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

function pushCount(
  kpi: KpiRef,
  label: string,
  count: number | null,
  parts: string[],
  comparisons: boolean[],
): void {
  if (kpi.target === null) {
    parts.push(`「${kpi.metric}」没有写下目标。`)
    return
  }
  if (count === null) {
    parts.push(`有几天的${label}是空的，不能当成 0。`)
    return
  }
  comparisons.push(count >= kpi.target)
  parts.push(pairText(label, count, kpi.target, kpi.unit))
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
  if (launchKpiKind(kpi) !== 'other') return
  parts.push(`有一个指标认不出来：${kpi.metric}。`)
}

function metricKind(metric: string): 'leads' | 'cost' | 'conversations' | 'views' | 'other' {
  const key = metric.trim().toLowerCase()
  if (LEADS.has(key)) return 'leads'
  if (CONVERSATIONS.has(key)) return 'conversations'
  if (VIEWS.has(key)) return 'views'
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
