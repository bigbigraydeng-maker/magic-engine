/**
 * Inngest 云端消费者：每天一封「客人填了表还没人回」的汇总信。
 *
 * ## 为什么走 Inngest 而不是再加一条 Render cron
 *
 * CLAUDE.md 铁律 3 的 Inngest 硬约束：跨步骤接力 + 外部副作用（发信）默认走
 * Inngest。这里每一段都要能单独看见成败 —— 挑名单 / 数积压 / 发信 / 记回执 ——
 * 一条 cron 路由里全做完，失败只会剩一行 `console.error`。
 *
 * ## 每个客户三段
 *
 *   · `scan-<clientId>`     —— 窗口内该逐条列的名单
 *   · `backlog-<clientId>`  —— 窗口外的积压数字。**单独一段、单独兜底**：
 *                              它是最贵、最可能出错的一次查询，而产出只是正文里
 *                              一个数字。跟名单绑在一起的话，这个数字算不出来
 *                              会把必须送达的名单一起带走。算不出来就传 `null`，
 *                              正文里照说「这次没算出来」，不当 0。
 *   · `send-<clientId>`     —— 发信，拿到机器可读回执
 *
 * ## 🔴 授权闸（fail-closed）
 *
 * 1. **收件人是本文件里的一个字面量常量** `DIGEST_RECIPIENT`。
 *    PM 2026-09-24 拍板：第一步只发给自己，看两三天准不准，再决定要不要转给
 *    客户的销售。
 *    🔴 **刻意不用 `ME_MAIL_TO_ADDRESS`**：那个常量读 `ME_MAIL_TO` 环境变量，
 *       而且是全站共用的（联系表单、cron 摘要、今日待办都读它）。用它就等于
 *       「改一行配置就能把每个客户的客人名单发到任意地址」，跟本文件承诺的
 *       「要改得走一次代码改动 + 一次复审」正好相反（魏征复审 2026-09-24）。
 * 2. **默认不发**。`LEAD_FOLLOWUP_DIGEST_ENABLED=true` 才真发；没配就只挑名单、
 *    只记回执，一封不发。这样上线当天可以先看名单准不准，再打开开关。
 *
 * ## 这封信自己也要能被看见死没死
 *
 * 每趟写一条 `cron_run_logs`（`job_name = crm-lead-followup-digest`），整份回执
 * 进 `summary`；重试耗尽仍失败时 `onFailure` 把停在「在跑」的那行收成失败。
 * 没有这两样，「今天信箱里没信」和「今天本来就没事」在系统里分不出来 ——
 * 而开关默认是关的，所以「没信」本来就是预期状态，更需要有地方能查。
 * 同时登记进 `cron/registry`，否则新函数忘了在 Inngest 后台重新 Sync 时，
 * 它会**安静地不跑**。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  countLeadFollowupBacklog,
  findLeadFollowupDue,
  LEAD_WINDOW_DAYS,
} from '@/lib/crm/lead-followup-due'
import { sendLeadFollowupDigest } from '@/lib/crm/lead-followup-digest'

export const LEAD_DIGEST_JOB = 'crm-lead-followup-digest'
export const LEAD_DIGEST_TZ = 'Pacific/Auckland'
/** 新西兰早上 8 点 —— 上班前就躺在信箱里。 */
export const LEAD_DIGEST_CRON = '0 8 * * *'
/**
 * 🔴 唯一收件人。见文件头授权闸第 1 条 —— 这是字面量，不是环境变量，
 *    改它必须改代码、过一次复审。
 */
export const DIGEST_RECIPIENT = 'hello@magicengine.cloud'

/** 环境变量的最小形状 —— 单测传字面量对象即可。 */
export type DigestEnv = Record<string, string | undefined>

/** 开关。没配 / 不是字面 `true` 一律当没开 —— 默认不发。 */
export function digestEnabled(env: DigestEnv = process.env): boolean {
  return env.LEAD_FOLLOWUP_DIGEST_ENABLED === 'true'
}

