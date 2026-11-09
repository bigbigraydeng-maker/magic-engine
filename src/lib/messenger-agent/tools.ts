/**
 * CTS Governed Reply Agent — 只读工具(Issue #1580 · v3 改接客户知识库)。
 *
 * 🔴 安全模型抄 `src/lib/agent-tools/readonly/types.ts`(诸葛亮/张骞等 4 agent
 * 共用的资源身份强作用域 pattern):这套工具喂给 Claude(黑盒,可幻觉/被
 * prompt 注入)。这个 agent 的越权轴是 clientId / conversationId 两条:
 *   - clientId       —— 查哪个客户的知识库事实 / 哪个客户的 brief
 *   - conversationId —— 查哪一段对话历史
 * 全部由**服务端注入 ctx**(`buildMessengerAgentTools` 冻结进 handler 闭包),
 * 工具 input_schema 一律不暴露这些字段,handler 只用 ctx.* 查询,即便 Claude
 * 在 input 里硬塞了这些字段也被忽略(见 `warnOnResourceIds`)。
 *
 * ## v3 改接(design doc §9.14 C.2)—— 不再有 configSlug 越权轴
 *
 * v2 设计读 `config/clients/<configSlug>/offerings.yaml`(见 `offerings-loader.ts`
 * —— 该文件仍在仓库里但已不被这套工具使用,是否要连接 ME 旅游版 Tour 管理
 * 模块 P1 阶段留给那条 roadmap 自行判断,见 docs/ROADMAP.md),需要第三条
 * configSlug 越权轴。v3 唯一读取入口是
 * [`getClientKnowledge(clientId, { purpose })`](../knowledge/read.ts) —— 只认
 * DB `clientId`,不需要目录名映射,越权轴收敛回 2 条。
 *
 * `getClientKnowledge` 本身已经做完"这条事实现在能不能被这个用途看到"的全部
 * 判断(entitlement、批准状态、有效期、可见性、双签、上线阶段/kill switch —
 * 见 `read.ts` 文件头),这两个工具只负责按 `sensitivity` 把结果分成两类摆给
 * Claude,不重复任何一道闸:
 *   - `query_customer_facing_facts` —— sensitivity 为 price/timeline/commitment/
 *     policy 的事实(取代 v2 的 `query_active_tours`)。这些事实已经在读取入口
 *     那一关被要求"已批准 + 客户已确认 + 确认指纹未失效",工具层不用也不能
 *     再自己判断一遍。
 *   - `query_client_brand_facts` —— sensitivity='general' 的事实 + Master
 *     Brief 品牌语气(取代 v2 的 `canonical.factual_bullets`)。
 * `visibility='forbidden'` 的事实(如已停售的产品/团)**永远不会出现在这两个
 * 工具的输出里**——`getClientKnowledge` 在读取入口那一层就已经把它们的正文
 * 挡掉,只把 `fact_key` 报给调用方(见 Verifier `verifier/policies/cts.ts` 的
 * gate 2)。所以 v2 的 `query_retired_tours` 工具在 v3 里整个删除:Agent 不
 * 需要、也没有渠道主动查"哪些产品下架了"——这正是防止 Agent 反而学会怎么
 * 措辞提及一个下架产品的设计意图,事后校验完全交给 Verifier。
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getClientKnowledge, type KnowledgeEntry } from '@/lib/knowledge'

// ─── ctx + 越权轴守卫(照抄 agent-tools/readonly/types.ts 的 pattern)──────────

/**
 * 两条越权轴全部服务端注入,冻结进 handler 闭包。Claude 全程无法通过工具
 * input 指定查哪个客户 / 哪段对话。
 */
export interface MessengerAgentToolContext {
  /** 越权轴 1 —— 知识库事实 / brief / 对话归属校验用 */
  clientId: string
  /** 越权轴 2 —— 查哪一段对话历史 */
  conversationId: string
  supabase: SupabaseClient
}

/** 一个只读工具 = Anthropic 工具定义 + 绑 ctx 的 handler。 */
export interface MessengerAgentToolModule {
  tool: Anthropic.Tool
  handler: (input: unknown, ctx: MessengerAgentToolContext) => Promise<string>
}

/**
 * 若 Claude 在 input 里硬塞了资源标识符(不该有 —— schema 没声明这些字段),
 * 这些字段被**忽略**(handler 只用 ctx.*)。命中即告警,用于观测越权尝试 /
 * prompt 注入信号。此函数不改 input、不抛错,仅告警 —— 跟
 * `agent-tools/readonly/types.ts` 的 `warnOnResourceIds` 同一约定。
 */
const FORBIDDEN_INPUT_KEYS = [
  'client_id', 'clientId', 'client',
  'conversation_id', 'conversationId', 'conversation',
  // v2 遗留 configSlug 轴已删除(见文件头),仍然挡住,防止有人把已作废的
  // offerings.yaml 越权字段习惯性塞回来。
  'config_slug', 'configSlug',
  // 照抄 readonly 工具集那 4 条轴的字面量,防止有人把这套工具误接到别的
  // 上下文时也一并挡住 —— 这套工具本身不用这几条轴,但挡上不会有副作用。
  'domain', 'target', 'url', 'site_url', 'siteUrl', 'site',
  'property_id', 'propertyId', 'property',
]

