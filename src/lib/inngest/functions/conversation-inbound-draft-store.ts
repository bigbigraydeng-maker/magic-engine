/**
 * F2（issue #1585，`conversation-inbound-draft.ts`）的存储层——读会话上下文 /
 * 写 `conversation_reply_drafts` 的全部 Supabase 访问都住在这里，跟 Inngest
 * 编排本身（哪一步该等谁、超时怎么处理）分开，保持两个文件都在 CLAUDE.md
 * "文件 < 800 行" 的范围内，也让这些纯粹的 DB 读写单独可测。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getClientKnowledge, type KnowledgeReadResult } from '@/lib/knowledge'
import type { ConversationHistoryTurn } from '@/lib/messenger-agent/prompt'
import type { MasterBrief } from '@/types/magic-engine'

/** 喂给 agent 的对话历史窗口——方案文档"最近 5 条消息"。 */
const HISTORY_WINDOW_FOR_DRAFT = 5

// ---------------------------------------------------------------------------
// load-context
// ---------------------------------------------------------------------------

export interface LoadedDraftContext {
  brief: MasterBrief | null
  knowledge: KnowledgeReadResult
  brandRedlinePhrases: string[]
  history: ConversationHistoryTurn[]
}

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

/**
 * 生产实现。IDOR 闸（跟 `tools.ts::queryConversationHistory` 同一条纪律）：
 * 先确认 conversationId 真的属于 clientId,再去查它的消息——即使这两个 id 这次
 * 是从已验证过的 webhook 事件里来的,也不因为"这次来源可信"就省掉这道过滤。
 */