/** 一个客户这一轮的回执。机器可读，用来回答「昨天到底发没发、发给谁、几条」。 */
export interface LeadFollowupClientReceipt {
  readonly client_id: string
  readonly client_name: string | null
  /** 逐条列进信里的条数。 */
  readonly listed: number
  /** 窗口内被上限压掉的条数。 */
  readonly dropped: number
  /** 窗口外的积压人数。`null` = 这次没算出来（不是 0）。 */
  readonly backlog: number | null
  /** 表单触点指向的人在 `contacts` 里查不到的条数 —— 不静默跳过。 */
  readonly orphans: number
  readonly sent: boolean
  readonly reason?: string
  readonly recipients: string[]
  /** 发信服务那边的凭据 id，用来对账。拿不到就没有，不编。 */
  readonly provider_message_id?: string
  /** 这封信有没有外发给客户。收件人是 ME 自己的信箱，所以恒为 true。 */
  readonly no_publish: true
  readonly created_at: string
}

export interface LeadFollowupDigestReceipt {
  readonly job: string
  readonly clients_scanned: number
  readonly clients_with_items: number
  readonly emails_sent: number
  readonly enabled: boolean
  readonly results: LeadFollowupClientReceipt[]
}

interface ClientRow {
  id: string
  name: string | null
}

export interface LeadFollowupDigestDeps {
  supabase: SupabaseClient
  findDue: typeof findLeadFollowupDue
  countBacklog: typeof countLeadFollowupBacklog
  sendDigest: typeof sendLeadFollowupDigest
  env?: DigestEnv
}

/** `step.run` 的最小形状 —— 单测注入假 step，不跑真 Inngest。 */
export interface DigestStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

/** 扫一个客户并（在开关打开时）发信。永不抛异常 —— 一个客户不牵连别人。 */
async function scanAndSendForClient(
  step: DigestStep,
  deps: LeadFollowupDigestDeps,
  client: ClientRow,
  enabled: boolean,
  now: Date,
): Promise<LeadFollowupClientReceipt> {
  const base = {
    client_id: client.id,
    client_name: client.name,
    recipients: [DIGEST_RECIPIENT],
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const due = await step.run(`scan-${client.id}`, async () => {
    try {
      const r = await deps.findDue(deps.supabase, client.id, now)
      return { ok: true as const, ...r }
    } catch (err) {
      return { ok: false as const, reason: errText(err, '挑名单时出现未知错误') }
    }
  })
  if (!due.ok) {
    return { ...base, listed: 0, dropped: 0, backlog: null, orphans: 0, sent: false, reason: due.reason }
  }

  // 积压单独一段、单独兜底 —— 见文件头。算不出来是 null，不是 0。
  const backlog = await step.run(`backlog-${client.id}`, async () => {
    try {
      return await deps.countBacklog(deps.supabase, client.id, now)
    } catch (err) {
      console.warn(`[${LEAD_DIGEST_JOB}] 积压数算不出来 clientId=${client.id}:`, err)
      return null
    }
  })

  const counts = {
    listed: due.items.length,
    dropped: due.dropped,
    backlog: backlog?.backlog ?? null,
    orphans: due.orphans,
  }

  if (due.items.length === 0) {
    // 窗口内没有新的没人回的 → 不发信（不制造每天一封的背景噪音），
    // 但积压数字必须留在回执里，不能只说「没有待跟进的线索」。
    const tail = counts.backlog === null
      ? '；窗口外的积压这次没算出来'
      : counts.backlog > 0
        ? `；窗口外仍有 ${counts.backlog} 个积压（要不要补送是单独的决定）`
        : ''
    return { ...base, ...counts, sent: false, reason: `窗口内没有新的待跟进表单线索${tail}` }
  }

  if (!enabled) {
    return {
      ...base,
      ...counts,
      sent: false,
      reason: '未启用（LEAD_FOLLOWUP_DIGEST_ENABLED 不是 true）',
    }
  }

  return step.run(`send-${client.id}`, async () => {
    const r = await deps.sendDigest(client.name ?? '这个客户', due.items, {
      // 🔴 字面量常量，不读配置 —— 见文件头授权闸第 1 条。
      recipients: [DIGEST_RECIPIENT],
      dropped: due.dropped,
      backlog: counts.backlog,
      backlogLookbackDays: backlog?.lookbackDays,
      windowDays: LEAD_WINDOW_DAYS,
      now,
    })
    return {
      ...base,
      ...counts,
      sent: r.sent,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.messageId ? { provider_message_id: r.messageId } : {}),
      recipients: r.recipients,
    }
  })
}

/**
 * 编排本体。跟 Inngest 装配分开，单测可以直接调 —— 装配（触发器/重试/并发）
 * 和流程（谁先跑、一个客户炸了怎么办）是两件事，分开测才测得准。
 */
