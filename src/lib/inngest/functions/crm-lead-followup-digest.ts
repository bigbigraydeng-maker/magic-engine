/**
 * Inngest 云端消费者：每天一封「客人填了表还没人回」的汇总信。
 *
 * ## 为什么走 Inngest 而不是再加一条 Render cron
 *
 * CLAUDE.md 铁律 3 的 Inngest 硬约束：跨步骤接力 + 外部副作用（发信）默认走
 * Inngest。这里三段都要能单独看见成败 —— 挑名单 / 发信 / 记回执 —— 一条
 * cron 路由里全做完，失败只会剩一行 `console.error`。
 *
 * ## 三段
 *
 *   · `load-clients`        —— 哪些客户接了 Facebook 主页（跟每小时拉线索
 *                              同一道闸：`clients.facebook_page_id` 有值）
 *   · `scan-<clientId>`     —— 每个客户各自挑名单。一个客户炸了不牵连别人。
 *   · `send-<clientId>`     —— 各自发信，拿到机器可读回执。
 *
 * ## 🔴 授权闸（fail-closed）
 *
 * 1. **收件人写死在代码里 = ME 自己的信箱**（`ME_MAIL_TO_ADDRESS`）。
 *    PM 2026-09-24 拍板：第一步只发给自己，看两三天准不准，再决定要不要转给
 *    客户的销售。故意**不**做成环境变量 —— 一个客户的客人名单发到谁手上，
 *    值得一次代码改动 + 一次复审，不该是改一行配置就悄悄变了。
 * 2. **默认不发**。`LEAD_FOLLOWUP_DIGEST_ENABLED=true` 才真发；没配就只挑名单、
 *    只记回执，一封不发（回执里 `sent:false` + `reason:'未启用'`）。
 *    这样上线当天可以先看名单准不准，再打开开关。
 *
 * 这封信只发到 ME 自己的信箱、不外发给客户，所以回执里 `no_publish: true`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { findLeadFollowupDue, LEAD_WINDOW_DAYS } from '@/lib/crm/lead-followup-due'
import { sendLeadFollowupDigest } from '@/lib/crm/lead-followup-digest'

export const LEAD_DIGEST_TZ = 'Pacific/Auckland'
/** 新西兰早上 8 点。 */
export const LEAD_DIGEST_CRON = '0 8 * * *'

/** 环境变量的最小形状 —— 单测传字面量对象即可，不用去骗 `NodeJS.ProcessEnv`。 */
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
  /** 窗口之外、同样没人回的积压人数。 */
  readonly backlog: number
  readonly sent: boolean
  readonly reason?: string
  readonly recipients: string[]
  /** 这封信有没有外发给客户。本函数恒为 true（只发到 ME 自己的信箱）。 */
  readonly no_publish: true
  readonly created_at: string
}

export interface LeadFollowupDigestReceipt {
  readonly clients_scanned: number
  readonly clients_with_items: number
  readonly emails_sent: number
  readonly enabled: boolean
  readonly results: LeadFollowupClientReceipt[]
}

interface ClientRow {
  id: string
  name: string | null
  facebook_page_id: string | null
}

export interface LeadFollowupDigestDeps {
  supabase: SupabaseClient
  findDue: typeof findLeadFollowupDue
  sendDigest: typeof sendLeadFollowupDigest
  env?: DigestEnv
}

/** `step.run` 的最小形状 —— 单测注入假 step，不跑真 Inngest。 */
export interface DigestStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

/**
 * 编排本体。跟 Inngest 装配分开，单测可以直接调 —— 装配（触发器/重试/并发）
 * 和流程（谁先跑、一个客户炸了怎么办）是两件事，分开测才测得准。
 */
export async function runLeadFollowupDigest(
  step: DigestStep,
  deps: LeadFollowupDigestDeps,
): Promise<LeadFollowupDigestReceipt> {
  const env = deps.env ?? process.env
  const enabled = digestEnabled(env)

  const clients = await step.run('load-clients', async () => {
    const { data, error } = await deps.supabase
      .from('clients')
      .select('id, name, facebook_page_id')
      .not('facebook_page_id', 'is', null)
    if (error) throw new Error(`[lead-followup-digest] 读客户清单失败: ${error.message}`)
    return (data ?? []) as ClientRow[]
  })

  const results: LeadFollowupClientReceipt[] = []

  for (const client of clients) {
    // 每个客户一段。一个客户的数据坏掉，不该让别的客户今天收不到提醒。
    const receipt = await step.run(`scan-and-send-${client.id}`, async (): Promise<LeadFollowupClientReceipt> => {
      const createdAt = new Date().toISOString()
      const base = {
        client_id: client.id,
        client_name: client.name,
        recipients: [ME_MAIL_TO_ADDRESS],
        no_publish: true as const,
        created_at: createdAt,
      }
      try {
        const due = await deps.findDue(deps.supabase, client.id, new Date())
        if (due.items.length === 0) {
          return { ...base, listed: 0, dropped: due.dropped, backlog: due.backlog, sent: false, reason: '没有待跟进的表单线索' }
        }
        if (!enabled) {
          // 开关没开：名单照挑、回执照记，就是不发。
          return {
            ...base,
            listed: due.items.length,
            dropped: due.dropped,
            backlog: due.backlog,
            sent: false,
            reason: '未启用（LEAD_FOLLOWUP_DIGEST_ENABLED 不是 true）',
          }
        }
        const sendResult = await deps.sendDigest(client.name ?? '这个客户', due.items, {
          // 🔴 收件人不从配置读 —— 见文件头授权闸第 1 条。
          recipients: [ME_MAIL_TO_ADDRESS],
          dropped: due.dropped,
          backlog: due.backlog,
          windowDays: LEAD_WINDOW_DAYS,
        })
        return {
          ...base,
          listed: due.items.length,
          dropped: due.dropped,
          backlog: due.backlog,
          sent: sendResult.sent,
          ...(sendResult.reason ? { reason: sendResult.reason } : {}),
          recipients: sendResult.recipients,
        }
      } catch (err) {
        // 失败要说人话，而且要留在回执里 —— 不能只剩一行 console。
        return {
          ...base,
          listed: 0,
          dropped: 0,
          backlog: 0,
          sent: false,
          reason: err instanceof Error ? err.message : '挑名单时出现未知错误',
        }
      }
    })
    results.push(receipt)
  }

  return {
    clients_scanned: clients.length,
    clients_with_items: results.filter((r) => r.listed > 0).length,
    emails_sent: results.filter((r) => r.sent).length,
    enabled,
    results,
  }
}

/** 依赖注入版：单测注入假 supabase / 假发信，不碰真数据库、绝不真发信。 */
export function createLeadFollowupDigestFunction(deps: LeadFollowupDigestDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}crm-lead-followup-digest`,
      name: 'CRM — 客人填了表还没人回，每天提醒一次',
      /**
       * 🔴 `retries: 0`。发信**不是幂等的**：重试一次，收信的人就收到两封
       * 一模一样的名单。宁可今天这封漏掉（明天还会再跑一次，名单只会更长、
       * 不会消失），也不要把一个提醒变成骚扰。
       */
      retries: 0,
      concurrency: { limit: 1 },
    },
    /**
     * 🔴 定时器必须带 `TZ=` —— 不带的话 Inngest 按 UTC 解释，新西兰夏令时一来
     *    这封信就漂到别的时段去了（同 conversion-daily-pipeline 的契约）。
     *    早上 8 点：上班前就躺在信箱里。
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
  sendDigest: sendLeadFollowupDigest,
})
