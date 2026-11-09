/**
 * NAL 私信同步——编排层（承接 CTS CAPI 项目，2026-09-15）。
 *
 * 纯 I/O 编排：读 `conversations`/`conversation_messages` → 判定
 * （`nal-messenger-lead-classify.ts`）→ 写 `me_sale_outcomes`。分类规则本身
 * 不在这里，方便单测；这一层只负责把各块接起来——跟 CTS 那条线
 * （`cts-crm-sheet-sync-run.ts`）同一个分层方式。
 *
 * 跟 CTS 那条线比，少一步：CTS 要按电话/邮箱反查既有联系人（`findExistingContactId`），
 * NAL 这边不需要——`conversations.contact_id` 本来就直接挂着（Messenger 联系人建档
 * 时就定了），也不需要模糊匹配。`conversations.participant_psid` 就是要写进
 * `me_sale_outcomes.page_scoped_user_id` 的那个 Facebook 私信身份，同一张表上现成的。
 *
 * 🔴 本轮范围只做「有效咨询」（lead），不做「已成交」——见 `nal-messenger-lead-classify.ts`
 * 文件头的设计说明：NAL 联系人的 CRM 阶段字段全是空的，且集运报价没有团价表可查金额，
 * 现在拼不出合法的 purchase 记录。
 *
 * ~~这一轮**只人工触发**，不接 cron/Inngest~~ —— 2026-09-15 起由 `conversion-daily-pipeline`
 * 每天自动调；2026-09-22 起改成分块调 `runNalMessengerLeadSyncChunk()`（跟 CTS 那条线
 * 同一原因：单个大步骤会被网关 ~125 秒超时强杀，PITFALLS F10）。手动路由仍走
 * `runNalMessengerLeadSync()` 一次跑完。
 *
 * `maxInsertsPerRun` 是给人工审核页面留的安全阀，超出的部分下次再跑会继续处理
 * （已经写过的靠幂等键快速跳过，不会重复劳动）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { buildIntakeRow, type IntakeInput } from './intake'
import {
  classifyNalConversation,
  nalMessengerSourceRef,
  type InboundMessage,
  type OutboundMessage,
} from './nal-messenger-lead-classify'

/** New Asian Logistics（跨境集运物流代理）。 */
const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const DEFAULT_MAX_INSERTS_PER_RUN = 50

export interface NalMessengerSyncSummary {
  totalConversations: number
  qualifiedLeadsFound: number
  insertedLeads: number
  /** 已经同步过、这次命中幂等键被跳过——预期行为，不是错误。 */
  skippedAlreadySynced: number
  /** 判定出真商机，但这段对话没有 Facebook 私信身份可用——理论上不该出现，留痕以防万一。 */
  skippedNoPsid: number
  /**
   * 对话没有关联到联系人——理论上建档时就该有，目前生产库实测 0 个（2026-09-15）。
   * 单独计数是为了防呆：以后联系人建档流程一旦有延迟或漏建档，不能让这类对话
   * 悄悄跳过、汇总报告却看不出漏了多少（对照 CTS 那条线的 contactNotLinked）。
   */
  skippedNoContact: number
  insertErrors: Array<{ conversationId: string; error: string }>
  cappedAtMaxInserts: boolean
}

function emptySummary(): NalMessengerSyncSummary {
  return {
    totalConversations: 0,
    qualifiedLeadsFound: 0,
    insertedLeads: 0,
    skippedAlreadySynced: 0,
    skippedNoContact: 0,
    skippedNoPsid: 0,
    insertErrors: [],
    cappedAtMaxInserts: false,
  }
}

type ConversationRow = {
  id: string
  contact_id: string | null
  participant_psid: string | null
  /** Facebook 私信自带的显示名——PM 反馈：审核页面看不到是谁没法判断，这个填进
   * customer_first 直接显示。跟 CTS 那条线同一个约定（`classified.fullName`
   * 整段塞进 customerFirst，不拆姓名），不是新发明的规则。 */
  participant_name: string | null
}

type MessageRow = {
  message_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}

