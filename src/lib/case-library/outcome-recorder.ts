/**
 * Outcome Recorder — P8.12.S2.3
 *
 * 效果反馈闭环：
 *   - recordOutcome()            手动录入 (manual_fde) 或程序录入 (semrush_auto)
 *   - backfillSemrushKpisForPrescription()  自动拉取 SEMrush 域名指标，在
 *     30 / 60 / 90 天节点回填 prescription_outcomes
 *
 * SEMrush 可测指标（organic_keywords / organic_traffic / authority_score）
 * 由 getDomainMetrics() 提供；其余 KPI 需 FDE 手工录入。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getDomainMetrics, type DomainMetrics } from '@/lib/semrush/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordOutcomeParams {
  prescriptionId: string
  caseId: string
  clientId: string
  kpiMetric: string
  targetValue?: number | null
  actualValue?: number | null
  unit?: string | null
  dimension?: string | null
  /** ISO timestamp, defaults to now() */
  measuredAt?: string
  daysSinceApproval?: number | null
  dataSource: 'manual_fde' | 'semrush_auto'
}

export interface BackfillResult {
  prescriptionId: string
  outcomesWritten: number
  skipped: number
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** 30/60/90 天 KPI 回收节点（天数）。 */
export const KPI_CHECKPOINTS = [30, 60, 90] as const

/** 节点触发窗口：目标天数 ±7 天内均视为「在节点窗口内」。 */
const CHECKPOINT_WINDOW_DAYS = 7

/**
 * SEMrush 可自动回填的 KPI 指标定义。
 * getter 从 getDomainMetrics() 返回值中取对应字段。
 */
const SEMRUSH_KPI_MAP: Array<{
  kpiMetric: string
  unit: string
  dimension: string
  getter: (m: DomainMetrics) => number
}> = [
  {
    kpiMetric: 'organic_keywords',
    unit: 'keywords',
    dimension: 'seo',
    getter: m => m.organic_keywords,
  },
  {
    kpiMetric: 'organic_traffic',
    unit: 'visits/month',
    dimension: 'seo',
    getter: m => m.organic_traffic,
  },
  {
    kpiMetric: 'authority_score',
    unit: 'score',
    dimension: 'seo',
    getter: m => m.authority_score,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 从批准时间到现在的天数（向下取整）。 */
export function calcDaysSince(approvedAt: string): number {
  const diffMs = Date.now() - new Date(approvedAt).getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * 当前天数落在哪些节点窗口内（可能同时落在多个，极少见）。
 * 排除 already 集合中已录入的节点。
 */
export function pendingCheckpoints(days: number, already: Set<number>): number[] {
  return KPI_CHECKPOINTS.filter(
    cp =>
      days >= cp - CHECKPOINT_WINDOW_DAYS &&
      days <= cp + CHECKPOINT_WINDOW_DAYS &&
      !already.has(cp),
  )
}

// ── Core recorder ─────────────────────────────────────────────────────────────

/**
 * 向 prescription_outcomes 写入一条记录。
 * 失败时静默 console.warn，不抛异常（与 saver.ts 保持一致）。
 */
export async function recordOutcome(
  supabase: SupabaseClient,
  params: RecordOutcomeParams,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('prescription_outcomes')
      .insert({
        prescription_id:      params.prescriptionId,
        case_id:              params.caseId,
        client_id:            params.clientId,
        kpi_metric:           params.kpiMetric,
        target_value:         params.targetValue ?? null,
        actual_value:         params.actualValue ?? null,
        unit:                 params.unit ?? null,
        dimension:            params.dimension ?? null,
        measured_at:          params.measuredAt ?? new Date().toISOString(),
        days_since_approval:  params.daysSinceApproval ?? null,
        data_source:          params.dataSource,
      })
      .select()
      .single()

    if (error || !data) {
      console.warn('[outcome-recorder] insert failed:', error?.message ?? 'no data')
      return null
    }

    return (data as { id: string }).id
  } catch (err) {
    console.warn('[outcome-recorder] unexpected error:', err)
    return null
  }
}

// ── Duplicate guard ───────────────────────────────────────────────────────────

/**
 * 返回某个 prescription + kpi_metric 组合中，已录入了哪些节点（30/60/90）。
 * 判断依据：days_since_approval 在节点 ±7 天窗口内的均归属该节点。
 */
export async function fetchRecordedCheckpoints(
  supabase: SupabaseClient,
  prescriptionId: string,
  kpiMetric: string,
): Promise<Set<number>> {
  try {
    const { data } = await supabase
      .from('prescription_outcomes')
      .select('days_since_approval')
      .eq('prescription_id', prescriptionId)
      .eq('kpi_metric', kpiMetric)
      .eq('data_source', 'semrush_auto')

    if (!data) return new Set()

    const recorded = new Set<number>()
    for (const row of data as Array<{ days_since_approval: number | null }>) {
      if (row.days_since_approval == null) continue
      for (const cp of KPI_CHECKPOINTS) {
        if (Math.abs(row.days_since_approval - cp) <= CHECKPOINT_WINDOW_DAYS) {
          recorded.add(cp)
        }
      }
    }
    return recorded
  } catch {
    return new Set()
  }
}

// ── SEMrush auto-backfill for one prescription ────────────────────────────────

/**
 * 为单个处方自动回填 SEMrush 可测 KPI。
 *
 * 流程：
 * 1. 计算距批准多少天 → 确定当前在哪些节点窗口内
 * 2. 若无节点触发则直接返回 skipped=0
 * 3. 拉取 getDomainMetrics()（一次调用，3 个指标共用）
 * 4. 对每个 KPI × 每个待录节点：去重后写入 prescription_outcomes
 */
export async function backfillSemrushKpisForPrescription(
  supabase: SupabaseClient,
  prescriptionId: string,
  caseId: string,
  clientId: string,
  approvedAt: string,
  domain: string,
  semrushDb?: string,
): Promise<BackfillResult> {
  const days = calcDaysSince(approvedAt)

  // Fast-exit: not in any checkpoint window
  const checkpointsInWindow = KPI_CHECKPOINTS.filter(
    cp => days >= cp - CHECKPOINT_WINDOW_DAYS && days <= cp + CHECKPOINT_WINDOW_DAYS,
  )
  if (checkpointsInWindow.length === 0) {
    return { prescriptionId, outcomesWritten: 0, skipped: 0 }
  }

  let outcomesWritten = 0
  let skipped = 0

  try {
    const metrics = await getDomainMetrics(domain, semrushDb)

    for (const kpiDef of SEMRUSH_KPI_MAP) {
      const alreadyRecorded = await fetchRecordedCheckpoints(supabase, prescriptionId, kpiDef.kpiMetric)
      const pending = checkpointsInWindow.filter(cp => !alreadyRecorded.has(cp))

      skipped += checkpointsInWindow.length - pending.length

      for (const cp of pending) {
        const id = await recordOutcome(supabase, {
          prescriptionId,
          caseId,
          clientId,
          kpiMetric:          kpiDef.kpiMetric,
          actualValue:        kpiDef.getter(metrics),
          unit:               kpiDef.unit,
          dimension:          kpiDef.dimension,
          daysSinceApproval:  cp,
          dataSource:         'semrush_auto',
        })
        if (id) outcomesWritten++
        else skipped++
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { prescriptionId, outcomesWritten, skipped, error }
  }

  return { prescriptionId, outcomesWritten, skipped }
}
