/**
 * 项目级鲁班 — 对话代理（P8.10.S5.3）
 *
 * chatWithProjectLuban(supabase, clientId, userMessage)
 *   1. 加载项目全局上下文：所有处方 + 所有执行项 + 诊断分数 + 跨项目工作日志
 *   2. 加载项目级对话历史（luban_project_messages）
 *   3. 拼 system prompt + history + 新消息，调 Claude（非流式）
 *   4. 持久化用户消息 + 鲁班回复
 *
 * 与 agent.ts（单执行项级）区别：上下文是整个 client，不绑定某个 execution_item，
 * 也不开放工具（项目级对话是「分析 + 建议」，不直接动数据）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { callClaudeWithTools } from '@/lib/anthropic/client'
import { buildProjectLubanTools } from './project-tools'
import type {
  ExecutionItem, ExecutionLog, DiagnosticDimension,
} from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import {
  buildProjectLubanSystemPrompt,
  type ProjectLubanContext, type ProjectItemLite, type ProjectLogLite,
} from './project-prompts'
import { loadMemoryForClient } from '@/lib/memory'
import type { MemoryContext } from '@/lib/memory/types'

export interface ProjectLubanChatResult {
  reply: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

const MAX_HISTORY_MESSAGES = 20
const MAX_RECENT_LOGS = 20

interface PrescriptionRow {
  id: string
  status: string
  discovery_id: string | null
  supplements_id: string | null
  supersedes_id: string | null
  created_at: string
}

/** 处方 id → 人类可读标签（原处方 / 补充处方 / 修订版 / 已归档） */
function prescriptionLabel(p: PrescriptionRow): string {
  if (p.status === 'superseded') return '已归档'
  if (p.supersedes_id) return '修订版'
  if (p.supplements_id) return '补充处方'
  return '原处方'
}

/**
 * 加载项目级鲁班所需的全部上下文。
 */
async function loadProjectContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ProjectLubanContext | null> {
  // 1. 全部处方
  const { data: prescRows } = await supabase
    .from('prescriptions')
    .select('id, status, discovery_id, supplements_id, supersedes_id, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })

  const prescriptions = (prescRows ?? []) as PrescriptionRow[]
  const prescLabelMap = new Map(prescriptions.map(p => [p.id, prescriptionLabel(p)]))
  const approvedCount = prescriptions.filter(p => p.status === 'approved').length

  // 2. 客户背景（取最近一份处方的 discovery_id）
  let businessName: string | null = null
  let industry: string | null = null
  let crisisType: string | null = null
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

  // Filter out system-archived (`superseded`) items so Luban's prompt only sees
  // live FDE-actionable work. DAPE W5 marks old zhuge rows superseded when
  // recommendations are regenerated; they shouldn't influence Luban's plan.
  const items: ProjectItemLite[] = ((itemRows ?? []) as ExecutionItem[])
    .filter(it => it.status !== 'superseded')
    .map(it => ({
      title:             it.title,
      phase:             it.phase,
      dimension:         it.dimension,
      status:            it.status as ProjectItemLite['status'],
      prescriptionLabel: (it.prescription_id ? prescLabelMap.get(it.prescription_id) : null) ?? '处方',
    }))

  // 5. 最近的工作日志（跨所有执行项）
  const itemTitleMap = new Map(
    ((itemRows ?? []) as ExecutionItem[]).map(it => [it.id, it.title]),
  )
  const { data: logRows } = await supabase
    .from('execution_logs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(MAX_RECENT_LOGS)

  const recentLogs: ProjectLogLite[] = ((logRows ?? []) as ExecutionLog[])
    .map(l => ({
      itemTitle: itemTitleMap.get(l.execution_item_id) ?? '（已删除的执行项）',
      author:    l.author,
      kind:      l.kind,
      content:   l.content,
      createdAt: l.created_at,
    }))
    .reverse()   // 时间正序，读起来顺

  // 6. 项目启动至今天数（最早处方 created_at）
  let projectAgeDays: number | null = null
  if (prescriptions.length > 0) {
    const earliest = new Date(prescriptions[0].created_at).getTime()
    projectAgeDays = Math.max(0, Math.round((Date.now() - earliest) / 86_400_000))
  }

  // 7. Phase 23.D.2 — L3 记忆层（非阻塞）
  const memoryContext: MemoryContext = await loadMemoryForClient(supabase, clientId, {
    maxRecentDecisions: 5,
  })

  return {
    businessName,
    industry,
    crisisType,
    overallScore,
    dimensionScores,
    prescriptionCount: prescriptions.length,
    approvedPrescriptionCount: approvedCount,
    items,
    recentLogs,
    projectAgeDays,
    memoryContext,
  }
}

/**
 * 项目级鲁班对话主入口。
 */
export async function chatWithProjectLuban(
  supabase: SupabaseClient,
  clientId: string,
  userMessage: string,
): Promise<ProjectLubanChatResult> {
  const trimmed = userMessage.trim()
  if (!trimmed) throw new Error('消息不能为空')

  const ctx = await loadProjectContext(supabase, clientId)
  if (!ctx) throw new Error('项目不存在或无权访问')

  // 对话历史
  const { data: historyRows } = await supabase
    .from('luban_project_messages')
    .select('role, content')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY_MESSAGES)

  const history = (historyRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>

  const systemPrompt = buildProjectLubanSystemPrompt(ctx)
  const { tools, handlers } = buildProjectLubanTools({ supabase, clientId })
  const result = await callClaudeWithTools({
    systemPrompt,
    messages: [...history, { role: 'user', content: trimmed }],
    tools,
    toolHandlers: handlers,
    maxOutputTokens: 2048,
  })

  // 持久化（写失败不阻塞）
  await supabase
    .from('luban_project_messages')
    .insert([
      { client_id: clientId, role: 'user', content: trimmed, meta: null },
      {
        client_id: clientId,
        role: 'assistant',
        content: result.text,
        meta: {
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd,
        },
      },
    ])
    .then(({ error }) => {
      if (error) console.error('[project-luban] message persist failed:', error)
    })

  return {
    reply: result.text,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cost_usd: result.cost_usd,
  }
}
