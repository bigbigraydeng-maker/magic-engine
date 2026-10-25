/**
 * 某个目标下最新一版处方的只读视图。
 * 推广计划页和作战地图共用这一读法：任何状态都算（含草稿），版本号最大的那一版；
 * 同版本再比写入时间。不写库、不批准。币种只取处方指标单位或目标上已有的币种。
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface GoalPrescriptionAction {
  id: string
  title: string
  description: string
  /** fix_type 为 fde_manual，或 module 为 manual。 */
  manual: boolean
}

export interface GoalPrescriptionPhase {
  phase_number: number | null
  name: string
  duration_weeks: number | null
  actions: GoalPrescriptionAction[]
}

export interface GoalPrescriptionKpi {
  metric: string
  current_value: number | null
  target_value: number | null
  unit: string
  timeframe: string | null
}

export interface GoalPrescriptionView {
  id: string
  goal_id: string
  status: string
  status_label: string
  version: number
  /** 开方人（prescriptions.agent_name）。空着就是 null，不拿别的名字填。 */
  prescriber: string | null
  summary: string
  phases: GoalPrescriptionPhase[]
  kpis: GoalPrescriptionKpi[]
  manual_action_count: number
  /** 作战地图那一行。 */
  line: string
  /** 处方指标单位或目标币种。两边都没有就是 null。 */
  currency: string | null
}

export interface GoalPrescriptionRow {
  id?: unknown
  goal_id?: unknown
  status?: unknown
  version?: unknown
  agent_name?: unknown
  content?: unknown
  created_at?: unknown
}

const CURRENCY = /^[A-Za-z]{3}$/

export function prescriptionStatusLabel(status: string): string {
  switch (status) {
    case 'draft': return '草稿'
    case 'approved': return '已批准'
    case 'rejected': return '已拒绝'
    case 'superseded': return '已被替代'
    case 'generating': return '生成中'
    case 'failed': return '生成失败'
    default: return status
  }
}

export function formatPrescriptionLine(version: number, statusLabel: string, manualCount: number): string {
  return `处方 v${version} · ${statusLabel} · ${manualCount} 条人工动作`
}

export function isManualPrescriptionAction(action: { fix_type?: unknown; module?: unknown }): boolean {
  return action.fix_type === 'fde_manual' || action.module === 'manual'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readActions(raw: unknown): GoalPrescriptionAction[] {
  if (!Array.isArray(raw)) return []
  const out: GoalPrescriptionAction[] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const title = readText(row.title).trim()
    if (title === '') continue
    out.push({
      id: readText(row.id).trim() || title,
      title,
      description: readText(row.description),
      manual: isManualPrescriptionAction(row),
    })
  }
  return out
}

function readPhases(raw: unknown): GoalPrescriptionPhase[] {
  if (!Array.isArray(raw)) return []
  const out: GoalPrescriptionPhase[] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const actions = readActions(row.actions)
    const name = readText(row.name).trim()
    if (name === '' && actions.length === 0) continue
    out.push({
      phase_number: readNumber(row.phase_number),
      name,
      duration_weeks: readNumber(row.duration_weeks),
      actions,
    })
  }
  return out
}

function readKpis(raw: unknown): GoalPrescriptionKpi[] {
  if (!Array.isArray(raw)) return []
  const out: GoalPrescriptionKpi[] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const metric = readText(row.metric).trim()
    if (metric === '') continue
    const timeframe = readText(row.timeframe).trim()
    out.push({
      metric,
      current_value: readNumber(row.current_value),
      target_value: readNumber(row.target_value),
      unit: readText(row.unit).trim(),
      timeframe: timeframe === '' ? null : timeframe,
    })
  }
  return out
}

/** 指标单位恰好是三位字母时用它，否则用目标上的币种。都没有就 null。 */
export function currencyFromPrescription(kpis: readonly { unit: string }[], goalCurrency: string | null): string | null {
  for (const kpi of kpis) {
    if (CURRENCY.test(kpi.unit)) return kpi.unit.toUpperCase()
  }
  const goal = goalCurrency?.trim() ?? ''
  return CURRENCY.test(goal) ? goal.toUpperCase() : null
}

export function toGoalPrescriptionView(
  row: GoalPrescriptionRow,
  goalId: string,
  goalCurrency: string | null,
): GoalPrescriptionView | null {
  const id = readText(row.id).trim()
  const status = readText(row.status).trim()
  const version = readNumber(row.version)
  if (id === '' || status === '' || version === null) return null
  const content = asRecord(row.content)
  const phases = readPhases(content?.phases)
  const kpis = readKpis(content?.kpi_targets)
  const manual = phases.reduce((sum, phase) => sum + phase.actions.filter(action => action.manual).length, 0)
  const prescriber = readText(row.agent_name).trim()
  const statusLabel = prescriptionStatusLabel(status)
  return {
    id,
    goal_id: readText(row.goal_id).trim() || goalId,
    status,
    status_label: statusLabel,
    version,
    prescriber: prescriber === '' ? null : prescriber,
    summary: readText(content?.summary),
    phases,
    kpis,
    manual_action_count: manual,
    line: formatPrescriptionLine(version, statusLabel, manual),
    currency: currencyFromPrescription(kpis, goalCurrency),
  }
}

async function readGoalBudgetCurrency(clientId: string, goalId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('budget_currency')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const value = (data as { budget_currency?: unknown }).budget_currency
  return typeof value === 'string' ? value : null
}

/**
 * 该客户、该目标下版本最新的一份处方。不按状态过滤（草稿、已批准、已拒绝都算）。
 * 读库失败抛错。推广计划页和作战地图都在调用处接住，只把这一项留空。
 * 没有这一行返回 null，不当成一份空处方。
 */
export async function loadLatestGoalPrescription(clientId: string, goalId: string): Promise<GoalPrescriptionView | null> {
  if (goalId.trim() === '') return null
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('id, goal_id, status, version, agent_name, content, created_at')
    .eq('client_id', clientId)
    .eq('goal_id', goalId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`读处方失败：${error.message}`)
  if (!data) return null
  return toGoalPrescriptionView(data as GoalPrescriptionRow, goalId, await readGoalBudgetCurrency(clientId, goalId))
}
