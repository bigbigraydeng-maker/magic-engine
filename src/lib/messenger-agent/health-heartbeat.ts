/**
 * CTS Governed Reply · F4 conversation.health.heartbeat（issue #1587）。
 *
 * 每 6 小时巡检一次，防的是「系统安静地停摆但看起来一切正常」（参考同类事故：
 * 2026-08-21 CTS $735 Meta leads 静默断流）。四类检查全部**按 (client_id, channel)
 * 二元组分别算**，不是按 client_id 单独算——WhatsApp 刚上线用量天然远低于
 * Messenger，同一阈值会导致假警报或漏检。
 *
 *   1. webhook_silent            —— 过去 24 小时入站消息数 < 过去 30 天 rolling avg，
 *                                    冷启动（上线不到 14 天）只观察不告警。
 *   2. verifier_block_rate_high  —— 过去 24 小时 AI 客服回复草稿被验证器拦下的比例
 *                                    超过阈值（canonical 过时或 agent 出问题信号）。
 *   3. verifier_error_rate_high  —— 过去 24 小时 verifier_status='error' 次数超过阈值。
 *   4. optout_write_failed       —— 过去 24 小时有退订登记写入失败（issue #1575/#1587，
 *                                    防 `feedback-monitoring-writer-silent-failure-
 *                                    inverts-health-check` 那类教训重演——写失败不能被
 *                                    误判成「没人退订、一切正常」）。
 *
 * 🔴 **本次不实现的一项**：issue #1587 原文还要求消费 `conversation/reply.timeout`
 * 事件（4 小时批准超时算事故，PM 拍板）。#1585（那个事件的发出方）目前还没实现
 * （`src/lib/inngest/functions/` 下没有对应文件，issue 状态 OPEN），本文件因此**不**
 * 新增 `reply_timeout` 这个 check_type、不预留字段、不预留 case——等 #1585 上线后
 * 再作为独立改动加一个新 check_type，不在这次范围内假装它已经存在。
 *
 * 纯函数（`isColdStart`/`computeRollingAverage`/`isWebhookVolumeAlert`）跟真正碰
 * 数据库的 `runConversationHealthChecks` 分离，方便前者直接单测边界值。
 *
 * 🔴 魏征复审（2026-09-15）发现并已修复的两个真 bug：
 *   1. 冷启动判断原来只看 30 天窗口内最早的一条消息——季节性客户历史断档超过
 *      30 天、近期刚恢复消息的场景会被误判成「新接入，还在观察期」，导致接下来
 *      14 天里真实故障反而测不出来。现在额外查一次「这批会话里有没有 14 天前
 *      的消息」（范围限定在已发现的 conversation_id 里，不是无界扫描），只要有
 *      就直接判非冷启动，不再受窗口边界污染。
 *   2. 组合彻底静默超过 30 天（这个检查最该抓住的场景）时，它不会出现在
 *      `combos` 里，本轮就不产生任何结果，导致 `conversation_health_alerts`
 *      里之前那条 `webhook_silent` 告警永远不会被同步/清除——变成永久孤儿，
 *      跟文件头「自愈表」的设计意图直接矛盾。现在额外查一次
 *      `conversation_health_alerts` 表，把「有活跃告警但这一轮查不到消息」的
 *      组合补回来：`webhook_silent` 保持不健康（持续静默，不能算恢复），另外
 *      三类检查按结构性事实标记健康（没有新消息就不可能有新草稿/新退订失败）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'

const DAY_MS = 24 * 60 * 60 * 1000
/** 30 天 rolling window：24 小时算「当前」，剩下 29 天算「过去」，两边不重叠。 */
const ROLLING_WINDOW_DAYS = 30
const PRIOR_WINDOW_DAYS = ROLLING_WINDOW_DAYS - 1
/** 冷启动观察期天数——跟 `isColdStart` 里的 14 天保持同一个数字来源。 */
const COLD_START_DAYS = 14

// ---------------------------------------------------------------------------
// 纯函数——不碰数据库，直接单测。
// ---------------------------------------------------------------------------

