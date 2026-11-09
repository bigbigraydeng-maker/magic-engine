/**
 * Magic Engine 2.0 · Inngest 云端消费者：F4 conversation.health.heartbeat（issue #1587）
 *
 * 每 6 小时巡检一次私信客服系统是不是安静地停摆了。真正的检查逻辑在
 * `@/lib/messenger-agent/health-heartbeat`（`runConversationHealthChecks`），
 * 本文件只做两件事：
 *
 *   · `run-checks`   —— 跑一遍检查，拿到每个 (client_id, channel, check_type)
 *                       组合现在健不健康。
 *   · `sync-alerts`  —— 让 `conversation_health_alerts` 这张「当前活跃告警」表
 *                       跟检查结果保持一致：不健康就 upsert（`first_detected_at`
 *                       保留原值不覆盖，`last_detected_at`/`detail`/`updated_at`
 *                       刷新成最新一轮），健康就把对应那一行删掉——这张表因此
 *                       自愈，不会无限堆积历史行。
 *
 * pm-daily-todo 是**拉模式**读这张表下发待办（`pushConversationHealthAlertItems`，
 * 见 `manual-items.ts`）——本函数不 `step.sendEvent` 任何完成事件，因为没有下游
 * 消费者会订阅它，不为了「看起来完整」编一个没人订阅的事件。
 *
 * 两个 step 都是副作用，必须各自在 `step.run` 里——理由跟 `flywheel-seo-weekly.ts`
 * 文件头一致：Inngest 在每个 step 边界之后会把函数体从头重放一遍，step 外的代码
 * 每遍都真跑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { runConversationHealthChecks, type HealthCheckResult } from '@/lib/messenger-agent/health-heartbeat'

export interface ConversationHealthHeartbeatReceipt {
  readonly total_checks: number
  readonly unhealthy_count: number
  readonly healthy_count: number
  readonly no_publish: true
}

export interface ConversationHealthHeartbeatDeps {
  runChecks: (supabase: SupabaseClient, now: Date) => Promise<HealthCheckResult[]>
  /**
   * 泛型 `SupabaseClient`（跟 `optout.ts`/`classify.ts` 同一约定），不是
   * `typeof supabaseAdmin`——后者的具体类型太窄，单测想注入一个只实现了
   * `from()`/`eq()`/`upsert()`/`delete()` 这几个方法的假 supabase 会通不过
   * 类型检查，逼着测试代码去改动生产类型签名。
   */
  supabase: SupabaseClient
}

interface AlertKeyRow {
  id: string
  first_detected_at: string
}

const RUN_CHECKS_TIMEOUT_MS = 90_000

/**
 * 把错误（含 `cause` 链）压成一行可读文本——`fetch failed` 这类错误真正的
 * 原因藏在 `cause` 里（如 `UND_ERR_SOCKET`），只打 `e.message` 会丢掉关键信息。
 * 最多往下钻 3 层，非对象 cause 直接跳过。
 */
/** 去掉报错文字里的网址 / 项目主机名——这行字会进 Inngest 日志，项目标识不该出现在那里。 */
function redact(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '[url]').replace(/[a-z0-9-]+\.supabase\.(co|com|in)\b/gi, '[host]')
}

export function describeError(e: unknown): string {
  const base = e instanceof Error ? e.message : String(e)
  let out = base
  let cause: unknown = e instanceof Error ? e.cause : undefined
  for (let depth = 0; depth < 3; depth++) {
    if (cause === null || typeof cause !== 'object') break
    const c = cause as { code?: unknown; message?: unknown }
    const code = typeof c.code === 'string' ? c.code : ''
    const message = typeof c.message === 'string' ? c.message : ''
    out += ` <- ${code}${code && message ? ' ' : ''}${message}`
    cause = (cause as { cause?: unknown }).cause
  }
  return redact(out)
}

/** 给一个 promise 套上超时——超时抛错，无论成败都清掉定时器。注意：不会取消底层查询（都是只读，叠加有上限：并发上限 1）。 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超过 ${ms / 1000} 秒`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 依赖注入版：单测注入假的 runChecks + 假 supabase，不碰真数据库。 */
export function createConversationHealthHeartbeatFunction(deps: ConversationHealthHeartbeatDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversation-health-heartbeat`,
      name: 'Governed Reply — F4 conversation health heartbeat',
      // 瞬时网络失败（fetch failed）值得多试几次；写法本身幂等。
      retries: 3,
      // 巡检不该跟自己撞车——上一轮还没同步完，下一轮的 cron 触发就不该并发跑。
      concurrency: { limit: 1 },
    },
    // 错开整点——整点有大批定时任务同时开跑，run-checks 曾因此在 Render→数据库那一跳整批 fetch failed（2026-10-15/16 实测）。
    { cron: '7 */6 * * *' },
    async ({ step }): Promise<ConversationHealthHeartbeatReceipt> => {
      const results = await step.run('run-checks', async () => {
        try {
          return await withTimeout(deps.runChecks(deps.supabase, new Date()), RUN_CHECKS_TIMEOUT_MS, 'run-checks')
        } catch (e) {
          throw new Error(`[conversation-health-heartbeat] run-checks 失败: ${describeError(e)}`)
        }
      })

      await step.run('sync-alerts', async () => {
        const nowIso = new Date().toISOString()
        for (const result of results) {
          if (result.healthy) {
            const { error } = await deps.supabase
              .from('conversation_health_alerts')
              .delete()
              .eq('client_id', result.clientId)
              .eq('channel', result.channel)
              .eq('check_type', result.checkType)
            if (error) {
              throw new Error(
                `[conversation-health-heartbeat] 删除已恢复的告警失败 clientId=${result.clientId} channel=${result.channel} checkType=${result.checkType}: ${error.message}`,
              )
            }
            continue
          }

          // first_detected_at 保留原值不覆盖——先查一次已有行，没有就是这一轮
          // 新出现的告警，first_detected_at 就是现在。
          const { data: existing, error: selectErr } = await deps.supabase
            .from('conversation_health_alerts')
            .select('id, first_detected_at')
            .eq('client_id', result.clientId)
            .eq('channel', result.channel)
            .eq('check_type', result.checkType)
            .maybeSingle()
          if (selectErr) {
            throw new Error(
              `[conversation-health-heartbeat] 查已有告警失败 clientId=${result.clientId} channel=${result.channel} checkType=${result.checkType}: ${selectErr.message}`,
            )
          }

          const firstDetectedAt = (existing as AlertKeyRow | null)?.first_detected_at ?? nowIso

          const { error: upsertErr } = await deps.supabase.from('conversation_health_alerts').upsert(
            {
              client_id: result.clientId,
              channel: result.channel,
              check_type: result.checkType,
              detail: result.detail,
              first_detected_at: firstDetectedAt,
              last_detected_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'client_id,channel,check_type' },
          )
          if (upsertErr) {
            throw new Error(
              `[conversation-health-heartbeat] 写入告警失败 clientId=${result.clientId} channel=${result.channel} checkType=${result.checkType}: ${upsertErr.message}`,
            )
          }
        }
        return null
      })

      const unhealthyCount = results.filter((r) => !r.healthy).length
      return {
        total_checks: results.length,
        unhealthy_count: unhealthyCount,
        healthy_count: results.length - unhealthyCount,
        no_publish: true,
      }
    },
  )
}

/** 生产实例。 */
export const conversationHealthHeartbeat = createConversationHealthHeartbeatFunction({
  runChecks: runConversationHealthChecks,
  supabase: supabaseAdmin,
})
