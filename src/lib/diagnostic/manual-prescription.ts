import type {
  BudgetAllocationItem, DiagnosticDimension, KPITarget, PhaseInitiativeSeed,
  PrescriptionAction, PrescriptionContent, PrescriptionPhase,
} from '@/types/diagnostic'
import { parseAdPlays } from '@/lib/ads-strategy/plan-seed/ad-plays'

export const MANUAL_PRESCRIPTION_AGENT = '广告 Agent'
export const NO_COMPLETED_RUN_MESSAGE =
  '这个客户还没有已完成的体检，处方草稿存不进去。先完成一次体检再保存。'

const DIMENSIONS: ReadonlySet<string> = new Set<DiagnosticDimension>([
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
])
const POSTURES: ReadonlySet<string> = new Set(['offensive', 'defensive', 'fast', 'slow'])
const EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high'])
const INITIATIVE_TYPES: ReadonlySet<string> = new Set([
  'demand_generation', 'conversion_optimization', 'trust_building', 'competitive_defense',
  'market_education', 'content_asset_production', 'unassigned',
])

export type ManualParseFailure = { ok: false; status: 400 | 422; error: string }
export type ManualParseSuccess = {
  ok: true
  goalId: string
  content: PrescriptionContent
  generationMeta: Record<string, unknown>
}
export type ManualParseResult = ManualParseSuccess | ManualParseFailure
type StepResult<T> = ({ ok: true } & T) | ManualParseFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function fail(status: 400 | 422, error: string): ManualParseFailure {
  return { ok: false, status, error }
}

export function manualSource(meta: unknown): boolean {
  return isRecord(meta) && meta.source === 'manual'
}

/** A draft the weekly job must not generate over, approve, or supersede. */
export function isManualDraftRow(row: {
  status: string
  agent_name?: string | null
  generation_meta?: unknown
}): boolean {
  if (row.status !== 'draft') return false
  return row.agent_name === MANUAL_PRESCRIPTION_AGENT || manualSource(row.generation_meta)
}

export function goalIdsWithManualDraft(
  rows: Array<{
    client_id: string
    status: string
    goal_id: string | null
    agent_name?: string | null
    generation_meta?: unknown
  }>,
  clientId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.client_id === clientId && row.goal_id && isManualDraftRow(row)) ids.add(row.goal_id)
  }
  return ids
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string')
}

export function buildGenerationMeta(raw: unknown, sourceRefs: unknown): Record<string, unknown> {
  const base = isRecord(raw) ? { ...raw } : {}
  return {
    ...base,
    source: 'manual',
    prescriber: MANUAL_PRESCRIPTION_AGENT,
    execution: '人工执行',
    source_refs: stringList(sourceRefs) ?? stringList(base.source_refs) ?? [],
  }
}

function manualActionError(action: Record<string, unknown>, id: string): string | null {
  if (action.fix_type !== 'fde_manual' || action.module !== 'manual') {
    return `动作 ${id} 不是人工执行（必须 fix_type=fde_manual 且 module=manual）`
  }
  if (action.execution_target == null) return null
  if (!isRecord(action.execution_target) || action.execution_target.mode !== 'external_manual') {
    return `动作 ${id} 的执行方式不是人工（execution_target.mode 必须是 external_manual）`
  }
  return null
}

function parseAction(raw: unknown): StepResult<{ action: PrescriptionAction }> {
  if (!isRecord(raw)) return fail(422, '动作必须是对象')
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return fail(422, '有一条动作缺少 id')
  if (typeof raw.title !== 'string' || !raw.title.trim()) return fail(422, `动作 ${id} 缺少标题`)
  if (typeof raw.description !== 'string') return fail(422, `动作 ${id} 缺少说明`)
  if (!DIMENSIONS.has(String(raw.dimension))) return fail(422, `动作 ${id} 的维度不对`)
  if (typeof raw.phase !== 'number') return fail(422, `动作 ${id} 缺少阶段编号`)
  if (!EFFORTS.has(String(raw.effort)) || !EFFORTS.has(String(raw.impact))) {
    return fail(422, `动作 ${id} 的 effort / impact 只能是 low、medium、high`)
  }
  if (!Array.isArray(raw.finding_ids)) return fail(422, `动作 ${id} 的 finding_ids 必须是数组`)
  const manualError = manualActionError(raw, id)
  if (manualError) return fail(422, manualError)
  return { ok: true, action: raw as unknown as PrescriptionAction }
}