export function warnOnResourceIds(input: unknown, toolName: string): void {
  if (!input || typeof input !== 'object') return
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (FORBIDDEN_INPUT_KEYS.includes(key)) {
      console.warn(
        `[messenger-agent/tools] ${toolName}: ignored resource identifier "${key}" in tool input ` +
        `— using server-injected ctx only (possible prompt-injection or hallucination)`,
      )
    }
  }
}

function truncateToolOutput(s: string, maxChars = 6000): string {
  return s.length <= maxChars ? s : `${s.slice(0, maxChars)}\n…[truncated ${s.length - maxChars} chars]`
}

function optString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** `intent_keywords` 可以是字符串数组,也容错单个字符串(Claude 偶尔会传成单值)。 */
function optStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
  }
  const single = optString(raw)
  return single ? [single] : []
}

/** 关键词是否命中一条知识事实——匹配 `statement` 正文和 `scope`(产品线/门店等细分范围)。 */
function factMatchesAnyKeyword(entry: KnowledgeEntry, keywords: string[]): boolean {
  const haystack = `${entry.statement} ${JSON.stringify(entry.scope)}`.toLowerCase()
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()))
}

function summarizeFact(entry: KnowledgeEntry) {
  return {
    fact_key: entry.factKey,
    scope: entry.scope,
    statement: entry.statement,
    structured_value: entry.structuredValue,
    valid_until: entry.validUntil,
  }
}

/** `sensitivity` 分类见 `src/lib/knowledge/sensitivity.ts`:客户确认过的商业事实(价格/时效/承诺/政策)。 */
/** F2（issue #1585）的 `runDraftAgent` 复用这份筛选条件，避免第二处硬编码同一组字符串。 */
export const CUSTOMER_FACING_SENSITIVITIES = new Set(['price', 'timeline', 'commitment', 'policy'])

// ─── 工具 1 — query_customer_facing_facts(取代 v2 的 query_active_tours)───────