export async function loadDraftContext(clientId: string, conversationId: string): Promise<LoadedDraftContext> {
  const { data: convo, error: convErr } = await supabaseAdmin
    .from('conversations')
    .select('id, client_id')
    .eq('id', conversationId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (convErr) {
    throw new Error(`[conversation-inbound-draft] 查会话归属失败 conversationId=${conversationId}: ${convErr.message}`)
  }
  if (!(convo as ConversationOwnerRow | null)) {
    throw new Error(`[conversation-inbound-draft] 会话不属于该客户 conversationId=${conversationId} clientId=${clientId}`)
  }

  const [brief, knowledge, clientRow, historyRows] = await Promise.all([
    getActiveBrief(clientId),
    getClientKnowledge(clientId, { purpose: 'customer_reply' }),
    supabaseAdmin.from('clients').select('brand_redline_phrases').eq('id', clientId).maybeSingle(),
    supabaseAdmin
      .from('conversation_messages')
      .select('direction, sender_name, body, sent_at')
      .eq('conversation_id', conversationId)
      // 🔴 魏征+子牙复审同时抓到的真实 bug：先前这里写的是 `ascending: true`——
      // 升序 + limit 只会拿到这条会话**最老**的 N 条,不是"最近 N 条"。PostgREST
      // 是先 ORDER 再 LIMIT,升序取 5 条 = 对话开头的 5 条。触发本次起草的那条
      // 客户消息（往往在对话末尾）反而不在 agent 看到的历史里。改成降序取最近 N
      // 条,读回来后在下面 `.reverse()` 恢复成时间正序（prompt.ts 的
      // `ConversationHistoryTurn[]` 契约要求"时间正序,最老的在前"）。
      .order('sent_at', { ascending: false })
      .limit(HISTORY_WINDOW_FOR_DRAFT),
  ])

  if (clientRow.error) {
    throw new Error(`[conversation-inbound-draft] 查品牌红线失败 clientId=${clientId}: ${clientRow.error.message}`)
  }
  if (historyRows.error) {
    throw new Error(`[conversation-inbound-draft] 查对话历史失败 conversationId=${conversationId}: ${historyRows.error.message}`)
  }

  const brandRedlinePhrases =
    (clientRow.data as { brand_redline_phrases: string[] | null } | null)?.brand_redline_phrases ?? []
  const history: ConversationHistoryTurn[] = ((historyRows.data as ConversationMessageRow[] | null) ?? [])
    .slice()
    .reverse() // 降序读回来的是"最新在前"，翻回时间正序（最老在前，最新——即客户刚发的这条——排最后）。
    .map((m) => ({
      direction: m.direction,
      senderName: m.sender_name,
      body: m.body,
      sentAt: m.sent_at,
    }))

  return { brief, knowledge, brandRedlinePhrases, history }
}

// ---------------------------------------------------------------------------
// persist-draft —— upsert 幂等（UNIQUE (conversation_id, message_id_trigger)）
// ---------------------------------------------------------------------------

export interface PersistDraftInput {
  clientId: string
  conversationId: string
  messageIdTrigger: string
  channel: string
  draftBody: string
  agentConfidence: number | null
  sourceOfferingCodes: string[]
  quotedOfferingNames: string[]
  verifierStatus: 'pending' | 'blocked' | 'error'
  blockedReasons: string[] | null
  verifierOutputJson: unknown
  inngestRunId: string | null
}

/**
 * 🔴 已知的存储契约漂移（非本 issue 引入，记录不隐藏）：这张表的
 * `source_offering_codes`/`quoted_offering_names` 是 issue #1574（v2 时期）
 * 设计的两个平行数组列，issue #1580/v3 补丁#8 把 agent 输出契约改成了配对数组
 * `offerings[]`。Provenance 校验本身在 `verify` 这一步已经用配对数组逐一核对过
 * （见 `verifier/policies/cts.ts` 的 provenance gate），这里只是把校验完的结果
 * 拆回两个数组写进现有列，供人工审计/门户展示，不影响校验本身的正确性。改列结构
 * 是独立的 A 级 schema 改动，不在本 issue 范围内顺手做。同样漂移的还有 design
 * doc §9.14 C.7 要求的 `cited_knowledge jsonb` 列——那一列也还没建，属于同一类
 * "文档写了、migration 没跟上"的已知缺口，不在本 issue 范围内新开 migration 补。
 */
export async function persistDraft(input: PersistDraftInput): Promise<{ id: string }> {
  const row = {
    client_id: input.clientId,
    conversation_id: input.conversationId,
    message_id_trigger: input.messageIdTrigger,
    channel: input.channel,
    draft_body: input.draftBody,
    agent_confidence: input.agentConfidence,
    source_offering_codes: input.sourceOfferingCodes,
    quoted_offering_names: input.quotedOfferingNames,
    verifier_status: input.verifierStatus,
    blocked_reasons: input.blockedReasons,
    verifier_output_json: input.verifierOutputJson,
    inngest_run_id: input.inngestRunId,
  }
  const { error: upsertError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .upsert(row, { onConflict: 'conversation_id,message_id_trigger', ignoreDuplicates: true })
  if (upsertError) {
    throw new Error(`[conversation-inbound-draft] 写草稿失败: ${upsertError.message}`)
  }

  // ignoreDuplicates 模式下 upsert 不回填行,重放/首次都统一走一次 select 取 id——
  // 幂等键 (conversation_id, message_id_trigger) 保证这里查到的一定是"这条消息
  // 对应的那一行"，不会跟别的触发消息串台。
  const { data, error: selectError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('id, verifier_status')
    .eq('conversation_id', input.conversationId)
    .eq('message_id_trigger', input.messageIdTrigger)
    .single()
  if (selectError || !data) {
    throw new Error(`[conversation-inbound-draft] 写草稿后回读失败: ${selectError?.message ?? 'no row'}`)
  }
  const existing = data as { id: string; verifier_status: string }

  // 🔴 子牙复审 M1：ignoreDuplicates 只保证"回读到的是这条消息对应的那一行"，
  // 不保证那一行反映的是**这次**调用的写入意图。典型场景：起草失败先落了一行
  // verifier_status='error'（draft_body=''），同一条消息后来重新起草成功——
  // upsert 因为幂等键已存在被静默忽略，回读到的仍是那条陈旧的 error 行，会话
  // 因此永远卡在一条空文案的 error 草稿上，永远等不到批准。陈旧的 error 行
  // 不该永久占住这个幂等键，这次真正成功/被 verifier 处理过的结果要覆盖它。
  if (existing.verifier_status === 'error' && input.verifierStatus !== 'error') {
    const { error: overwriteError } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .update(row)
      .eq('id', existing.id)
    if (overwriteError) {
      throw new Error(`[conversation-inbound-draft] 覆盖陈旧 error 草稿失败: ${overwriteError.message}`)
    }
  }

  return { id: existing.id }
}

export async function updateDraftStatus(draftId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', draftId)
  if (error) {
    throw new Error(`[conversation-inbound-draft] 更新草稿状态失败 draftId=${draftId}: ${error.message}`)
  }
}

/**
 * 只在草稿仍是 `pending` 时才标记超时，返回是否真的标记成功。跟 F3
 * route.ts 的原子条件更新（`.eq('verifier_status', 'pending')`）同一条纪律：
 * 🔴 魏征+子牙复审同时指出的竞态——F3 恰好在 4 小时判定前一刻把状态改成
 * `approved`/`rejected` 并（approve 分支）emit 了事件，本函数的 `waitForEvent`
 * 却因为事件投递的一点延迟没赶上、判定成超时。无条件覆盖会：①盖掉人工已经
 * 做出的决定，FDE 在门户看到"批准成功"但消息其实发不出去；②对一条已经被
 * 人工正常拒绝的草稿，4 小时后凭空制造一次 `conversation/reply.timeout`
 * 事故级告警。加上 `.eq('verifier_status','pending')` 条件后，0 行受影响就
 * 说明状态已经被人工决定过，调用方不应该再覆盖、也不应该再 emit 超时事件。
 */
export async function markTimedOutIfPending(draftId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .update({ verifier_status: 'timed_out', updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('verifier_status', 'pending')
    .select('id')
  if (error) {
    throw new Error(`[conversation-inbound-draft] 标记超时失败 draftId=${draftId}: ${error.message}`)
  }
  return Array.isArray(data) && data.length > 0
}

export interface ApprovedDraftRow {
  draft_body: string
  verifier_status: string
}

/** Step `send` 前重读——可能已经被"改后发送"覆盖过 draft_body,见 F2 主文件头说明。 */
export async function loadApprovedDraft(draftId: string): Promise<ApprovedDraftRow | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('draft_body, verifier_status')
    .eq('id', draftId)
    .maybeSingle()
  if (error) {
    throw new Error(`[conversation-inbound-draft] 发送前重读草稿失败 draftId=${draftId}: ${error.message}`)
  }
  return data as ApprovedDraftRow | null
}

export async function loadLastInboundAt(conversationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`[conversation-inbound-draft] 查最近入站消息时间失败 conversationId=${conversationId}: ${error.message}`)
  }
  return (data as { sent_at: string } | null)?.sent_at ?? null
}
