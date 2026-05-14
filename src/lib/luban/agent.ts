/**
 * 鲁班 Lǔ Bān — 对话代理（P8.10.S4.2）
 *
 * chatWithLuban(supabase, itemId, clientId, userMessage)
 *   1. 加载执行项 + 父处方 + 客户背景 + 已有工作日志
 *   2. 加载对话历史
 *   3. 拼 system prompt + history + 新消息，调 Claude（非流式 — 回复短，5-15s）
 *   4. 持久化用户消息 + 鲁班回复到 luban_messages
 *   5. 返回回复文本 + token/cost
 *
 * 非流式：聊天回复通常 200-800 tokens，远小于华佗处方的 8192，
 * 用 callClaudeChat 一次返回足够快且稳定。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { callClaudeWithTools, type ClaudeToolCall } from '@/lib/anthropic/client'
import type { ExecutionItem, ExecutionLog, PrescriptionContent } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import { buildLubanSystemPrompt, type LubanContext } from './prompts'
import { buildLubanTools } from './tools'

export interface LubanChatResult {
  reply: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  /** 本轮鲁班调用的工具明细（无工具调用时为空数组） */
  tool_calls: ClaudeToolCall[]
}

const MAX_HISTORY_MESSAGES = 20   // 只带最近 N 条历史，控制 token
const MAX_RECENT_LOGS = 12        // system prompt 里注入的工作日志条数

/**
 * 加载鲁班所需的全部上下文。
 */
async function loadLubanContext(
  supabase: SupabaseClient,
  itemId: string,
  clientId: string,
): Promise<LubanContext | null> {
  // 1. 执行项
  const { data: item, error: itemErr } = await supabase
    .from('execution_items')
    .select('*')
    .eq('id', itemId)
    .eq('client_id', clientId)
    .single<ExecutionItem>()

  if (itemErr || !item) return null

  // 2. 父处方（content.summary + discovery_id）
  let prescriptionSummary: string | null = null
  let discoveryId: string | null = null
  {
    const { data: presc } = await supabase
      .from('prescriptions')
      .select('content, discovery_id')
      .eq('id', item.prescription_id)
      .single<{ content: PrescriptionContent | null; discovery_id: string | null }>()
    if (presc) {
      prescriptionSummary = presc.content?.summary ?? null
      discoveryId = presc.discovery_id
    }
  }

  // 3. 客户背景（从 discovery）
  let businessName: string | null = null
  let industry: string | null = null
  let crisisType: string | null = null
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

  // 4. 该执行项最近的工作日志
  const { data: logRows } = await supabase
    .from('execution_logs')
    .select('*')
    .eq('execution_item_id', itemId)
    .order('created_at', { ascending: true })
    .limit(MAX_RECENT_LOGS)

  // 5. phase 名称
  const phaseName = item.phase === 1 ? 'Phase 1 — 即时修复'
    : item.phase === 2 ? 'Phase 2 — 结构改善'
    : item.phase === 3 ? 'Phase 3 — 长期增长'
    : `Phase ${item.phase}`

  return {
    item,
    prescriptionSummary,
    phaseName,
    businessName,
    industry,
    crisisType,
    recentLogs: (logRows ?? []) as ExecutionLog[],
  }
}

/**
 * 鲁班对话主入口。
 */
export async function chatWithLuban(
  supabase: SupabaseClient,
  itemId: string,
  clientId: string,
  userMessage: string,
): Promise<LubanChatResult> {
  const trimmed = userMessage.trim()
  if (!trimmed) throw new Error('消息不能为空')

  // 1. 加载上下文
  const ctx = await loadLubanContext(supabase, itemId, clientId)
  if (!ctx) throw new Error('执行项不存在或无权访问')

  // 2. 加载对话历史
  const { data: historyRows } = await supabase
    .from('luban_messages')
    .select('role, content')
    .eq('execution_item_id', itemId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY_MESSAGES)

  const history = (historyRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>

  // 3. 调 Claude（tool loop — 鲁班可自主调用 add_work_log 等工具）
  const systemPrompt = buildLubanSystemPrompt(ctx)
  const { tools, handlers } = buildLubanTools({ supabase, itemId, clientId, item: ctx.item })
  const result = await callClaudeWithTools({
    systemPrompt,
    messages: [...history, { role: 'user', content: trimmed }],
    tools,
    toolHandlers: handlers,
    maxOutputTokens: 2048,
  })

  // 4. 持久化用户消息 + 鲁班回复（写失败不阻塞返回）
  await supabase
    .from('luban_messages')
    .insert([
      { execution_item_id: itemId, client_id: clientId, role: 'user', content: trimmed, meta: null },
      {
        execution_item_id: itemId,
        client_id: clientId,
        role: 'assistant',
        content: result.text,
        meta: {
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd,
          tool_rounds: result.tool_rounds,
          tool_calls: result.tool_calls,
        },
      },
    ])
    .then(({ error }) => {
      if (error) console.error('[luban/chat] message persist failed:', error)
    })

  return {
    reply: result.text,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cost_usd: result.cost_usd,
    tool_calls: result.tool_calls,
  }
}
