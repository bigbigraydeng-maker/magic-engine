/**
 * 三代理复盘引擎 — agent（P8.10.S6）
 *
 * runProjectReview(supabase, clientId)
 *   1. 加载项目全快照：原诊断 + 已批准处方（含 KPI）+ 全部执行项 + 工作日志
 *   2. 调 Claude 产出结构化复盘报告（JSON）
 *   3. 持久化进 project_reviews，返回报告
 *
 * S6.1 MVP：不重跑张骞，站在三代理视角对现状复盘。快、便宜、可随时跑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import type {
  ExecutionItem, ExecutionLog, DiagnosticDimension,
  PrescriptionContent, KPITarget,
} from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import {
  REVIEW_SYSTEM_PROMPT, buildReviewUserMessage, type ReviewContext,
} from './prompts'
import type { ProjectReviewContent, ProjectReviewMeta } from './types'

const MAX_RECENT_LOGS = 25
const MAX_OUTPUT_TOKENS = 4096

interface PrescriptionRow {
  id: string
  status: string
  discovery_id: string | null
  supplements_id: string | null
  supersedes_id: string | null
  content: PrescriptionContent | null
  created_at: string
}

function prescriptionLabel(p: PrescriptionRow): string {
  if (p.supersedes_id) return '修订版'
  if (p.supplements_id) return '补充处方'
  return '原处方'
}

export interface RunProjectReviewResult {
  content: ProjectReviewContent
  summary: string
  meta: ProjectReviewMeta
}

/**
 * 加载复盘所需的项目快照。
 */
async function loadReviewContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ctx: ReviewContext; snapshot: ProjectReviewMeta['snapshot'] } | null> {
  // 1. 全部处方
  const { data: prescRows } = await supabase
    .from('prescriptions')
    .select('id, status, discovery_id, supplements_id, supersedes_id, content, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })

  const prescriptions = (prescRows ?? []) as PrescriptionRow[]
  if (prescriptions.length === 0) return null

  // 已批准处方（带 content）喂给复盘
  const approved = prescriptions.filter(p => p.status === 'approved' && p.content)
  const reviewPrescriptions = approved.map(p => ({
    label:      prescriptionLabel(p),
    summary:    p.content?.summary ?? '（无摘要）',
    kpiTargets: (p.content?.kpi_targets ?? []) as KPITarget[],
  }))

  // 2. 客户背景 + 原诊断（取最近一份带 discovery_id 的处方）
  let businessName: string | null = null
  let industry: string | null = null
  let crisisType: string | null = null
  let originalSummary: string | null = null
  let originalKeyFinding: string | null = null
  const discoveryId = [...prescriptions].reverse().find(p => p.discovery_id)?.discovery_id ?? null
  if (discoveryId) {
    const { data: disc } = await supabase
      .from('client_discovery')
      .select('payload')
      .eq('id', discoveryId)
      .single<{ payload: DiscoveryReport }>()
    if (disc?.payload) {
      businessName = disc.payload.business?.name ?? null
      industry = disc.payload.business?.industry?.join(' / ') ?? null
      crisisType = disc.payload.diagnosis?.crisis_type ?? null
      originalSummary = disc.payload.diagnosis?.executive_summary ?? null
      originalKeyFinding = disc.payload.diagnosis?.key_finding ?? null
    }
  }

  // 3. 最近一次诊断分数
  let overallScore: number | null = null
  let dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null = null
  {
    const { data: run } = await supabase
      .from('diagnostic_runs')
      .select('overall_score, dimension_scores')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        overall_score: number | null
        dimension_scores: Partial<Record<DiagnosticDimension, number | null>> | null
      }>()
    if (run) {
      overallScore = run.overall_score
      dimensionScores = run.dimension_scores
    }
  }

  // 4. 全部执行项
  const { data: itemRows } = await supabase
    .from('execution_items')
    .select('*')
    .eq('client_id', clientId)
    .order('phase', { ascending: true })
    .order('sort_order', { ascending: true })

  const itemList = (itemRows ?? []) as ExecutionItem[]
  const items = itemList.map(it => ({
    title:     it.title,
    phase:     it.phase,
    dimension: it.dimension,
    status:    it.status,
  }))

  // 5. 跨执行项的工作日志
  const itemTitleMap = new Map(itemList.map(it => [it.id, it.title]))
  const { data: logRows } = await supabase
    .from('execution_logs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(MAX_RECENT_LOGS)

  const recentLogs = ((logRows ?? []) as ExecutionLog[])
    .map(l => ({
      itemTitle: itemTitleMap.get(l.execution_item_id) ?? '（已删除的执行项）',
      author:    l.author as string,
      kind:      l.kind as string,
      content:   l.content,
    }))
    .reverse()

  // 6. 项目启动天数
  let projectAgeDays: number | null = null
  const earliest = new Date(prescriptions[0].created_at).getTime()
  projectAgeDays = Math.max(0, Math.round((Date.now() - earliest) / 86_400_000))

  const ctx: ReviewContext = {
    businessName, industry, crisisType,
    originalSummary, originalKeyFinding,
    overallScore, dimensionScores,
    prescriptions: reviewPrescriptions,
    items, recentLogs, projectAgeDays,
  }

  const snapshot: ProjectReviewMeta['snapshot'] = {
    prescription_count:   prescriptions.length,
    execution_item_count: itemList.length,
    completed_count:      itemList.filter(i => i.status === 'completed').length,
    project_age_days:     projectAgeDays,
  }

  return { ctx, snapshot }
}

/**
 * 跑一次项目复盘。
 * productionPackageId — 可选，链接到 reputation 维度的 production package（P13.D）。
 */
export async function runProjectReview(
  supabase: SupabaseClient,
  clientId: string,
  productionPackageId?: string,
): Promise<RunProjectReviewResult> {
  const loaded = await loadReviewContext(supabase, clientId)
  if (!loaded) {
    throw new Error('该项目还没有处方，无法复盘 — 请先生成并批准一份处方。')
  }
  const { ctx, snapshot } = loaded

  const userMessage = buildReviewUserMessage(ctx)
  const result = await callClaudeChat({
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  let content: ProjectReviewContent
  try {
    content = parseJsonResponse<ProjectReviewContent>(result.text)
  } catch (err) {
    throw new Error(
      `复盘报告解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const meta: ProjectReviewMeta = {
    input_tokens:  result.input_tokens,
    output_tokens: result.output_tokens,
    cost_usd:      result.cost_usd,
    snapshot,
  }
  const summary = content.overall_assessment ?? ''

  // 持久化（写失败仍返回报告，但记日志）
  const insertRow: Record<string, unknown> = {
    client_id: clientId,
    status:    'completed',
    summary,
    content,
    meta,
  }
  if (productionPackageId) {
    insertRow.production_package_id = productionPackageId
  }
  const { error } = await supabase
    .from('project_reviews')
    .insert(insertRow)
  if (error) {
    console.error('[review] persist failed:', error)
  }

  return { content, summary, meta }
}
