/**
 * 已批准、但上次因**授权失效**没发出去的成交/咨询——令牌修好后自动补发
 * （2026-09-22，`conversion-daily-pipeline` 每天在 AI 审核之后调一次）。
 *
 * 为什么要有这一步：`writeback-service.ts` 以前把授权失败判成 `failed_permanent`，
 * CTS 19 条已批准的成交在令牌修好前就过了 7 天窗口，永久丢掉。现在授权失败落
 * `failed` + `last_error_code='auth'` + `next_attempt_at`，这里负责把它们推完。
 *
 * 🔴 只补发 `last_error_code='auth'` 这一档（子牙 2026-09-22 复审 M1）：
 *    授权失败 = Meta 拒了请求、事件没入账，重发不可能双发。
 *    `retry`（限流 / Meta 5xx）那一档**不碰**：5xx 时事件可能已经入账，原设计留给人
 *    去平台后台看一眼再点「再试一次」，机器每天自动点等于把它降级成自动重发。
 *    `in_doubt` 更不碰——那是整套设计的要害，永不自动重发。
 *
 * 🔴 发送本身走 `sendApprovedOutcome()`——跟看板「再试一次」同一套四道闸
 *    （唯一约束 / CAS / post_started_at 抢占 / dry_run 门）。这里不另起一条发送路径。
 *    但只把选中的那一条事件编号传进去。看板按钮不带范围，成交和阶段可以一起补；
 *    这里若也一起补，选中阶段那条时会把上次 5xx（可能已经入账）的成交再发一遍。
 *    超过 7 天窗口的行由状态机自己判 `expired_no_send`，这里不重复判。
 *
 * 🔴 先探活再发：候选里只要有 auth 行，先调一次 `writer.preflight()`（只读，不写任何
 *    东西）。令牌还没修好就整批跳过、不白烧 `attempts`，并把「有 N 条发不出去、最早
 *    一条 X 天后过期」下发成今日待办的人工任务（`conversion-review-items.ts`），
 *    不能只死在 cron summary 里（铁律 3）。
 *
 * 顺带把卡在 `sending` 超过 5 分钟没下文的行推给 `sendApprovedOutcome()`——它会按
 * 既有规则把这种行转成 `in_doubt` 交人核对（绝不重发）。没有这一下的话，进程被强杀
 * 时卡住的那一行没有任何自动路径会再碰它，今日待办也看不到。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientSendConfig } from './destination-writer'
import { sendApprovedOutcome, type SendDeps, type WritebackStatus } from './writeback-service'

/** 一次最多补发这么多条——限制单次运行的最坏影响范围（跟 AI 审核的 MAX_BATCH_SIZE 同理）。 */
export const RESEND_MAX_PER_RUN = 50
/** 审计里的身份：这是状态机重放，不是 AI 判断，不复用 AI_REVIEWER_IDENTITY。 */
export const RESEND_ACTOR = 'writeback-resend@system'
/** 跟 writeback-service 的 STUCK_SENDING_MS 同值——超过这个时长的 `sending` 交给它转 in_doubt。 */
const STUCK_SENDING_MS = 5 * 60_000

export type ResendItem = { outcomeId: string; writebackId: string; status: WritebackStatus; message: string }

export type ResendSummary = {
  /** 挑出来的候选数（auth 失败 + 卡住的 sending）。 */
  candidates: number
  /** 令牌探活：没有 auth 候选时不探（null）。 */
  preflightOk: boolean | null
  /** 探活没过、这次整批跳过的 auth 行数。 */
  skippedTokenDead: number
  sent: number
  expired: number
  stillFailed: number
  inDoubt: number
  other: number
  items: ResendItem[]
  errors: Array<{ outcomeId: string; error: string }>
}

type CandidateRow = {
  id: string
  outcome_id: string
  event_id: string | null
  status: string
  last_error_code: string | null
  next_attempt_at: string | null
  last_attempt_at: string | null
}

export type ResendDeps = {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase'>
  now?: Date
}

/**
 * 找本客户已批准、且发送记录停在「授权失败可重试」或「卡在发送中」的行。
 * 两段查询、不用嵌套过滤：先按发送记录状态捞，再用 outcome 表按客户/审核状态收口。
 */