function parseSeed(raw: unknown, phaseNumber: number): StepResult<{ seed: PhaseInitiativeSeed | null }> {
  if (raw == null) return { ok: true, seed: null }
  if (!isRecord(raw)) return fail(422, `阶段 ${phaseNumber} 的 initiative_seed 必须是对象`)
  if (!INITIATIVE_TYPES.has(String(raw.initiative_type))) {
    return fail(422, `阶段 ${phaseNumber} 的 initiative_type 不在允许范围内`)
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return fail(422, `阶段 ${phaseNumber} 的派生标题不能为空`)
  }
  if (raw.posture != null && !POSTURES.has(String(raw.posture))) {
    return fail(422, `阶段 ${phaseNumber} 的 posture 只能是 offensive、defensive、fast、slow`)
  }
  if (raw.budget_percent != null && typeof raw.budget_percent !== 'number') {
    return fail(422, `阶段 ${phaseNumber} 的 budget_percent 必须是数字`)
  }
  if (raw.ad_plays != null) {
    const plays = parseAdPlays(raw.ad_plays)
    if (!plays.ok) return fail(422, `阶段 ${phaseNumber} 的广告打法有误：${plays.error}`)
    return { ok: true, seed: { ...raw, ad_plays: plays.plays } as unknown as PhaseInitiativeSeed }
  }
  if (raw.ad_plays === null) {
    const rest: Record<string, unknown> = { ...raw }
    delete rest.ad_plays
    return { ok: true, seed: rest as unknown as PhaseInitiativeSeed }
  }
  return { ok: true, seed: raw as unknown as PhaseInitiativeSeed }
}

function parsePhase(raw: unknown): StepResult<{ phase: PrescriptionPhase }> {
  if (!isRecord(raw)) return fail(422, '阶段必须是对象')
  if (typeof raw.phase_number !== 'number' || typeof raw.name !== 'string' || !raw.name.trim()) {
    return fail(422, '阶段缺少编号或名称')
  }
  if (typeof raw.duration_weeks !== 'number') return fail(422, `阶段 ${raw.phase_number} 缺少周数`)
  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    return fail(422, `阶段 ${raw.phase_number} 没有动作`)
  }
  const actions: PrescriptionAction[] = []
  for (const action of raw.actions) {
    const parsed = parseAction(action)
    if (!parsed.ok) return parsed
    actions.push(parsed.action)
  }
  const seed = parseSeed(raw.initiative_seed, raw.phase_number)
  if (!seed.ok) return seed
  const phase: PrescriptionPhase = {
    phase_number: raw.phase_number, name: raw.name, duration_weeks: raw.duration_weeks, actions,
  }
  if (seed.seed) phase.initiative_seed = seed.seed
  return { ok: true, phase }
}

function parseKpis(raw: unknown[]): StepResult<{ items: KPITarget[] }> {
  const items: KPITarget[] = []
  for (const kpi of raw) {
    if (!isRecord(kpi)) return fail(422, 'KPI 必须是对象')
    if (typeof kpi.metric !== 'string' || !kpi.metric.trim()) return fail(422, 'KPI 缺少名称')
    if (kpi.current_value != null && typeof kpi.current_value !== 'number') {
      return fail(422, `KPI「${kpi.metric}」的当前值必须是数字或空`)
    }
    if (typeof kpi.target_value !== 'number') return fail(422, `KPI「${kpi.metric}」缺少目标值`)
    if (typeof kpi.unit !== 'string') return fail(422, `KPI「${kpi.metric}」缺少单位`)
    if (!DIMENSIONS.has(String(kpi.dimension))) return fail(422, `KPI「${kpi.metric}」的维度不对`)
    items.push(kpi as unknown as KPITarget)
  }
  return { ok: true, items }
}

