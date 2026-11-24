/**
 * Inngest 云端消费者：每天早上一封「昨天进来多少个咨询、各自问什么」的早报。
 *
 * PM 2026-11-25：「每天自动提醒昨天进来多少 enquiry，大概是关于什么，总结发给 info」。
 * 归类与渲染在 `crm/enquiry-daily-digest` / `crm/enquiry-daily-render`，取数在
 * `crm/enquiry-daily-load`。
 *
 * ## 为什么走 Inngest
 *
 * CLAUDE.md 铁律 3：外部副作用（发信）默认走 Inngest。每个客户「取数 / 发信」
 * 各是一段，成败分别可见；一个客户炸了不牵连别人。
 *
 * ## 🔴 授权闸（fail-closed，同 `crm-lead-followup-digest`）
 *
 * 1. **收件人是本文件里的字面量常量** `ENQUIRY_DIGEST_RECIPIENT`，现在是 ME 自己的
 *    信箱。PM 看过几天样信、确认准了，再**改代码 + 复审 + PM 点头**换成客户信箱
 *    （CTS 的目标信箱是 info@ctstours.co.nz）。刻意不读环境变量：改一行配置就能把
 *    客人名单发去任意地址，正是这道闸要挡的。
 * 2. **默认不发**。`ENQUIRY_DAILY_DIGEST_ENABLED=true` 才真发；没配就只取数、只记回执。
 *
 * ## 自己死没死要能被看见
 *
 * 每趟写一条 `cron_run_logs`（`job_name = crm-enquiry-daily-digest`），整份回执进
 * `summary`；重试耗尽仍失败时 `onFailure` 把停在「在跑」的那行收成失败。
 * 同时登记进 `cron/registry`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { buildEnquiryDigest } from '@/lib/crm/enquiry-daily-digest'
import { dayLabel, sendEnquiryDailyDigest } from '@/lib/crm/enquiry-daily-render'
import {
  loadActiveEnquiryClients,
  loadContactNames,
  loadEnquiryRows,
  yesterdayWindow,
  type DigestClient,
} from '@/lib/crm/enquiry-daily-load'

export const ENQUIRY_DIGEST_JOB = 'crm-enquiry-daily-digest'
export const ENQUIRY_DIGEST_TZ = 'Pacific/Auckland'
/** 新西兰早上 8:15 —— 上班前到；错开 8:00 那封「没人回」汇总信。 */
export const ENQUIRY_DIGEST_CRON = '15 8 * * *'
/** 🔴 唯一收件人。字面量，不是环境变量 —— 见文件头授权闸第 1 条。 */
export const ENQUIRY_DIGEST_RECIPIENT = 'hello@magicengine.cloud'

export const DISABLED_REASON = '未启用（ENQUIRY_DAILY_DIGEST_ENABLED 不是 true）'

export type EnquiryDigestEnv = Record<string, string | undefined>

/** 开关。没配 / 不是字面 `true` 一律当没开。 */
export function enquiryDigestEnabled(env: EnquiryDigestEnv = process.env): boolean {
  return env.ENQUIRY_DAILY_DIGEST_ENABLED === 'true'
}

/** 一个客户这一轮的回执。不带客人姓名、邮箱、电话。 */
export interface EnquiryClientReceipt {
  readonly client_id: string
  readonly client_name: string | null
  readonly day: string
  readonly enquiries: number
  readonly chats: number
  readonly orphans: number
  /** 被排除的 ME 测试线索人数。 */
  readonly test_excluded: number
  readonly sent: boolean
  readonly reason?: string
  readonly recipients: string[]
  readonly provider_message_id?: string
  /** 收件人是 ME 自己的信箱，没有外发给客户。 */
  readonly no_publish: true
  readonly created_at: string
}

export interface EnquiryDigestReceipt {
  readonly job: string
  readonly enabled: boolean
  readonly clients_scanned: number
  readonly emails_sent: number
  readonly results: EnquiryClientReceipt[]
}

export interface EnquiryDigestDeps {
  supabase: SupabaseClient
  loadClients: typeof loadActiveEnquiryClients
  loadRows: typeof loadEnquiryRows
  loadNames: typeof loadContactNames
  send: typeof sendEnquiryDailyDigest
  env?: EnquiryDigestEnv
}

/** `step.run` 的最小形状 —— 单测注入假 step。 */
export interface EnquiryDigestStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

type Scan =
  | { ok: true; enquiries: number; chats: number; orphans: number; testExcluded: number; digest: ReturnType<typeof buildEnquiryDigest> }
  | { ok: false; reason: string }

async function scanClient(deps: EnquiryDigestDeps, client: DigestClient, now: Date): Promise<Scan> {
  try {
    const win = yesterdayWindow(now, ENQUIRY_DIGEST_TZ)
    const rows = await deps.loadRows(deps.supabase, client.id, win)
    const ids = rows.map((r) => r.contact_id).filter((id): id is string => id !== null)
    const names = await deps.loadNames(deps.supabase, client.id, ids)
    const digest = buildEnquiryDigest(rows, names)
    return {
      ok: true,
      enquiries: digest.enquiries.length,
      chats: digest.chats.length,
      orphans: digest.orphans,
      testExcluded: digest.testExcluded,
      digest,
    }
  } catch (err) {
    return { ok: false, reason: errText(err, '取数时出现未知错误') }
  }
}