export interface RunNalMessengerSyncDeps {
  supabase?: SupabaseClient
  maxInsertsPerRun?: number
}

/**
 * 分块游标——给 Inngest 逐块推进用（2026-09-22，跟 CTS 那条线同一形状）。
 * 🔴 全是 number/string：要经过 Inngest step 记忆化（JSON 序列化）。
 */
export interface NalMessengerSyncCursor {
  /** 从第几个对话（按 created_at, id 稳定排序）开始。 */
  offset: number
  /** 这一块最多看多少个对话；不传 = 一直看到最后。 */
  limit?: number
  /** 之前几块累计写入了多少条——`maxInsertsPerRun` 要跨块生效。 */
  insertedSoFar: number
  /**
   * 只看在这个时刻之前建的对话。块与块之间新进来的对话不会把游标挤歪
   * （子牙 2026-09-22 复审 m3），它们明天再同步。
   */
  createdBeforeIso: string
}

export interface NalMessengerSyncChunkResult {
  summary: NalMessengerSyncSummary
  nextOffset: number
  insertedSoFar: number
  done: boolean
}

export function mergeNalMessengerSummaries(
  a: NalMessengerSyncSummary,
  b: NalMessengerSyncSummary,
): NalMessengerSyncSummary {
  return {
    totalConversations: a.totalConversations + b.totalConversations,
    qualifiedLeadsFound: a.qualifiedLeadsFound + b.qualifiedLeadsFound,
    insertedLeads: a.insertedLeads + b.insertedLeads,
    skippedAlreadySynced: a.skippedAlreadySynced + b.skippedAlreadySynced,
    skippedNoPsid: a.skippedNoPsid + b.skippedNoPsid,
    skippedNoContact: a.skippedNoContact + b.skippedNoContact,
    insertErrors: [...a.insertErrors, ...b.insertErrors],
    cappedAtMaxInserts: a.cappedAtMaxInserts || b.cappedAtMaxInserts,
  }
}

/** Supabase 一次最多回 1000 行（PITFALLS F9）——不传 limit 时内部按这个分页读全。 */
const CONVERSATIONS_PAGE = 1000

/**
 * 处理一块对话（`cursor.offset` 起、最多 `cursor.limit` 个）。
 */