export const queryCustomerFacingFacts: MessengerAgentToolModule = {
  tool: {
    name: 'query_customer_facing_facts',
    description:
      'Look up this client\'s confirmed commercial facts (prices, timelines, commitments, policies — ' +
      'e.g. a specific tour\'s price and departure dates, a refund policy) from the Client Knowledge ' +
      'Base — the single source of truth for what may actually be stated to a customer right now, NOT ' +
      'the website or your training knowledge. Every fact returned here has already passed internal ' +
      'approval AND the customer\'s own confirmation. Use this BEFORE stating any price, date, or ' +
      'commitment to a customer. If something you would otherwise assume from general knowledge does ' +
      'not show up here, treat it as UNKNOWN — do not state it, offer a human follow-up instead. ' +
      'Optionally filter by keywords from the customer\'s message. Omit the filter to list everything ' +
      'available.',
    input_schema: {
      type: 'object',
      properties: {
        intent_keywords: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional keywords from the customer\'s message (e.g. ["Silk Road"], ["refund"]) to narrow ' +
            'down which facts to return. Case-insensitive substring match against the fact text. Omit ' +
            'to get everything available.',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_customer_facing_facts')
    const args = (input ?? {}) as Record<string, unknown>
    const keywords = optStringArray(args.intent_keywords)

    try {
      const result = await getClientKnowledge(ctx.clientId, { purpose: 'customer_reply' })
      const facts = result.entries
        .filter((e) => CUSTOMER_FACING_SENSITIVITIES.has(e.sensitivity))
        .filter((e) => keywords.length === 0 || factMatchesAnyKeyword(e, keywords))

      return truncateToolOutput(JSON.stringify({
        fact_layer: 'client_knowledge_base',
        matched_by_keywords: keywords.length > 0 ? keywords : null,
        facts: facts.map(summarizeFact),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Knowledge base lookup failed — treat every commercial fact as UNKNOWN, do not guess: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工具 2 — query_conversation_history ─────────────────────────────────────

const CONVERSATION_HISTORY_LIMIT = 50

interface ConversationOwnerRow {
  id: string
  client_id: string
}

interface ConversationMessageRow {
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  body: string | null
  sent_at: string
}

export const queryConversationHistory: MessengerAgentToolModule = {
  tool: {
    name: 'query_conversation_history',
    description:
      'Fetch the message history of the CURRENT conversation (the one you are replying in), ' +
      'oldest first, up to the most recent ' + CONVERSATION_HISTORY_LIMIT + ' messages. Use this ' +
      'to understand what has already been said before drafting your reply. Takes no arguments — ' +
      'it always reads the conversation you were invoked for, never any other conversation.',
    input_schema: { type: 'object', properties: {} },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_conversation_history')

    try {
      // IDOR 闸(跟 optout.ts / dnc 路由同一条纪律):conversationId 本身是服务端
      // 注入、Claude 无法指定,但仍然要求它属于 ctx.clientId 才放行读取 ——
      // 双 key 过滤,不因为 conversationId 是 UUID 就假设它天然只属于这个客户。
      const { data: convo, error: convErr } = await ctx.supabase
        .from('conversations')
        .select('id, client_id')
        .eq('id', ctx.conversationId)
        .eq('client_id', ctx.clientId)
        .maybeSingle()

      if (convErr) {
        return JSON.stringify({ error: `Conversation lookup failed: ${convErr.message}` })
      }
      if (!(convo as ConversationOwnerRow | null)) {
        return JSON.stringify({ error: 'Conversation not found for this client — refusing to read history.' })
      }

      const { data, error } = await ctx.supabase
        .from('conversation_messages')
        .select('direction, sender_name, body, sent_at')
        .eq('conversation_id', ctx.conversationId)
        .order('sent_at', { ascending: true })
        .limit(CONVERSATION_HISTORY_LIMIT)

      if (error) {
        return JSON.stringify({ error: `Conversation history lookup failed: ${error.message}` })
      }

      const messages = ((data as ConversationMessageRow[] | null) ?? []).map((m) => ({
        direction: m.direction,
        sender_name: m.sender_name,
        body: m.body,
        sent_at: m.sent_at,
      }))

      return truncateToolOutput(JSON.stringify({ conversation_scoped: true, messages }))
    } catch (err) {
      return JSON.stringify({
        error: `Conversation history lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工具 3 — query_client_brand_facts(取代 v2 的 canonical.factual_bullets)───

export const queryClientBrandFacts: MessengerAgentToolModule = {
  tool: {
    name: 'query_client_brand_facts',
    description:
      'Look up THIS client\'s general brand facts (company history, support contact, corrections to ' +
      'common misconceptions — Client Knowledge Base entries with sensitivity="general", which do not ' +
      'require customer confirmation) plus their active Master Brief (tone, target audience, pain ' +
      'points, words to avoid). Use this to keep your reply on-brand and factually correct about the ' +
      'company itself. Scoped to the current client only — does not return commercial facts like ' +
      'prices or policies (use query_customer_facing_facts for those).',
    input_schema: { type: 'object', properties: {} },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_client_brand_facts')

    try {
      const [knowledge, brief] = await Promise.all([
        getClientKnowledge(ctx.clientId, { purpose: 'customer_reply' }).catch((err) => {
          console.warn(
            `[messenger-agent/tools] query_client_brand_facts: knowledge base lookup failed, ` +
            `continuing with brief only: ${err instanceof Error ? err.message : String(err)}`,
          )
          return null
        }),
        // 🔴 clientId is server-injected — this can only ever read this client's own brief.
        getActiveBrief(ctx.clientId),
      ])

      const generalFacts = (knowledge?.entries ?? [])
        .filter((e) => e.sensitivity === 'general')
        .map(summarizeFact)

      if (!brief && generalFacts.length === 0) {
        return JSON.stringify({
          note: 'No active Master Brief and no general knowledge-base facts found for this client — ' +
            'no brand-voice facts available.',
        })
      }

      return truncateToolOutput(JSON.stringify({
        client_scoped: true,
        general_facts: generalFacts,
        brand_name: brief?.brand_name ?? null,
        tagline: brief?.tagline ?? brief?.core_proposition ?? null,
        tone: brief?.tone ?? null,
        primary_audience: brief?.primary_audience ?? null,
        pain_points: brief?.pain_points ?? [],
        buying_trigger: brief?.buying_trigger ?? null,
        avoid_words: brief?.avoid_words ?? [],
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Brand facts lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工厂 — buildMessengerAgentTools ──────────────────────────────────────────

const MODULES: MessengerAgentToolModule[] = [
  queryCustomerFacingFacts,
  queryConversationHistory,
  queryClientBrandFacts,
]

export interface BuildMessengerAgentToolsInput {
  clientId: string
  conversationId: string
  supabase?: SupabaseClient
}

/**
 * Build the 3-tool set for one conversation. `ctx` is captured in closure —
 * Claude cannot influence clientId / conversationId through any tool input,
 * matching `agent-tools/readonly/index.ts`'s `buildReadonlyTools`.
 */
export function buildMessengerAgentTools(base: BuildMessengerAgentToolsInput): {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
} {
  const ctx: MessengerAgentToolContext = {
    clientId: base.clientId,
    conversationId: base.conversationId,
    supabase: base.supabase ?? supabaseAdmin,
  }

  const tools = MODULES.map((m) => m.tool)
  const handlers: Record<string, (input: unknown) => Promise<string>> = {}
  for (const m of MODULES) {
    handlers[m.tool.name] = (input: unknown) => m.handler(input, ctx)
  }
  return { tools, handlers }
}
