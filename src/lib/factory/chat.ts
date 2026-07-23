// P21.J P2 — 嵌入 Magic Engine 的内容工厂对话助手(spec me-native-design v0.2)
// 审核动作层前脸②:PM 在客户页对话框说人话 → 打回(带意见)/调预算,底层调 review-apply 同一实现。
// 🔴 不给「通过/投放」工具:花钱永远只走 UI 明确按钮,对话框碰不到钱(设计红线)。
// stateless:history 由前端传入,不建新表(免 migration)。

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { callClaudeWithTools, type ClaudeToolCall } from '@/lib/anthropic/client'
import { FACTORY_PUBLISH_BUDGET_HARD_CAP_USD } from './constants'
import { applyBudgetUpdate, applyQualityReject } from './review-apply'

interface FactoryChatCtx {
  supabase: SupabaseClient
  clientId: string
  reviewer: string
}

// ── 工具定义 ──────────────────────────────────────────────────────────────────

const LIST_PENDING_TOOL: Anthropic.Tool = {
  name: 'list_pending_reviews',
  description:
    '列出该客户当前所有待审(in_review)的广告成片工单。当用户提到「第一条」「那条」「刚才那个」时,先调它拿到工单 id + 角度 + 理由,再决定对哪条操作。',
  input_schema: { type: 'object' as const, properties: {}, required: [] },
}

const REJECT_TOOL: Anthropic.Tool = {
  name: 'reject_work_order',
  description:
    '打回一条待审成片,并附上用户的意见。老工单作废,系统会照意见自动重开一条工单重做。feedback 用中文,把用户说的"哪里不对、要怎么改"如实转述(如"节奏太慢,开头改成价格反转")。',
  input_schema: {
    type: 'object' as const,
    properties: {
      work_order_id: { type: 'string', description: '要打回的工单 id(先用 list_pending_reviews 拿)' },
      feedback: { type: 'string', description: '打回意见,中文,如实转述用户要改什么' },
    },
    required: ['work_order_id', 'feedback'],
  },
}

const ADJUST_BUDGET_TOOL: Anthropic.Tool = {
  name: 'adjust_budget',
  description:
    `只调整一条待审成片的投放预算(不重做画面)。改完工单回到待审,等用户在页面上点「通过并投放」才真花钱。预算上限 $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}。`,
  input_schema: {
    type: 'object' as const,
    properties: {
      work_order_id: { type: 'string', description: '工单 id' },
      new_budget_usd: { type: 'number', description: `新投放预算(美元),0–${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}` },
    },
    required: ['work_order_id', 'new_budget_usd'],
  },
}

function buildFactoryChatTools(ctx: FactoryChatCtx): {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
} {
  const handlers: Record<string, (input: unknown) => Promise<string>> = {
    async list_pending_reviews() {
      const { data, error } = await ctx.supabase
        .from('content_work_orders')
        // 带上 output:里面的 redline_hits 是交付时服务端复扫命中的品牌红线词。不带的话
        // 对话框这边完全看不见红线,问「这条有没有问题」只能答干净的,跟 ReviewInbox 的红色
        // 提示对不上(护栏「命中不打回、标红给人看」的另一半)。
        .select('id, angle, rationale_one_liner, created_at, output')
        .eq('client_id', ctx.clientId)
        .eq('status', 'in_review')
        .order('created_at', { ascending: true })
      if (error) return `查询失败: ${error.message}`
      if (!data || data.length === 0) return '当前没有待审成片。'
      return JSON.stringify(
        data.map((w, i) => {
          const hits = (w.output as { redline_hits?: unknown } | null)?.redline_hits
          return {
            序号: i + 1,
            id: w.id,
            角度: w.angle,
            理由: w.rationale_one_liner,
            ...(Array.isArray(hits) && hits.length > 0 ? { 命中品牌红线: hits } : {}),
          }
        }),
      )
    },

    async reject_work_order(input: unknown) {
      const { work_order_id, feedback } = (input ?? {}) as { work_order_id?: string; feedback?: string }
      if (!work_order_id || !feedback?.trim()) return '缺少 work_order_id 或 feedback。'
      const r = await applyQualityReject(ctx.supabase, work_order_id, feedback.trim(), ctx.reviewer, ctx.clientId)
      if (!r.ok) return `打回失败: ${r.error}`
      return `已打回并重开一条工单(新工单 ${r.data?.reopened_work_order_id}),意见「${feedback.trim()}」已带进新单,worker 接单后会重做。`
    },

    async adjust_budget(input: unknown) {
      const { work_order_id, new_budget_usd } = (input ?? {}) as { work_order_id?: string; new_budget_usd?: number }
      if (!work_order_id) return '缺少 work_order_id。'
      const n = Number(new_budget_usd)
      if (!Number.isFinite(n) || n <= 0) return '预算必须是正数。'
      if (n > FACTORY_PUBLISH_BUDGET_HARD_CAP_USD) return `预算不能超过硬顶 $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}。`
      const r = await applyBudgetUpdate(ctx.supabase, work_order_id, n, ctx.reviewer, ctx.clientId)
      if (!r.ok) return `调预算失败: ${r.error}`
      return `已把投放预算改为 $${n},工单回到待审。请在页面上点「通过并投放」才会真花钱。`
    },
  }
  return { tools: [LIST_PENDING_TOOL, REJECT_TOOL, ADJUST_BUDGET_TOOL], handlers }
}

// ── 系统提示 ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(clientName: string): string {
  return [
    `你是 Magic Engine 内容工厂里、只服务客户「${clientName}」的审核助手。`,
    '用户是这个生意的老板兼唯一运营,不是工程师。用中文、说人话、简短。',
    '',
    '你能做的:',
    '① 用 list_pending_reviews 看有哪些成片待审;',
    '② 用 reject_work_order 按用户意见打回(老单作废+自动重开重做);',
    '③ 用 adjust_budget 调投放预算(不重做画面)。',
    '',
    `你【不能】做「通过/投放」——花钱那一下只能用户在页面上亲手点「通过并投放(上限 $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD})」按钮,你没有这个工具,也不要假装点了。`,
    '用户说「第一条/那条」时,先 list_pending_reviews 对上 id 再操作。操作完用一句人话回执:做了什么、接下来会怎样。',
  ].join('\n')
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

export interface FactoryChatResult {
  text: string
  tool_calls: ClaudeToolCall[]
  cost_usd: number
}

export async function chatWithFactory(
  supabase: SupabaseClient,
  clientId: string,
  clientName: string,
  reviewer: string,
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<FactoryChatResult> {
  const trimmed = userMessage.trim()
  if (!trimmed) throw new Error('消息不能为空')

  const { tools, handlers } = buildFactoryChatTools({ supabase, clientId, reviewer })
  const result = await callClaudeWithTools({
    systemPrompt: buildSystemPrompt(clientName),
    messages: [...history.slice(-12), { role: 'user', content: trimmed }],
    tools,
    toolHandlers: handlers,
    maxOutputTokens: 1536,
    perCallTimeoutMs: 60_000,
  })
  return { text: result.text, tool_calls: result.tool_calls, cost_usd: result.cost_usd }
}