export async function runLeadFollowupDigest(
  step: DigestStep,
  deps: LeadFollowupDigestDeps,
  now: Date = new Date(),
): Promise<LeadFollowupDigestReceipt> {
  const enabled = digestEnabled(deps.env ?? process.env)

  const started = await step.run('log-start', async () => ({
    runId: await startCronRunId(LEAD_DIGEST_JOB),
    startedAt: Date.now(),
  }))
  const run = cronRunHandle(LEAD_DIGEST_JOB, started.runId, started.startedAt)

  let clients: ClientRow[]
  try {
    // 跟每小时拉线索同一道闸：`clients.facebook_page_id` 有值才有表单线索进来。
    // ⚠️ 这道闸只问「有没有绑主页」，不问「还在不在服务期」。现在只发到 ME 自己的
    //    信箱所以无害；**收件人改成客户销售的那一刻这会变成真问题**，届时必须重审。
    clients = await step.run('load-clients', async () =>
      fetchAll<ClientRow>((from, to) =>
        deps.supabase
          .from('clients')
          .select('id, name')
          .not('facebook_page_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    )
  } catch (err) {
    const message = errText(err, '读客户清单失败')
    await step.run('log-finish-failed', async () => {
      await run.finish({ error: `[${LEAD_DIGEST_JOB}] ${message}` })
      return null
    })
    throw new Error(`[${LEAD_DIGEST_JOB}] 读客户清单失败: ${message}`)
  }

  const results: LeadFollowupClientReceipt[] = []
  for (const client of clients) {
    results.push(await scanAndSendForClient(step, deps, client, enabled, now))
  }

  const receipt: LeadFollowupDigestReceipt = {
    job: LEAD_DIGEST_JOB,
    clients_scanned: clients.length,
    clients_with_items: results.filter((r) => r.listed > 0).length,
    emails_sent: results.filter((r) => r.sent).length,
    enabled,
    results,
  }

  await step.run('log-finish', async () => {
    await run.finish({
      processed: receipt.clients_scanned,
      completed: receipt.emails_sent,
      failed: results.filter((r) => r.listed > 0 && !r.sent && enabled).length,
      summary: { ...receipt },
    })
    return null
  })

  return receipt
}

/** 依赖注入版：单测注入假 supabase / 假发信，不碰真数据库、绝不真发信。 */
export function createLeadFollowupDigestFunction(deps: LeadFollowupDigestDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}${LEAD_DIGEST_JOB}`,
      name: 'CRM — 客人填了表还没人回，每天提醒一次',
      /**
       * 🔴 敢重试的依据是 **step 记忆化**，不是「发信幂等」。
       *
       * Inngest 重试从上一个成功的 step 续跑，已完成的 `step.run` 直接回放
       * 记下的结果、不会重新执行 —— 所以 `send-<clientId>` 跑成功过就不会再发
       * 第二封。早前写 `retries: 0` 的理由（「发信不幂等」）是错的，代价却是确定的：
       * 一次数据库抖动 = 当天一封不发。
       *
       * ⚠️ Inngest 的 retries 只能设在**函数级**，不能按 step 设。
       */
      retries: 2,
      // 巡检不该跟自己撞车——上一轮还没跑完，下一轮的 cron 触发就不该并发跑。
      concurrency: { limit: 1 },
      onFailure: async ({ event, error }) => {
        const message = error?.message
          || (event.data as { error?: { message?: string } } | undefined)?.error?.message
          || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(LEAD_DIGEST_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    /**
     * 🔴 定时器必须带 `TZ=` —— 不带的话 Inngest 按 UTC 解释，新西兰夏令时一来
     *    这封信就漂到别的时段去了（同 conversion-daily-pipeline 的契约）。
     */
    { cron: `TZ=${LEAD_DIGEST_TZ} ${LEAD_DIGEST_CRON}` },
    async ({ step }): Promise<LeadFollowupDigestReceipt> =>
      runLeadFollowupDigest(
        {
          // Inngest 把记忆化结果标成 Jsonify<T>。本函数每个 step 的返回值都是
          // 纯 JSON（客户行、计数、字符串），Jsonify<T> 与 T 同形。
          run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
        },
        deps,
      ),
  )
}

/** 生产实例。 */
export const crmLeadFollowupDigest = createLeadFollowupDigestFunction({
  supabase: supabaseAdmin,
  findDue: findLeadFollowupDue,
  countBacklog: countLeadFollowupBacklog,
  sendDigest: sendLeadFollowupDigest,
})
