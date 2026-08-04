/**
 * 自动把够格的人标成「真买家」—— 判定在 qualified-buyer.ts，这里只负责取数和落库。
 *
 * 接在哪：**每小时的私信简报 cron（messenger-brief-hourly）跑完之后的第二遍**。
 *   · 规则 B 要读简报的 customer_needs，简报刚在上一步写完，用的是最新那份
 *   · 不新注册 cron —— 新 cron 要手工 link 密钥的环境变量组，漏了就每天 401 静默
 *     失败（daily-cron-digest 哑了 51 天那次就是这么来的）。挂在已经在跑的 cron
 *     上零配置、零新失败面
 *   · 第二遍**扫全量**（不只扫这一轮新写了简报的），所以昨天写的简报、今天新来的
 *     消息也一样会被捞到；不依赖「这一小时恰好重写了简报」
 *
 * 作用范围天然收口：只处理**配置里真的有 qualified 这一档**的客户。地产漏斗有
 * （20260730145441 seed 的 7 格里第 3 格），CTS 那套旅游漏斗没有 —— 所以这套
 * 自动打标结构上碰不到 CTS 的人，不需要再写一个客户白名单。
 *
 * 只升不降、绝不覆盖人工判断、审计写明是自动标的 —— 三件事的判定全在
 * decideAutoTags 里，本文件只是执行它，外加一次并发保护（见 applyDecision）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  decideAutoTags,
  AUTO_TAG_ACTOR,
  AUTO_UPGRADE_TARGET_STAGE,
  AUTO_UPGRADE_SOURCE_STAGES,
  type AutoTagDecision,
  type ContactEvidence,
  type QualifiedBuyerMessage,
} from './qualified-buyer'

/** 一轮最多看这么多段对话，防止某天数据暴涨把一次 cron 跑爆。 */
const MAX_CONVERSATIONS_PER_RUN = 500

/** PostgREST 的 .in() 一次塞太多会把 URL 撑爆，分批查。 */
const IN_CHUNK = 100

