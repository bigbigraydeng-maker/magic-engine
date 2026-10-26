/**
 * 把一份已批准方案的进度，写成给人不看表也能懂的两句话。
 *
 * 只复述已经数到的事实。数字对不上就说对不上，不把「没读到」写成「变好」或「变差」。
 * 调整建议只是建议：句子里写明系统不会自己改方案、不会批准、不会动广告。
 */

export interface ActionCounts {
  completed: number
  inProgress: number
  pending: number
  skipped: number
  /** 方案自己的待办里，已经收起、不再算「还没开始」的件数。目标汇总不用这个字段。 */
  superseded: number
  /** 目标汇总里，四种状态之外的件数。方案自己的待办不用这个字段。 */
  other: number
}

export interface WorkOrderCounts {
  doing: number
  published: number
  stuck: number
  other: number
}

export interface AdDraftCounts {
  waiting: number
  active: number
  rejected: number
  other: number
}

export interface MetricFact {
  label: string
  baseline: number | null
  current: number | null
  target: number | null
  direction: 'increase' | 'decrease'
  fetchedOn: string | null
}

export interface MeasuredKpi {
  metric: string
  actual: number | null
  target: number | null
  unit: string | null
}

export interface PrescriptionCheckFacts {
  goalTitle: string | null
  /** 方案上写了目标。没有目标时，阶段和工单都对不上，不能拿客户名下全部来凑。 */
  goalLinked: boolean
  approvedOn: string | null
  /** 目标下的阶段读到了。没读到时 initiativeCount 不作数。 */
  initiativesKnown: boolean
  initiativeCount: number
  goalActions: ActionCounts | null
  prescriptionActions: ActionCounts
  workOrders: WorkOrderCounts | null
  adDrafts: AdDraftCounts
  /** 阶段上挂着的活动简报（已按编号去重）。没读到阶段时为 null。 */
  campaigns: { total: number } | null
  metric: MetricFact | null
  measuredKpis: MeasuredKpi[]
  /** 某一类记录读到了上限。件数可能不全，不能把没读到的说成零。 */
  readsCapped: boolean
}

export interface PrescriptionCheckText {
  progress: string
  suggestion: string
}

const DOING_WORK = new Set([
  'queued', 'claimed', 'producing', 'rendered', 'in_review',
  'approved', 'publishing', 'measuring',
])
const PUBLISHED_WORK = new Set(['published', 'closed'])
const STUCK_WORK = new Set(['failed', 'dead_letter', 'review_rejected', 'publish_failed'])
const IGNORED_WORK = new Set(['archived', 'superseded'])

export function emptyActions(): ActionCounts {
  return { completed: 0, inProgress: 0, pending: 0, skipped: 0, superseded: 0, other: 0 }
}

/** 内容工单按状态归成四类。收起的、归档的不计入，避免把旧单说成还在做。 */
export function countWorkOrders(statuses: string[]): WorkOrderCounts {
  const counts: WorkOrderCounts = { doing: 0, published: 0, stuck: 0, other: 0 }
  for (const status of statuses) {
    if (DOING_WORK.has(status)) counts.doing += 1
    else if (PUBLISHED_WORK.has(status)) counts.published += 1
    else if (STUCK_WORK.has(status)) counts.stuck += 1
    else if (!IGNORED_WORK.has(status)) counts.other += 1
  }
  return counts
}

/** 只数挂到这份方案待办上的广告草稿。认不出状态的单独计数，不当成已打开。 */
export function countLinkedAdDrafts(payloads: unknown[]): AdDraftCounts {
  const counts: AdDraftCounts = { waiting: 0, active: 0, rejected: 0, other: 0 }
  for (const raw of payloads) {
    const status = payloadStatus(raw)
    if (status === 'awaiting_approval') counts.waiting += 1
    else if (status === 'active') counts.active += 1
    else if (status === 'rejected') counts.rejected += 1
    else if (status !== 'dry_run_logged') counts.other += 1
  }
  return counts
}

export function countPrescriptionActions(statuses: string[]): ActionCounts {
  const counts = emptyActions()
  for (const status of statuses) {
    if (status === 'completed') counts.completed += 1
    else if (status === 'in_progress') counts.inProgress += 1
    else if (status === 'pending') counts.pending += 1
    else if (status === 'skipped') counts.skipped += 1
    else if (status === 'superseded') counts.superseded += 1
    else counts.other += 1
  }
  return counts
}

/** 同一目标只留最新一份已批准的方案。批准时间打平时用编号，结果要稳定。 */
export function pickInActPrescriptions<T extends {
  id: string
  client_id: string
  goal_id: string | null
  status: string
  approved_at: string | null
}>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    if (row.status !== 'approved') continue
    const key = `${row.client_id}:${row.goal_id ?? ''}`
    const current = best.get(key)
    if (!current || newer(row, current)) best.set(key, row)
  }
  return Array.from(best.values())
}