/** 这个 (client_id, channel) 组合是不是还在「冷启动」观察期（上线不到 14 天）。 */
export function isColdStart(firstSeenAt: Date, now: Date): boolean {
  const days = (now.getTime() - firstSeenAt.getTime()) / DAY_MS
  return days < COLD_START_DAYS
}

/** `windowDays<=0` 返回 0（防除零/负数），否则就是简单的总数除以天数。 */
export function computeRollingAverage(totalCount: number, windowDays: number): number {
  if (windowDays <= 0) return 0
  return totalCount / windowDays
}

/**
 * 过去 24 小时的消息量是否明显偏低。冷启动期间恒为 false——没有足够历史数据
 * 可比，「阈值就是 rolling avg 本身」在冷启动期间没有意义。
 */
export function isWebhookVolumeAlert(current24hCount: number, rollingAvg: number, coldStart: boolean): boolean {
  if (coldStart) return false
  return current24hCount < rollingAvg
}

/** 过去 24 小时草稿被验证器拦下的比例超过这个阈值才算告警（issue 原文：80%）。 */
export const VERIFIER_BLOCK_RATE_ALERT_THRESHOLD = 0.8

/**
 * 过去 24 小时 `verifier_status='error'` 次数达到这个数才算告警。issue 原文没给
 * 具体数字（"draft verifier_status='error' 24h > N"），没有历史数据支撑更精细的
 * 阈值前先取一个保守默认值——3 次以内多半是零星的瞬时故障，3 次以上开始像是
 * 系统性问题。等有真实运行数据后再调整，这里先把可调之处写清楚。
 */
export const VERIFIER_ERROR_COUNT_ALERT_THRESHOLD = 3

// ---------------------------------------------------------------------------
// I/O —— 真正查库。
// ---------------------------------------------------------------------------

export type ConversationHealthCheckType =
  | 'webhook_silent'
  | 'verifier_block_rate_high'
  | 'verifier_error_rate_high'
  | 'optout_write_failed'

export interface HealthCheckResult {
  readonly clientId: string
  readonly channel: string
  readonly checkType: ConversationHealthCheckType
  readonly healthy: boolean
  /** 人话，给 pm-todo 的 `pushConversationHealthAlertItems` 直接拼进 `what` 字段。 */
  readonly detail: string
}

interface MessageRow {
  conversation_id: string
  sent_at: string
}

interface ConversationRow {
  id: string
  client_id: string
  channel: string
}

interface DraftRow {
  client_id: string
  channel: string
  verifier_status: string
}

interface OptOutFailureRow {
  client_id: string
  channel: string
}

interface ComboAccumulator {
  clientId: string
  channel: string
  timestampsMs: number[]
}

function comboKey(clientId: string, channel: string): string {
  return `${clientId}:${channel}`
}

/**
 * 每 6 小时跑一次的全量检查。按 (client_id, channel) 分组，每组每种 check_type
 * 都会 push 一条结果（健康的也会 push，`healthy: true`）——上层（Inngest 函数的
 * sync-alerts 步骤）需要靠这个「健康了」的信号把 `conversation_health_alerts`
 * 里对应那一行删掉，只 push 不健康的会让「之前的告警现在好了」永远无法被发现。
 */