/** 扫一个客户并（开关打开时）发信。永不抛异常。 */
async function runForClient(
  step: EnquiryDigestStep,
  deps: EnquiryDigestDeps,
  client: DigestClient,
  enabled: boolean,
  now: Date,
): Promise<EnquiryClientReceipt> {
  const day = dayLabel(yesterdayWindow(now, ENQUIRY_DIGEST_TZ).startMs, ENQUIRY_DIGEST_TZ)
  const base = {
    client_id: client.id,
    client_name: client.name,
    day,
    recipients: [ENQUIRY_DIGEST_RECIPIENT],
    no_publish: true as const,
    created_at: now.toISOString(),
  }
  const scan = await step.run(`scan-${client.id}`, () => scanClient(deps, client, now))
  if (!scan.ok) {
    return { ...base, enquiries: 0, chats: 0, orphans: 0, test_excluded: 0, sent: false, reason: scan.reason }
  }
  const counts = {
    enquiries: scan.enquiries,
    chats: scan.chats,
    orphans: scan.orphans,
    test_excluded: scan.testExcluded,
  }
  if (!enabled) {
    return { ...base, ...counts, sent: false, reason: DISABLED_REASON }
  }
  return step.run(`send-${client.id}`, async () => {
    const r = await deps.send({
      clientId: client.id,
      clientName: client.name ?? 'This client',
      day,
      timeZone: ENQUIRY_DIGEST_TZ,
      digest: scan.digest,
      // 🔴 字面量常量，不读配置 —— 见文件头授权闸第 1 条。
      recipients: [ENQUIRY_DIGEST_RECIPIENT],
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

/** 编排本体，跟 Inngest 装配分开，单测可以直接调。 */
export async function runEnquiryDailyDigest(
  step: EnquiryDigestStep,
  deps: EnquiryDigestDeps,
  now: Date = new Date(),
): Promise<EnquiryDigestReceipt> {
  const enabled = enquiryDigestEnabled(deps.env ?? process.env)
  const started = await step.run('log-start', async () => ({
    runId: await startCronRunId(ENQUIRY_DIGEST_JOB),
    startedAt: Date.now(),
  }))
  const run = cronRunHandle(ENQUIRY_DIGEST_JOB, started.runId, started.startedAt)

  let clients: DigestClient[]
  try {
    clients = await step.run('load-clients', () => deps.loadClients(deps.supabase, now))
  } catch (err) {
    const message = errText(err, '读客户清单失败')
    await step.run('log-finish-failed', async () => {
      await run.finish({ error: `[${ENQUIRY_DIGEST_JOB}] ${message}` })
      return null
    })
    throw new Error(`[${ENQUIRY_DIGEST_JOB}] 读客户清单失败: ${message}`)
  }

  const results: EnquiryClientReceipt[] = []
  for (const client of clients) results.push(await runForClient(step, deps, client, enabled, now))

  const receipt: EnquiryDigestReceipt = {
    job: ENQUIRY_DIGEST_JOB,
    enabled,
    clients_scanned: clients.length,
    emails_sent: results.filter((r) => r.sent).length,
    results,
  }
  await step.run('log-finish', async () => {
    await run.finish({
      processed: receipt.clients_scanned,
      completed: receipt.emails_sent,
      // 开关关着时「没发」是预期状态，只把取数失败算失败；开着时没发出去都算。
      failed: results.filter((r) => !r.sent && (enabled || r.reason !== DISABLED_REASON)).length,
      summary: { ...receipt },
    })
    return null
  })
  return receipt
}

/** 依赖注入版：单测注入假 supabase / 假发信。 */
export function createEnquiryDailyDigestFunction(deps: EnquiryDigestDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}${ENQUIRY_DIGEST_JOB}`,
      name: 'CRM — 每日咨询早报（昨天进来几个人、问什么）',
      // 敢重试的依据是 step 记忆化：`send-<clientId>` 成功过就不会再发第二封。
      retries: 2,
      concurrency: { limit: 1 },
      onFailure: async ({ event, error }) => {
        const message = error?.message
          || (event.data as { error?: { message?: string } } | undefined)?.error?.message
          || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(ENQUIRY_DIGEST_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    // 🔴 必须带 TZ=，否则 Inngest 按 UTC 解释，夏令时一换就漂。
    { cron: `TZ=${ENQUIRY_DIGEST_TZ} ${ENQUIRY_DIGEST_CRON}` },
    async ({ step }): Promise<EnquiryDigestReceipt> =>
      runEnquiryDailyDigest(
        { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> },
        deps,
      ),
  )
}

/** 生产实例。 */
export const crmEnquiryDailyDigest = createEnquiryDailyDigestFunction({
  supabase: supabaseAdmin,
  loadClients: loadActiveEnquiryClients,
  loadRows: loadEnquiryRows,
  loadNames: loadContactNames,
  send: sendEnquiryDailyDigest,
})
