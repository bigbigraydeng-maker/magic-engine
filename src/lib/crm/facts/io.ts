/**
 * 「读对话得出事实」的 IO 层 —— 唯一碰 supabase / OpenAI 的文件。
 *
 * 挂在**已经在跑**的 `messenger-brief-hourly` 上，不新注册 cron：新 cron 要手工
 * link 密钥的环境变量组，漏了就每天 401 静默失败（daily-cron-digest 哑了 51 天
 * 那次就是这么来的，见 stage-infer.ts 头注）。
 *
 * 默认**关着**：`CRM_FACTS_CLIENT_IDS` 没列出这个客户就一步都不走（fail closed）。
 * 先 claim 再调模型：Inngest 重试与每小时 cron 并发时，靠数据库里那一次原子
 * claim 保证同一段对话不会被两边各烧一次钱。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { FACTS_JSON_SCHEMA, FACTS_SCHEMA_VERSION, FactsSchema, type Facts } from './schema'
import { buildFactsPrompt } from './prompt'
import type { FactsMsg } from './canned'

export interface ConvRow {
  id: string
  client_id: string
  channel: string | null
  last_message_at: string | null
}

export interface FactsRow {
  conversation_id: string
  status: 'pending' | 'ready' | 'failed'
  claimed_at: string | null
  retry_after: string | null
  last_message_at: string | null
}

export interface AskResult {
  facts: Facts | null
  inputTokens: number
  outputTokens: number
}

export interface WriteInput {
  conversationId: string
  clientId: string
  facts: Facts
  lastSpeaker: 'customer' | 'us'
  lastMessageAt: string | null
  sourceMessageCount: number
  model: string
  promptVersion: string
  costUsd: number
  now: Date
}

export interface FactsIo {
  listConversations(clientIds: string[], onlyIds: string[] | null): Promise<ConvRow[]>
  listFactsRows(conversationIds: string[]): Promise<FactsRow[]>
  loadMessages(conversationId: string): Promise<FactsMsg[]>
  loadClientOutbound(clientId: string): Promise<Array<Array<string | null>>>
  businessName(clientId: string): Promise<string>
  claim(conversationId: string, clientId: string, dailyLimit: number): Promise<boolean>
  ask(model: string, business: string, transcript: string, signal: AbortSignal): Promise<AskResult>
  writeReady(w: WriteInput): Promise<boolean>
  writeFailed(conversationId: string, error: string, retryAfter: Date): Promise<void>
}

const IN_CHUNK = 100
const OUTBOUND_CHUNK = 80
const PAGE = 1000

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function listConversations(
  clientIds: string[],
  onlyIds: string[] | null,
): Promise<ConvRow[]> {
  let q = supabaseAdmin
    .from('conversations')
    .select('id, client_id, channel, last_message_at')
  if (onlyIds) {
    q = q.in('id', onlyIds)
  } else {
    q = q
      .in('client_id', clientIds)
      .in('channel', ['messenger', 'whatsapp'])
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(400)
  }
  const { data, error } = await q
  if (error) throw new Error(`读对话列表失败: ${error.message}`)
  return (data ?? []) as ConvRow[]
}

async function listFactsRows(conversationIds: string[]): Promise<FactsRow[]> {
  const out: FactsRow[] = []
  for (const ids of chunk(conversationIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('conversation_facts')
      .select('conversation_id, status, claimed_at, retry_after, last_message_at')
      .in('conversation_id', ids)
    if (error) throw new Error(`读事实缓存失败: ${error.message}`)
    out.push(...((data ?? []) as FactsRow[]))
  }
  return out
}

async function loadMessages(conversationId: string): Promise<FactsMsg[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`读往来原文失败: ${error.message}`)
  return ((data ?? []) as FactsMsg[]).filter((m) => (m.body ?? '').trim().length > 0)
}

async function clientConversationIds(clientId: string): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`读客户对话失败: ${error.message}`)
    const page = (data ?? []) as { id: string }[]
    ids.push(...page.map((r) => r.id))
    if (page.length < PAGE) break
  }
  return ids
}

async function loadClientOutbound(clientId: string): Promise<Array<Array<string | null>>> {
  const convIds = await clientConversationIds(clientId)
  const byConv = new Map<string, Array<string | null>>()
  for (const ids of chunk(convIds, OUTBOUND_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .select('conversation_id, body')
      .eq('direction', 'outbound')
      .in('conversation_id', ids)
      .limit(5000)
    if (error) throw new Error(`读客户出站失败: ${error.message}`)
    for (const m of (data ?? []) as { conversation_id: string; body: string | null }[]) {
      const arr = byConv.get(m.conversation_id) ?? []
      arr.push(m.body)
      byConv.set(m.conversation_id, arr)
    }
  }
  return Array.from(byConv.values())
}

async function businessName(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .maybeSingle()
  const name = (data as { name?: string | null } | null)?.name
  return name && name.trim().length > 0 ? name : 'the business'
}

async function claim(
  conversationId: string,
  clientId: string,
  dailyLimit: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('claim_conversation_facts', {
    p_conversation_id: conversationId,
    p_client_id: clientId,
    p_daily_limit: dailyLimit,
  })
  if (error) throw new Error(`claim 失败: ${error.message}`)
  return data === true
}

async function ask(
  model: string,
  business: string,
  transcript: string,
  signal: AbortSignal,
): Promise<AskResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY 未配置')

  // 走统一封装（而不是自己 new）—— 账户级失效（余额耗尽 / 钥匙失效）的识别与
  // 落库都装在那一层，是全站唯一能一次盖住所有调用点的位置。bypassGateway：
  // 这条链路用的是 responses API，从没经过 CF 网关验证过，只拿拦截、不换路由。
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })
  const res = await client.responses.create(
    {
      model,
      temperature: 0,
      input: [
        { role: 'system', content: buildFactsPrompt(business) },
        { role: 'user', content: `Conversation:\n${transcript}` },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'conversation_facts',
          schema: FACTS_JSON_SCHEMA,
        },
      },
    } as Parameters<typeof client.responses.create>[0],
    { signal },
  )

  const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0

  const text = (res as { output_text?: string }).output_text ?? '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { facts: null, inputTokens, outputTokens }
  }
  const result = FactsSchema.safeParse(parsed)
  return { facts: result.success ? result.data : null, inputTokens, outputTokens }
}

async function writeReady(w: WriteInput): Promise<boolean> {
  const f = w.facts
  const { data, error } = await supabaseAdmin
    .from('conversation_facts')
    .update({
      status: 'ready',
      claimed_at: null,
      retry_after: null,
      error: null,
      schema_version: FACTS_SCHEMA_VERSION,
      prompt_version: w.promptVersion,
      model: w.model,
      is_spam_or_unrelated: f.is_spam_or_unrelated,
      customer_gave_specifics: f.customer_gave_specifics,
      we_gave_price: f.we_gave_price,
      next_step_arranged: f.next_step_arranged,
      ordered_or_paid: f.ordered_or_paid,
      we_declined: f.we_declined,
      customer_said_not_now: f.customer_said_not_now,
      last_speaker: w.lastSpeaker,
      last_message_at: w.lastMessageAt,
      source_message_count: w.sourceMessageCount,
      evidence: {
        decline_quote: f.decline_quote,
        customer_quote: f.customer_quote,
        our_quote: f.our_quote,
        progression: f.progression,
        reason: f.reason,
      },
      cost_usd: w.costUsd,
      generated_at: w.now.toISOString(),
    })
    .eq('conversation_id', w.conversationId)
    .eq('status', 'pending')
    .select('conversation_id')
  if (error) throw new Error(`写事实失败: ${error.message}`)
  return (data ?? []).length > 0
}

async function writeFailed(
  conversationId: string,
  error: string,
  retryAfter: Date,
): Promise<void> {
  const { error: e } = await supabaseAdmin
    .from('conversation_facts')
    .update({
      status: 'failed',
      error: error.slice(0, 200),
      retry_after: retryAfter.toISOString(),
      claimed_at: null,
    })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
  if (e) throw new Error(`写失败状态失败: ${e.message}`)
}

export function supabaseFactsIo(): FactsIo {
  return {
    listConversations,
    listFactsRows,
    loadMessages,
    loadClientOutbound,
    businessName,
    claim,
    ask,
    writeReady,
    writeFailed,
  }
}