export async function runNalMessengerLeadSyncChunk(
  cursor: NalMessengerSyncCursor,
  deps: RunNalMessengerSyncDeps = {},
): Promise<NalMessengerSyncChunkResult> {
  const supabase = deps.supabase ?? supabaseAdmin
  const maxInserts = deps.maxInsertsPerRun ?? DEFAULT_MAX_INSERTS_PER_RUN
  const summary = emptySummary()
  const pageSize = cursor.limit ?? CONVERSATIONS_PAGE

  // 只看 Messenger——NAL 目前 100% 是这个渠道，WhatsApp 还没有等价的稳定消息 id
  // 来源（子牙评审：幂等设计目前只针对 Messenger 验证过），不在这轮范围内。
  // 🔴 稳定排序 + range 分页（PITFALLS F9）：created_at 并列时用 id 兜底，
  //    否则分页边界上的行会在两次请求间换位。
  const { data: conversations, error: convErr } = await supabase
    .from('conversations')
    .select('id, contact_id, participant_psid, participant_name')
    .eq('client_id', NAL_CLIENT_ID)
    .eq('channel', 'messenger')
    .lte('created_at', cursor.createdBeforeIso)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(cursor.offset, cursor.offset + pageSize - 1)

  if (convErr) throw new Error(`读取 NAL 私信对话失败：${convErr.message}`)

  const convRows = (conversations ?? []) as ConversationRow[]
  let insertedThisRun = cursor.insertedSoFar

  for (const conv of convRows) {
    summary.totalConversations++
    // 没关联到联系人的对话理论上不该出现（Messenger 联系人建档时就会挂上），
    // 但万一出现，跳过比硬凑一个 contactId 安全——buildIntakeRow 也会因为
    // 缺 contactId 而拒收纯 PSID 记录（拒联检查需要它）。
    if (!conv.contact_id) {
      summary.skippedNoContact++
      continue
    }

    const { data: messages, error: msgErr } = await supabase
      .from('conversation_messages')
      .select('message_id, direction, body, sent_at')
      .eq('conversation_id', conv.id)
      .order('sent_at', { ascending: true })

    if (msgErr) throw new Error(`读取对话 ${conv.id} 的消息失败：${msgErr.message}`)

    const rows = (messages ?? []) as MessageRow[]
    const inbound: InboundMessage[] = rows
      .filter((m) => m.direction === 'inbound')
      .map((m) => ({ messageId: m.message_id, body: m.body, sentAt: m.sent_at }))
    const outbound: OutboundMessage[] = rows
      .filter((m) => m.direction === 'outbound')
      .map((m) => ({ messageId: m.message_id, body: m.body, sentAt: m.sent_at }))

    const leads = classifyNalConversation(inbound, outbound)
    summary.qualifiedLeadsFound += leads.length

    for (const lead of leads) {
      if (insertedThisRun >= maxInserts) {
        summary.cappedAtMaxInserts = true
        continue
      }
      if (!conv.participant_psid) {
        summary.skippedNoPsid++
        continue
      }

      const input: IntakeInput = {
        clientId: NAL_CLIENT_ID,
        contactId: conv.contact_id,
        outcomeKind: 'lead',
        occurredAt: lead.occurredAt,
        sourceKind: 'messenger_conversation',
        sourceRef: nalMessengerSourceRef(conv.contact_id, lead.leadMessageId),
        pageScopedUserId: conv.participant_psid,
        // 整段塞进 customerFirst，不拆姓名——跟 CTS 那条线同一个约定
        // （cts-crm-sheet-sync-run.ts 的 processQualifiedLead 也是把
        // classified.fullName 整段塞给 customerFirst）。PM 反馈：审核页面
        // 看不到是谁没法判断该不该批，这是唯一能显示的身份信息。
        customerFirst: conv.participant_name,
      }

      const built = buildIntakeRow(input, { defaultPhoneCountry: '64', now: new Date() })
      if (!built.ok) {
        summary.insertErrors.push({ conversationId: conv.id, error: built.errors.join('; ') })
        continue
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('me_sale_outcomes')
        .insert(built.row)
        .select('id')
        .single()

      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          // 幂等键命中——正常去重，见 nalMessengerSourceRef 的设计说明。
          summary.skippedAlreadySynced++
          continue
        }
        summary.insertErrors.push({ conversationId: conv.id, error: insertErr.message })
        continue
      }

      await supabase.from('me_conversion_audit').insert({
        outcome_id: (inserted as { id: string }).id,
        action: 'created',
        actor: 'nal-messenger-lead-sync',
        detail: {
          source_kind: input.sourceKind,
          source_ref: input.sourceRef,
          lead_rule: lead.leadRule,
          reply_rule: lead.replyRule,
        },
      })
      summary.insertedLeads++
      insertedThisRun++
    }
  }

  return {
    summary,
    nextOffset: cursor.offset + convRows.length,
    insertedSoFar: insertedThisRun,
    done: convRows.length < pageSize,
  }
}

/** 一次跑完所有对话——手动路由 `nal-messenger-sync` 走这条，行为跟拆块之前一样。 */
export async function runNalMessengerLeadSync(
  deps: RunNalMessengerSyncDeps = {},
): Promise<NalMessengerSyncSummary> {
  const createdBeforeIso = new Date().toISOString()
  let cursor: NalMessengerSyncCursor = { offset: 0, insertedSoFar: 0, createdBeforeIso }
  let merged = emptySummary()
  for (;;) {
    const chunk = await runNalMessengerLeadSyncChunk(cursor, deps)
    merged = mergeNalMessengerSummaries(merged, chunk.summary)
    if (chunk.done) return merged
    cursor = { ...cursor, offset: chunk.nextOffset, insertedSoFar: chunk.insertedSoFar }
  }
}