async function findCandidates(
  supabase: SupabaseClient,
  clientId: string,
  destination: string,
  now: Date,
): Promise<{ authRows: CandidateRow[]; stuckRows: CandidateRow[] }> {
  const nowIso = now.toISOString()
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS).toISOString()

  const [failedRes, stuckRes] = await Promise.all([
    supabase
      .from('me_conversion_writebacks')
      .select('id, outcome_id, event_id, status, last_error_code, next_attempt_at, last_attempt_at')
      .eq('destination', destination)
      .eq('status', 'failed')
      .eq('last_error_code', 'auth')
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(RESEND_MAX_PER_RUN),
    supabase
      .from('me_conversion_writebacks')
      .select('id, outcome_id, event_id, status, last_error_code, next_attempt_at, last_attempt_at')
      .eq('destination', destination)
      .eq('status', 'sending')
      .lte('last_attempt_at', stuckBefore)
      .limit(RESEND_MAX_PER_RUN),
  ])
  if (failedRes.error) throw new Error(`读取待补发记录失败：${failedRes.error.message}`)
  if (stuckRes.error) throw new Error(`读取卡住的发送记录失败：${stuckRes.error.message}`)

  const all = [...((failedRes.data ?? []) as CandidateRow[]), ...((stuckRes.data ?? []) as CandidateRow[])]
  if (all.length === 0) return { authRows: [], stuckRows: [] }

  // 用 outcome 表收口：只要本客户、已批准、没被删个人信息的。
  const { data: outcomes, error: outcomeErr } = await supabase
    .from('me_sale_outcomes')
    .select('id')
    .eq('client_id', clientId)
    .eq('review_status', 'approved')
    .is('redacted_at', null)
    .in(
      'id',
      all.map((r) => r.outcome_id),
    )
  if (outcomeErr) throw new Error(`读取已批准记录失败：${outcomeErr.message}`)
  const allowed = new Set(((outcomes ?? []) as Array<{ id: string }>).map((o) => o.id))

  const mine = all.filter((r) => allowed.has(r.outcome_id))
  return {
    authRows: mine.filter((r) => r.status === 'failed'),
    stuckRows: mine.filter((r) => r.status === 'sending'),
  }
}

async function loadSendConfig(supabase: SupabaseClient, clientId: string): Promise<ClientSendConfig> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, default_phone_country, facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`读取客户配置失败：${error.message}`)
  if (!data) throw new Error('客户不存在')
  const c = data as { default_phone_country: string | null; facebook_page_id: string | null }
  return { clientId, defaultPhoneCountry: c.default_phone_country, facebookPageId: c.facebook_page_id }
}

function tally(summary: ResendSummary, status: WritebackStatus): void {
  if (status === 'confirmed') summary.sent++
  else if (status === 'expired_no_send') summary.expired++
  else if (status === 'failed') summary.stillFailed++
  else if (status === 'in_doubt') summary.inDoubt++
  else summary.other++
}

export async function runFailedWritebackResend(clientId: string, deps: ResendDeps): Promise<ResendSummary> {
  const { supabase, sendDeps } = deps
  const now = deps.now ?? new Date()
  const summary: ResendSummary = {
    candidates: 0,
    preflightOk: null,
    skippedTokenDead: 0,
    sent: 0,
    expired: 0,
    stillFailed: 0,
    inDoubt: 0,
    other: 0,
    items: [],
    errors: [],
  }

  const { authRows, stuckRows } = await findCandidates(supabase, clientId, sendDeps.writer.kind, now)
  summary.candidates = authRows.length + stuckRows.length

  let toSend: CandidateRow[] = [...stuckRows]
  if (authRows.length > 0) {
    const config = await loadSendConfig(supabase, clientId)
    const pre = await sendDeps.writer.preflight(config, { fetcher: sendDeps.fetcher })
    summary.preflightOk = pre.ok
    if (pre.ok) toSend = [...toSend, ...authRows]
    else summary.skippedTokenDead = authRows.length
  }

  for (const row of toSend) {
    try {
      // 🔴 发送不透传 `now`（判断用的流水线开跑时刻可能已落后十几分钟；状态机要用真实时间
      //    写 `last_attempt_at`，否则「卡在 sending 超过 5 分钟」会被误触发——见
      //    conversion-daily-pipeline.ts 文件头「now 只给判断用」）。
      const result = await sendApprovedOutcome(row.outcome_id, { supabase, ...sendDeps }, {
        eventId: row.event_id ?? row.outcome_id,
      })
      tally(summary, result.status)
      summary.items.push({ outcomeId: row.outcome_id, writebackId: row.id, status: result.status, message: result.message })
      const { error: auditErr } = await supabase.from('me_conversion_audit').insert({
        outcome_id: row.outcome_id,
        writeback_id: row.id,
        action: 'resent',
        actor: RESEND_ACTOR,
        detail: { status: result.status, trigger: row.status === 'sending' ? 'stuck_sending' : 'auth_recovered' },
      })
      // 审计不是安全闸，但它是「机器自动补发碰过这一行」的唯一痕迹——写丢了要喊出来。
      if (auditErr) console.error(`[writeback-resend] 审计写入失败 outcome=${row.outcome_id}：${auditErr.message}`)
    } catch (e) {
      summary.errors.push({ outcomeId: row.outcome_id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return summary
}
