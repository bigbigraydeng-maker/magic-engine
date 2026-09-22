/**
 * 私信简报这一轮该做的三件事，从 cron 路由里抽出来变成可分段调用的三个函数。
 *
 * ## 为什么要抽（2026-09-07 · 修 14 天停更）
 *
 * 原来三件事全挤在 `/api/cron/messenger-brief-hourly` 一个请求里，一轮 160~210 秒。
 * 而网关在**约 125 秒**就掐断连接（实测边界见下），于是这一整轮永远只能在
 * 「响应超时但服务端跑完了」的状态下结束 —— 谁上游按 HTTP 结果判成败，谁就误判。
 *
 * 抽成三段之后，Inngest 那边可以一段一个请求地跑：每段都远在网关那条线以内，
 * 失败也只重试那一段，不用把已经写好的 50 张卡再写一遍。
 *
 * ## 三段的顺序不能换
 *
 * 1. `loadDueBriefs` —— 挑出该写卡的对话（纯读库，秒级）
 * 2. `generateDueBriefs` —— 写卡（每张约 3.2 秒的模型调用，**必须分批**）
 * 3. `runPostBriefSweeps` —— 自动标真买家 + 填「跟进到哪一步」
 *
 * 第 3 步要读第 2 步刚写好的卡，所以必须排在后面；它整段失败也只记一笔，
 * 不回滚已经写好的卡（跟抽出来之前的行为一致）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  shouldGenerateBrief,
  generateBrief,
  storeBrief,
  type BriefCandidate,
  type StoredMessage,
} from '@/lib/messenger/brief'
import { autoTagQualifiedBuyers, type AutoTagResult } from '@/lib/crm/qualified-buyer-autotag'
import { inferStagesFromConversations, type StageInferResult } from '@/lib/crm/stage-infer'

/**
 * 一轮最多写几张卡。**这是花钱的闸** —— 积压会顺着后面几轮慢慢排掉，
 * 而不是让一轮坏运行变成一张没有上限的账单。
 */
export const MAX_BRIEFS_PER_RUN = 50

/**
 * 一段最多写几张卡。
 *
 * 🔴 这个数字的唯一依据是**网关约 125 秒掐断**：实测每张卡约 3.2 秒
 *    （2026-08-22 那批运行：50 张 / 157~208 秒），12 张约 40 秒，留足三倍余量。
 *    调大到 40 张就会重新踩回这次事故的那条线。
 */
export const BRIEFS_PER_CHUNK = 12

/** 候选池一次最多从库里捞多少条对话（挑之前的粗筛上限，不是写卡上限）。 */
const CANDIDATE_POOL = 500

interface ConversationRow {
  id: string
  client_id: string
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
  conversation_briefs: {
    source_message_count: number
    regen_count: number
    regen_count_date: string | null
    knowledge_status: string | null
  }[]
}

/**
 * 该写卡的一条对话。
 *
 * 🔴 必须是**纯 JSON**：它要作为 Inngest 步骤的返回值被缓存下来，跨步骤传递。
 *    塞进 Date 或类实例，重放时拿回来的就不是同一个东西。
 */
export interface DueBrief extends BriefCandidate {
  /** 最后说话的是客人还是我们 —— 模型靠它决定「谁在等谁」。 */
  awaitingReply: boolean
}

export interface BriefGenerationResult {
  generated: number
  failed: number
}

export interface PostBriefSweepResult {
  qualifiedBuyers: AutoTagResult | { error: string }
  stageInfer: StageInferResult | { error: string }
}

function toCandidate(row: ConversationRow): BriefCandidate {
  const brief = row.conversation_briefs?.[0]
  return {
    conversationId: row.id,
    clientId: row.client_id,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    existingBriefMessageCount: brief?.source_message_count ?? null,
    regenCount: brief?.regen_count ?? 0,
    regenCountDate: brief?.regen_count_date ?? null,
    existingKnowledgeStatus: brief?.knowledge_status === 'read_failed' ? 'read_failed' : null,
  }
}