export function describePrescriptionCheck(facts: PrescriptionCheckFacts): PrescriptionCheckText {
  const progress = [
    openingSentence(facts),
    stageSentence(facts),
    goalActionSentence(facts),
    prescriptionActionSentence(facts),
    workOrderSentence(facts),
    campaignSentence(facts),
    adDraftSentence(facts),
    metricSentence(facts),
    facts.readsCapped ? '有一类记录这次一次读不完，上面的件数可能不全。没读到的不当成零。' : '',
  ].filter((line) => line.length > 0).join('')
  return { progress, suggestion: suggestionSentences(facts).slice(0, 2).join('') }
}

export function formatCnDate(iso: string | null): string | null {
  if (!iso || iso.length < 10) return null
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || day < 1) return null
  return `${month} 月 ${day} 日`
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function newer(
  row: { id: string; approved_at: string | null },
  current: { id: string; approved_at: string | null },
): boolean {
  const left = row.approved_at ?? ''
  const right = current.approved_at ?? ''
  if (left !== right) return left > right
  return row.id < current.id
}

function payloadStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const status = (raw as { status?: unknown }).status
  return typeof status === 'string' ? status : ''
}

function openingSentence(facts: PrescriptionCheckFacts): string {
  const when = formatCnDate(facts.approvedOn)
  const subject = facts.goalTitle ? `目标《${facts.goalTitle}》` : '这份方案'
  const approved = when ? `在 ${when}批准` : '已经批准'
  return `${subject}${approved}，现在仍是正在执行的那一份。本周没有新开方案，也没有自动批准。`
}

function stageSentence(facts: PrescriptionCheckFacts): string {
  if (!facts.goalLinked) return '这份方案没有挂目标，所以对不上阶段。'
  if (!facts.goalTitle) return '这份方案挂的目标标题没读到。'
  if (!facts.initiativesKnown) return '目标下的阶段这周没读出来，不把没读到当成没有。'
  return `目标下现在有 ${facts.initiativeCount} 条阶段。`
}

function goalActionSentence(facts: PrescriptionCheckFacts): string {
  const actions = facts.goalActions
  if (!facts.goalLinked || !facts.initiativesKnown || !actions) return ''
  const sum = actions.completed + actions.inProgress + actions.pending + actions.skipped
  if (sum === 0 && actions.other === 0) return '这些阶段上还没有待办。'
  const other = actions.other > 0 ? `另有 ${actions.other} 件不在这四种状态里。` : ''
  return `这个目标下各阶段上的待办（含不是这份方案插进去的）：已完成 ${actions.completed} 件，还在做 ${actions.inProgress} 件，还没开始 ${actions.pending} 件，跳过 ${actions.skipped} 件。${other}`
}

function prescriptionActionSentence(facts: PrescriptionCheckFacts): string {
  const actions = facts.prescriptionActions
  const live = actions.completed + actions.inProgress + actions.pending + actions.skipped + actions.other
  if (live === 0 && actions.superseded === 0) {
    return '看板上没有挂着这份方案的待办。批准方案时不会再往看板上插待办，所以这不是故障。'
  }
  if (live === 0) {
    return `看板上这份方案没有还在用的待办。另有 ${actions.superseded} 件已经收起，没有算成没做。`
  }
  const putAway = actions.superseded > 0 ? `另有 ${actions.superseded} 件已经收起。` : ''
  const other = actions.other > 0 ? `另有 ${actions.other} 件状态对不上，没有算成完成或没做。` : ''
  return `看板上挂着这份方案的待办：已完成 ${actions.completed} 件，还在做 ${actions.inProgress} 件，还没开始 ${actions.pending} 件，跳过 ${actions.skipped} 件。${putAway}${other}`
}

function workOrderSentence(facts: PrescriptionCheckFacts): string {
  if (!facts.goalLinked || !facts.workOrders) {
    return '看不出哪些内容工单属于它，没有拿这个客户的全部工单来凑。'
  }
  const orders = facts.workOrders
  const other = orders.other > 0 ? `另有 ${orders.other} 张不在这三类里，没有把它算成完成或失败。` : ''
  return `这个目标下的内容工单：在做 ${orders.doing} 张，已发出 ${orders.published} 张，卡住 ${orders.stuck} 张。${other}`
}

function campaignSentence(facts: PrescriptionCheckFacts): string {
  if (!facts.campaigns || facts.campaigns.total === 0) return ''
  return `阶段上挂着 ${facts.campaigns.total} 份活动简报。`
}