export async function runConversationHealthChecks(
  supabase: SupabaseClient,
  now: Date,
): Promise<HealthCheckResult[]> {
  const nowMs = now.getTime()
  const windowStartIso = new Date(nowMs - ROLLING_WINDOW_DAYS * DAY_MS).toISOString()
  const dayAgoIso = new Date(nowMs - DAY_MS).toISOString()
  const coldStartCutoffIso = new Date(nowMs - COLD_START_DAYS * DAY_MS).toISOString()

  // 1) 找出过去 30 天有过入站消息的所有 (client_id, channel) 组合——查真实消息表
  //    conversation_messages，它本身不带 client_id/channel，要 join conversations。
  const messageRows = await fetchAll<MessageRow>((from, to) =>
    supabase
      .from('conversation_messages')
      .select('conversation_id, sent_at')
      .eq('direction', 'inbound')
      .gte('sent_at', windowStartIso)
      .order('sent_at', { ascending: true })
      .range(from, to),
  )

  const conversationIds = Array.from(new Set(messageRows.map((r) => r.conversation_id)))
  const conversationRows = conversationIds.length
    ? await fetchAll<ConversationRow>((from, to) =>
        supabase
          .from('conversations')
          .select('id, client_id, channel')
          .in('id', conversationIds)
          .order('id', { ascending: true })
          .range(from, to),
      )
    : []
  const conversationById = new Map(conversationRows.map((c) => [c.id, c]))

  // 冷启动修复：查这批会话里有没有 14 天前的入站消息——范围限定在已发现的
  // conversationIds 内（不是无界扫描全部历史）。有 → 这个组合肯定不是「刚接入」，
  // 不管 30 天窗口内看到的最早消息多晚，都不能判冷启动。
  const preColdStartRows = conversationIds.length
    ? await fetchAll<{ conversation_id: string }>((from, to) =>
        supabase
          .from('conversation_messages')
          .select('conversation_id')
          .eq('direction', 'inbound')
          .in('conversation_id', conversationIds)
          .lt('sent_at', coldStartCutoffIso)
          .range(from, to),
      )
    : []
  const comboKeysWithPreExistingHistory = new Set<string>()
  for (const row of preColdStartRows) {
    const convo = conversationById.get(row.conversation_id)
    if (convo) comboKeysWithPreExistingHistory.add(comboKey(convo.client_id, convo.channel))
  }

  const combos = new Map<string, ComboAccumulator>()
  for (const row of messageRows) {
    const convo = conversationById.get(row.conversation_id)
    // 会话查不到（数据不一致，比如会话被删了但消息没有级联干净）——跳过，
    // 这不是心跳检查该判的事，也没有 client_id/channel 可归类。
    if (!convo) continue
    const key = comboKey(convo.client_id, convo.channel)
    const combo = combos.get(key) ?? { clientId: convo.client_id, channel: convo.channel, timestampsMs: [] }
    combo.timestampsMs.push(Date.parse(row.sent_at))
    combos.set(key, combo)
  }

  // 2) verifier 24h 统计（issue #1585/#1574 已建的 conversation_reply_drafts）。
  const draftRows = await fetchAll<DraftRow>((from, to) =>
    supabase
      .from('conversation_reply_drafts')
      .select('client_id, channel, verifier_status')
      .gte('created_at', dayAgoIso)
      .order('created_at', { ascending: true })
      .range(from, to),
  )
  const draftStats = new Map<string, { total: number; blocked: number; error: number }>()
  for (const row of draftRows) {
    const key = comboKey(row.client_id, row.channel)
    const stat = draftStats.get(key) ?? { total: 0, blocked: 0, error: 0 }
    stat.total += 1
    if (row.verifier_status === 'blocked') stat.blocked += 1
    if (row.verifier_status === 'error') stat.error += 1
    draftStats.set(key, stat)
  }

  // 3) opt-out 写入失败 24h 统计（本 issue 新建的 conversation_optout_write_failures）。
  const optOutFailureRows = await fetchAll<OptOutFailureRow>((from, to) =>
    supabase
      .from('conversation_optout_write_failures')
      .select('client_id, channel')
      .gte('occurred_at', dayAgoIso)
      .order('occurred_at', { ascending: true })
      .range(from, to),
  )
  const optOutFailureCounts = new Map<string, number>()
  for (const row of optOutFailureRows) {
    const key = comboKey(row.client_id, row.channel)
    optOutFailureCounts.set(key, (optOutFailureCounts.get(key) ?? 0) + 1)
  }

  const results: HealthCheckResult[] = []

  for (const combo of combos.values()) {
    const key = comboKey(combo.clientId, combo.channel)
    const current24hCount = combo.timestampsMs.filter((t) => t >= nowMs - DAY_MS).length
    const priorWindowCount = combo.timestampsMs.filter((t) => t < nowMs - DAY_MS).length
    const firstSeenMs = Math.min(...combo.timestampsMs)
    const coldStart = comboKeysWithPreExistingHistory.has(key) ? false : isColdStart(new Date(firstSeenMs), now)
    const rollingAvg = computeRollingAverage(priorWindowCount, PRIOR_WINDOW_DAYS)
    const volumeAlert = isWebhookVolumeAlert(current24hCount, rollingAvg, coldStart)

    results.push({
      clientId: combo.clientId,
      channel: combo.channel,
      checkType: 'webhook_silent',
      healthy: !volumeAlert,
      detail: volumeAlert
        ? `过去24小时只收到${current24hCount}条客户消息，明显低于过去29天平均每天约${rollingAvg.toFixed(1)}条，像是这个渠道的接收链路安静地断了`
        : coldStart
          ? '这个渠道上线不到14天，还在观察期，暂不判断消息量是否异常'
          : `过去24小时收到${current24hCount}条客户消息，跟过去29天平均每天约${rollingAvg.toFixed(1)}条相比正常`,
    })

    const draftStat = draftStats.get(key) ?? { total: 0, blocked: 0, error: 0 }
    // total===0：没有稽核对象，这两项按定义都健康——不是"查不到就当没事"，是
    // "没有草稿产生，谈不上拦截率/出错率异常"。
    const blockRate = draftStat.total > 0 ? draftStat.blocked / draftStat.total : 0
    const blockAlert = draftStat.total > 0 && blockRate > VERIFIER_BLOCK_RATE_ALERT_THRESHOLD
    results.push({
      clientId: combo.clientId,
      channel: combo.channel,
      checkType: 'verifier_block_rate_high',
      healthy: !blockAlert,
      detail: blockAlert
        ? `过去24小时AI客服回复草稿被验证器拦下的比例达${Math.round(blockRate * 100)}%（${draftStat.blocked}/${draftStat.total}条），超过${Math.round(VERIFIER_BLOCK_RATE_ALERT_THRESHOLD * 100)}%的阈值，像是客户资料库过期或AI出了问题`
        : '过去24小时AI客服回复草稿被验证器拦下的比例正常',
    })

    const errorAlert = draftStat.error >= VERIFIER_ERROR_COUNT_ALERT_THRESHOLD
    results.push({
      clientId: combo.clientId,
      channel: combo.channel,
      checkType: 'verifier_error_rate_high',
      healthy: !errorAlert,
      detail: errorAlert
        ? `过去24小时验证器出错${draftStat.error}次，达到或超过${VERIFIER_ERROR_COUNT_ALERT_THRESHOLD}次的阈值`
        : '过去24小时验证器出错次数正常',
    })

    const optOutFailureCount = optOutFailureCounts.get(key) ?? 0
    const optOutAlert = optOutFailureCount > 0
    results.push({
      clientId: combo.clientId,
      channel: combo.channel,
      checkType: 'optout_write_failed',
      healthy: !optOutAlert,
      detail: optOutAlert
        ? `过去24小时有${optOutFailureCount}次退订登记写入失败，这些客户的拒联状态可能没有被真正记住，还可能继续被联系`
        : '过去24小时退订登记写入正常',
    })
  }

  // 孤儿告警修复：把「当前有活跃告警、但这一轮完全查不到消息」的组合补回来，
  // 否则它们不会出现在上面的循环里，`conversation_health_alerts` 里的旧告警
  // 会永远留在表里，pm-daily-todo 上挂一条再也不会消失的旧问题。
  const alertRows = await fetchAll<{ client_id: string; channel: string }>((from, to) =>
    supabase.from('conversation_health_alerts').select('client_id, channel').range(from, to),
  )
  const orphanCombos = new Map<string, { clientId: string; channel: string }>()
  for (const row of alertRows) {
    const key = comboKey(row.client_id, row.channel)
    if (combos.has(key) || orphanCombos.has(key)) continue
    orphanCombos.set(key, { clientId: row.client_id, channel: row.channel })
  }
  for (const { clientId, channel } of orphanCombos.values()) {
    results.push({
      clientId,
      channel,
      checkType: 'webhook_silent',
      healthy: false,
      detail: '过去30天完全没有收到过客户消息，渠道可能已经彻底断开（此前已经在报警，持续未恢复）',
    })
    for (const checkType of ['verifier_block_rate_high', 'verifier_error_rate_high', 'optout_write_failed'] as const) {
      results.push({
        clientId,
        channel,
        checkType,
        healthy: true,
        detail: '过去30天没有新消息，不可能产生新的草稿或退订失败记录，这一项按定义健康',
      })
    }
  }

  return results
}