async function loadMessages(conversationId: string): Promise<StoredMessage[]> {
  const { data } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, sender_name, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })

  return (data ?? []).map((m) => ({
    direction: m.direction as 'inbound' | 'outbound',
    senderName: m.sender_name,
    body: m.body ?? '',
    sentAt: m.sent_at,
  }))
}

/**
 * 挑出这一轮该写卡的对话。纯读库，不花钱、不写库。
 *
 * 读失败**抛异常**而不是返回空：返回空跟「今天真的没人要写卡」长得一模一样，
 * 上游会把一次读库失败记成一次正常的空轮。
 */
export async function loadDueBriefs(
  now: Date,
  cap: number = MAX_BRIEFS_PER_RUN,
): Promise<DueBrief[]> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      'id, client_id, message_count, last_message_at, last_message_from, conversation_briefs(source_message_count, regen_count, regen_count_date, knowledge_status)',
    )
    .gt('message_count', 0)
    // 只认私信。这个任务写出来的是「Facebook 私信简报」，喂邮件进去会得到一张
    // 说错渠道的卡，而销售会照着它去 Messenger 找一个从没在那说过话的人。
    .eq('channel', 'messenger')
    .order('last_message_at', { ascending: false })
    .limit(CANDIDATE_POOL)

  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((row) => {
      const r = row as ConversationRow
      return { ...toCandidate(r), awaitingReply: r.last_message_from === 'customer' }
    })
    .filter((c) => shouldGenerateBrief(c, now))
    .slice(0, cap)
}

/**
 * 给这一批对话各写一张卡。**调用方负责分批**（见 `BRIEFS_PER_CHUNK`）。
 *
 * 单条失败只记一笔继续下一条 —— 一个人的对话数据坏了，不该让这一批剩下的人
 * 今天都看不到卡。
 */
export async function generateDueBriefs(
  due: readonly DueBrief[],
  now: Date,
): Promise<BriefGenerationResult> {
  let generated = 0
  let failed = 0

  for (const candidate of due) {
    try {
      const messages = await loadMessages(candidate.conversationId)
      if (messages.length === 0) continue
      const { brief, knowledgeStatus } = await generateBrief(messages, candidate.clientId, {
        awaitingReply: candidate.awaitingReply,
        hoursSinceLastMessage: candidate.lastMessageAt
          ? Math.round((now.getTime() - new Date(candidate.lastMessageAt).getTime()) / 3_600_000)
          : 0,
      })
      await storeBrief(candidate, brief, now, knowledgeStatus)
      generated++
    } catch (err) {
      failed++
      console.error(`[messenger/brief] ${candidate.conversationId} failed:`, err)
    }
  }

  return { generated, failed }
}

/**
 * 写完卡之后的两遍扫描。
 *
 * 两遍各自 catch：任一整轮失败都只记一笔，已经写好的卡不回滚 ——
 * 卡直接影响销售今天看到什么，标签和阶段不影响。
 */
export async function runPostBriefSweeps(now: Date): Promise<PostBriefSweepResult> {
  let qualifiedBuyers: AutoTagResult | { error: string }
  try {
    qualifiedBuyers = await autoTagQualifiedBuyers(now)
  } catch (err) {
    qualifiedBuyers = { error: err instanceof Error ? err.message : String(err) }
    console.error('[crm/qualified-buyer] 自动打标整轮失败:', err)
  }

  let stageInfer: StageInferResult | { error: string }
  try {
    stageInfer = await inferStagesFromConversations(now)
  } catch (err) {
    stageInfer = { error: err instanceof Error ? err.message : String(err) }
    console.error('[crm/stage-infer] 读往来填阶段整轮失败:', err)
  }

  return { qualifiedBuyers, stageInfer }
}

/** 把 due 列表切成每段 `BRIEFS_PER_CHUNK` 条。抽出来是为了能直测切法。 */
export function chunkDueBriefs(
  due: readonly DueBrief[],
  size: number = BRIEFS_PER_CHUNK,
): DueBrief[][] {
  if (size <= 0) throw new Error('chunk size 必须大于 0')
  const out: DueBrief[][] = []
  for (let i = 0; i < due.length; i += size) out.push(due.slice(i, i + size))
  return out
}