function adDraftSentence(facts: PrescriptionCheckFacts): string {
  const drafts = facts.adDrafts
  const total = drafts.waiting + drafts.active + drafts.rejected + drafts.other
  if (total === 0) return '没有挂到这份方案待办上的广告草稿。客户名下别的广告没有算进来。'
  return `挂到这份方案待办上的广告草稿：等你点头 ${drafts.waiting} 条，状态是已在投 ${drafts.active} 条，你否过 ${drafts.rejected} 条，其他 ${drafts.other} 条。系统没有新开，也没有花钱。`
}

function metricSentence(facts: PrescriptionCheckFacts): string {
  const bits: string[] = []
  const metric = facts.metric
  if (metric && metric.current != null && metric.baseline != null) {
    const direction = metric.direction === 'decrease' ? '这个数要往下降' : '这个数要往上升'
    const target = metric.target != null ? `，要到的是 ${formatNum(metric.target)}` : ''
    const fetched = formatCnDate(metric.fetchedOn)
    const when = fetched ? `，数字记在 ${fetched}` : ''
    bits.push(`目标「${metric.label}」现在是 ${formatNum(metric.current)}，开始时是 ${formatNum(metric.baseline)}${target}（${direction}${when}）。`)
  } else if (metric) {
    bits.push(`目标「${metric.label}」还没有可以对照的当前数字，这周不判断效果好不好。`)
  } else if (!facts.goalLinked) {
    bits.push('没有目标数字可以对。')
  } else {
    bits.push('这个目标的数字这周没读出来，不把没读到当成变好或变差。')
  }
  const measured = facts.measuredKpis.filter((row) => row.actual != null).slice(0, 3)
  if (measured.length > 0) {
    const list = measured.map((row) => {
      const unit = row.unit ? row.unit : ''
      const target = row.target != null ? `，当时要到的是 ${formatNum(row.target)}` : ''
      return `${row.metric} 实测 ${formatNum(row.actual as number)}${unit}${target}`
    }).join('；')
    bits.push(`已经记下的实测：${list}。`)
  }
  bits.push('上面的数字只说明现在这样，不能当成这份方案造成的。')
  return bits.join('')
}

function suggestionSentences(facts: PrescriptionCheckFacts): string[] {
  const lines: string[] = []
  if (facts.workOrders && facts.workOrders.stuck > 0) {
    lines.push(`这个目标下有 ${facts.workOrders.stuck} 张内容工单卡住了。建议你去工单里看原因。系统不会自动重做，也不会发布。`)
  }
  if (facts.adDrafts.waiting > 0) {
    lines.push(`有 ${facts.adDrafts.waiting} 条广告草稿还在等你点头。系统不会自己打开，也不会花钱。`)
  }
  const liveCards = liveCardCount(facts.prescriptionActions)
  if (facts.goalLinked && facts.initiativesKnown && facts.initiativeCount === 0 && liveCards === 0) {
    lines.push('这份方案已经批准，但目标下还没有阶段，看板上也没有它的待办。建议你打开方案看阶段有没有挂上。系统不会自己补阶段，也不会自动批准一份新的。')
  } else if (facts.initiativesKnown && facts.initiativeCount > 0 && liveCards === 0) {
    lines.push('阶段还在目标下面。建议你看这些阶段这周要不要继续，或者要不要改方案。系统不会自己改，也不会自动批准一份新的。')
  } else if (facts.prescriptionActions.pending > 0 && facts.prescriptionActions.completed === 0 && facts.prescriptionActions.inProgress === 0) {
    lines.push('看板上跟这份方案有关的待办都还没开始。建议你决定这周先做哪几件，或者要不要改方案。系统不会自己改。')
  } else if (facts.prescriptionActions.completed > 0 || facts.prescriptionActions.inProgress > 0) {
    lines.push('建议你对照目标上的数字，看这周做完的事有没有对上。对不上就先别加大。系统只留下这条建议，不会改方案，也不会动广告。')
  }
  const hasMeasured = facts.measuredKpis.some((row) => row.actual != null)
  if ((!facts.metric || facts.metric.current == null) && !hasMeasured) {
    lines.push('目标上还没有当前数字，这周不能判断效果。建议先把数字接上。系统不会自己编一个数。')
  }
  if (lines.length === 0) {
    lines.push('这周没有要自动改的地方。建议你看完上面的进度再决定要不要调。系统不会自己改方案，也不会新开一份。')
  }
  return lines
}

function liveCardCount(actions: ActionCounts): number {
  return actions.completed + actions.inProgress + actions.pending + actions.skipped + actions.other
}

function formatNum(value: number): string {
  return String(value)
}