function parseBudgets(raw: unknown[]): StepResult<{ items: BudgetAllocationItem[] }> {
  const items: BudgetAllocationItem[] = []
  for (const item of raw) {
    if (!isRecord(item)) return fail(422, '预算分配必须是对象')
    if (!DIMENSIONS.has(String(item.dimension))) return fail(422, '预算分配的维度不对')
    if (typeof item.amount_aud !== 'number' || typeof item.percentage !== 'number') {
      return fail(422, '预算分配缺少金额或占比')
    }
    items.push(item as unknown as BudgetAllocationItem)
  }
  return { ok: true, items }
}

export function phaseBudgetPercentSum(phases: PrescriptionPhase[]): number {
  return phases.reduce((sum, phase) => {
    const pct = phase.initiative_seed?.budget_percent
    return sum + (typeof pct === 'number' ? pct : 0)
  }, 0)
}

function parseContent(raw: unknown): StepResult<{ content: PrescriptionContent }> {
  if (!isRecord(raw)) return fail(400, 'content 必填，而且必须是处方正文')
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) return fail(422, 'content.summary 不能为空')
  if (!Array.isArray(raw.phases) || raw.phases.length === 0) return fail(422, 'content.phases 至少要有一个阶段')
  if (!Array.isArray(raw.kpi_targets)) return fail(422, 'content.kpi_targets 必须是数组')
  if (!Array.isArray(raw.budget_allocation)) return fail(422, 'content.budget_allocation 必须是数组')
  const phases: PrescriptionPhase[] = []
  for (const phase of raw.phases) {
    const parsed = parsePhase(phase)
    if (!parsed.ok) return parsed
    phases.push(parsed.phase)
  }
  const budgetSum = phaseBudgetPercentSum(phases)
  if (budgetSum > 100) return fail(422, `各阶段预算占比合计 ${budgetSum}，不能超过 100`)
  const kpis = parseKpis(raw.kpi_targets)
  if (!kpis.ok) return kpis
  const budgets = parseBudgets(raw.budget_allocation)
  if (!budgets.ok) return budgets
  const content: PrescriptionContent = {
    summary: raw.summary, phases, kpi_targets: kpis.items, budget_allocation: budgets.items,
  }
  if (typeof raw.narrative === 'string') content.narrative = raw.narrative
  return { ok: true, content }
}

export function parseManualPrescriptionBody(body: unknown, clientId: string): ManualParseResult {
  if (!isRecord(body)) return fail(400, '请求体必须是 JSON 对象')
  if (typeof body.client_id === 'string' && body.client_id !== clientId) {
    return fail(422, '请求里的客户和地址里的客户不一致')
  }
  if (typeof body.goal_id !== 'string' || !body.goal_id.trim()) return fail(400, 'goal_id 必填')
  const content = parseContent(body.content)
  if (!content.ok) return content
  return {
    ok: true,
    goalId: body.goal_id.trim(),
    content: content.content,
    generationMeta: buildGenerationMeta(body.generation_meta, body.source_refs),
  }
}

/** Full payload, or a bare content object when the page URL already names the goal. */
export function parseManualPaste(raw: unknown, urlGoalId: string | null, clientId: string): ManualParseResult {
  if (!isRecord(raw)) return fail(400, '贴进来的内容不是 JSON 对象')
  if (!('content' in raw) && Array.isArray(raw.phases)) {
    return parseManualPrescriptionBody({ goal_id: urlGoalId, content: raw }, clientId)
  }
  if (urlGoalId && typeof raw.goal_id === 'string' && raw.goal_id !== urlGoalId) {
    return fail(422, '地址里的目标和 JSON 里的目标不一致')
  }
  const goalId = typeof raw.goal_id === 'string' && raw.goal_id.trim() ? raw.goal_id : urlGoalId
  return parseManualPrescriptionBody({ ...raw, goal_id: goalId }, clientId)
}