export interface AutoTagResult {
  /** 看了几个人。 */
  examined: number
  /** 判定该升级的人数。 */
  decided: number
  /** 真的写进去的人数（并发保护可能挡掉一部分）。 */
  upgraded: number
  /** 写库失败的人数。 */
  failed: number
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 哪些客户配了「真买家」这一档 —— 没配的客户本功能一步都不往下走。 */
async function loadClientsWithQualifiedStage(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('client_id')
    .eq('stage_key', AUTO_UPGRADE_TARGET_STAGE)

  if (error) throw new Error(`读阶段配置失败: ${error.message}`)
  return new Set((data ?? []).map((r) => r.client_id as string))
}

interface ConversationRow {
  id: string
  client_id: string
  contact_id: string
}

async function loadConversations(clientIds: string[]): Promise<ConversationRow[]> {
  const rows: ConversationRow[] = []
  for (const part of chunk(clientIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, client_id, contact_id')
      .in('client_id', part)
      .not('contact_id', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(MAX_CONVERSATIONS_PER_RUN)

    if (error) throw new Error(`读对话失败: ${error.message}`)
    rows.push(...((data ?? []) as ConversationRow[]))
  }
  return rows.slice(0, MAX_CONVERSATIONS_PER_RUN)
}

/**
 * 每段对话里**客户自己发的**消息。
 *
 * 查询就带上 direction='inbound' —— 出站消息一条都不取，规则一想数错都数不了
 * （见 QUALIFIED_MIN_INBOUND_MESSAGES 的注释：数法反了整条规则就反了）。
 */
async function loadInboundMessages(
  conversationIds: string[],
): Promise<Map<string, QualifiedBuyerMessage[]>> {
  const byConversation = new Map<string, QualifiedBuyerMessage[]>()

  for (const part of chunk(conversationIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .select('conversation_id, body')
      .eq('direction', 'inbound')
      .in('conversation_id', part)

    if (error) throw new Error(`读消息失败: ${error.message}`)

    for (const row of (data ?? []) as { conversation_id: string; body: string | null }[]) {
      const list = byConversation.get(row.conversation_id) ?? []
      list.push({ direction: 'inbound', body: row.body })
      byConversation.set(row.conversation_id, list)
    }
  }

  return byConversation
}

/** 每段对话简报里的 customer_needs（没有简报的对话就没有这一项）。 */
async function loadCustomerNeeds(conversationIds: string[]): Promise<Map<string, string[]>> {
  const byConversation = new Map<string, string[]>()

  for (const part of chunk(conversationIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('conversation_briefs')
      .select('conversation_id, customer_needs')
      .in('conversation_id', part)

    if (error) throw new Error(`读简报失败: ${error.message}`)

    for (const row of (data ?? []) as { conversation_id: string; customer_needs: unknown }[]) {
      const needs = Array.isArray(row.customer_needs)
        ? row.customer_needs.filter((n): n is string => typeof n === 'string')
        : []
      byConversation.set(row.conversation_id, needs)
    }
  }

  return byConversation
}

/** 这批人的当前阶段。 */
async function loadStages(contactIds: string[]): Promise<Map<string, string | null>> {
  const byContact = new Map<string, string | null>()

  for (const part of chunk(contactIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id, stage')
      .in('id', part)

    if (error) throw new Error(`读联系人失败: ${error.message}`)
    for (const row of (data ?? []) as { id: string; stage: string | null }[]) {
      byContact.set(row.id, row.stage)
    }
  }

  return byContact
}

/** 把「一段一段的对话」合并成「一个一个的人」—— 阶段挂在人身上。 */
function groupByContact(
  conversations: readonly ConversationRow[],
  messages: Map<string, QualifiedBuyerMessage[]>,
  needs: Map<string, string[]>,
  stages: Map<string, string | null>,
): ContactEvidence[] {
  const byContact = new Map<string, ContactEvidence>()

  for (const conversation of conversations) {
    const existing = byContact.get(conversation.contact_id)
    const person: ContactEvidence = existing ?? {
      clientId: conversation.client_id,
      contactId: conversation.contact_id,
      currentStage: stages.get(conversation.contact_id) ?? null,
      messages: [],
      customerNeeds: [],
    }
    person.messages.push(...(messages.get(conversation.id) ?? []))
    person.customerNeeds.push(...(needs.get(conversation.id) ?? []))
    byContact.set(conversation.contact_id, person)
  }

  return Array.from(byContact.values())
}

/**
 * 落一个人的升级 + 审计。
 *
 * UPDATE 的 WHERE 里**再判一次当前档**：取数和写库之间可能有中介在手机上手工
 * 改过阶段，只靠内存里那份快照会把他刚做的判断盖掉。条件写成「stage 为空
 * 或仍停在放行的那几档」，人一旦动过，这条 UPDATE 就命中 0 行、什么也不发生。
 * 返回 false = 没写（被人抢先了），不算失败。
 */
async function applyDecision(decision: AutoTagDecision, now: Date): Promise<boolean> {
  const nowIso = now.toISOString()
  const stillEligible = `stage.is.null,stage.in.(${AUTO_UPGRADE_SOURCE_STAGES.join(',')})`

  const { data, error } = await supabaseAdmin
    .from('contacts')
    .update({ stage: decision.toStage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', decision.contactId)
    .eq('client_id', decision.clientId)
    .or(stillEligible)
    .select('id')

  if (error) throw new Error(`改阶段失败: ${error.message}`)
  if (!data || data.length === 0) return false

  // 审计。changed_by 写死 AUTO_TAG_ACTOR —— 人工改阶段写的是操作者邮箱，
  // 两者永远分得开，以后才答得出「AI 标错了多少」。
  await supabaseAdmin.from('contact_stage_events').insert({
    client_id: decision.clientId,
    contact_id: decision.contactId,
    from_stage: decision.fromStage,
    to_stage: decision.toStage,
    changed_by: AUTO_TAG_ACTOR,
    note: `系统自动标为真买家：${decision.verdict.evidence ?? '—'}`,
  })

  return true
}

/** 跑一轮自动打标。异常只在取数阶段抛，单个人写失败不拖垮整轮。 */
export async function autoTagQualifiedBuyers(now: Date): Promise<AutoTagResult> {
  const empty: AutoTagResult = { examined: 0, decided: 0, upgraded: 0, failed: 0 }

  const clientIds = Array.from(await loadClientsWithQualifiedStage())
  if (clientIds.length === 0) return empty

  const conversations = await loadConversations(clientIds)
  if (conversations.length === 0) return empty

  const conversationIds = conversations.map((c) => c.id)
  const contactIds = Array.from(new Set(conversations.map((c) => c.contact_id)))

  const [messages, needs, stages] = await Promise.all([
    loadInboundMessages(conversationIds),
    loadCustomerNeeds(conversationIds),
    loadStages(contactIds),
  ])

  const evidence = groupByContact(conversations, messages, needs, stages)
  const decisions = decideAutoTags(evidence)

  let upgraded = 0
  let failed = 0
  for (const decision of decisions) {
    try {
      if (await applyDecision(decision, now)) upgraded++
    } catch (err) {
      failed++
      console.error(`[crm/qualified-buyer] ${decision.contactId} 打标失败:`, err)
    }
  }

  return { examined: evidence.length, decided: decisions.length, upgraded, failed }
}
