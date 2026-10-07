/**
 * 发信前的频率闸门 —— Inngest 函数（**只读**）。
 *
 * ## 为什么走 Inngest（CLAUDE.md 铁律 3）
 *
 * 这是一次「跨步骤的异步 + 对外部系统的读」：要读客户配置、要按收件人逐个去
 * Mailchimp 数历史、还要把结果落成一条可审计的收据事件。放在请求-响应里做，
 * 一次 500 人的批次会把 HTTP 超时撞穿，而且失败之后没有任何地方能重放。所以
 * 它必须是一个 durable function：每一步 `step.run` 都有稳定的结果，重放不会
 * 把已经数过的收件人再数一遍、也不会把收据发两次（`step.sendEvent` 的 `id`
 * 是幂等的）。
 *
 * ## 这个函数只读
 *
 * 整个链路只有 GET：读 `clients` 配置、读 Mailchimp activity-feed。它**不发信**，
 * 也**不写 Mailchimp**。收据里的 `no_publish: true` / `mailchimp_writes: 0`
 * 是给审计看的，不是修辞。
 *
 * ## 为什么「把被排除的人打标签 / 分群」不在这里
 *
 * 对 Mailchimp 名单的**写**操作（打标签、加/减分群）必须先经 PM 批准 —— 这是
 * 仓库里反复确认过的一条线（`mailchimp-paid-tagging` 是同一条规矩）。所以这里只产出「谁被排除、为什么」，
 * 把「要不要因此改名单」留给一个显式的、经批准的写动作。检查动作本身必须可以
 * 随便重跑、随便预演、随便失败 —— 一旦它会改状态，它就不能在发信前跑。
 *
 * ## 收据事件就是审计记录
 *
 * `EMAIL_FREQUENCY_CAP_CHECKED` 是机器可读的收据，也是这条链路上唯一持久的
 * 审计痕迹。它**不是发信授权**：它只陈述「这个人现在能不能收」。真正决定发不
 * 发、以及要不要对被排除的人做名单操作，是调用方的事。
 *
 * ## 配置缺失一律 fail closed
 *
 * 没有策略（`policy_not_configured`）、没有 audience、没有 API key、配置读不到
 * —— 全部走 `skipped` 分支：**不产出 allowed 名单**。一个猜出来的上限会让本该
 * 被拦下的人收到信，而且日志上看不出这是猜的。宁可让调用方拿不到名单而停下来，
 * 也不能给一份看起来正常的名单。
 *
 * ## PII
 *
 * 收据里当然有邮箱 —— 那是调用方自己给的输入。但错误信息里不回显邮箱（同
 * `tags.ts` / `client.ts`），日志里也不打。
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import {
  EMAIL_FREQUENCY_CAP_CHECK_REQUESTED,
  EMAIL_FREQUENCY_CAP_CHECKED,
} from '../email-events'
import { supabaseAdmin } from '@/lib/supabase'
import { readAudienceId } from '@/lib/mailchimp/audience-config'
import {
  checkRecipientsFrequencyCap,
  parseFrequencyCapPolicy,
  type FrequencyCapPolicy,
} from '@/lib/mailchimp/send-frequency-cap'
import type { MailchimpTagsConfig } from '@/lib/mailchimp/tags'

export const EMAIL_FREQUENCY_CAP_CHECK_FN_ID = `${CLOUD_FN_PREFIX}email-frequency-cap-check`

const Payload = z.object({
  client_id: z.string().uuid(),
  request_id: z.string().min(1).max(200),
  recipients: z.array(z.string().max(320)).min(1).max(500),
})

// ── 配置 ────────────────────────────────────────────────────────────────────

/**
 * 加载一个客户的频率闸门配置。
 *
 * 四种「拿不到配置」的原因分开报，因为它们对运营的含义完全不同：
 *   - `policy_not_configured`：客户还没配上限/窗口 —— 需要人去配。
 *   - `audience_not_configured`：客户明确没配 audience（出口关闭）。
 *   - `api_key_missing`：平台侧环境变量没设 —— 是运维问题，不是客户问题。
 *   - `config_unreadable`：真的读失败（权限、网络、schema）—— 必须如实上报。
 *
 * 这四种都**不产出 allowed 名单**。把「读失败」伪装成「客户就是要默认」是这条
 * 链路上个月刚栽过的跟头。
 */
export type FrequencyCapConfigResult =
  | { status: 'ok'; audienceId: string; policy: FrequencyCapPolicy }
  | {
      status: 'skipped'
      reason:
        | 'policy_not_configured'
        | 'audience_not_configured'
        | 'api_key_missing'
        | 'config_unreadable'
    }

/**
 * 默认配置加载器。
 *
 * audience id 走 `readAudienceId`（全仓唯一入口，见 `audience-config.ts` 头注释：
 * 专列还没 apply 时会降级到 `leads_config`，且只有 42703 才降级）。
 *
 * API key 在**函数体内**读 `process.env`，不在模块顶层 —— 顶层读会在 import 时
 * 就把值冻住，测试和本地跑都没法覆盖。
 *
 * 策略从 `clients.leads_config.email_frequency_cap` 取，经 `parseFrequencyCapPolicy`
 * 解析。**没有默认值**：解析不出来就是 `policy_not_configured`。
 */
export async function loadFrequencyCapConfig(
  clientId: string,
): Promise<FrequencyCapConfigResult> {
  const audience = await readAudienceId(clientId)
  if (!audience.ok) return { status: 'skipped', reason: 'config_unreadable' }
  if (!audience.audienceId) return { status: 'skipped', reason: 'audience_not_configured' }

  const apiKey = process.env.MAILCHIMP_API_KEY ?? ''
  if (!apiKey.trim()) return { status: 'skipped', reason: 'api_key_missing' }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return { status: 'skipped', reason: 'config_unreadable' }

  const cfg = (data?.leads_config ?? {}) as { email_frequency_cap?: unknown }
  const policy = parseFrequencyCapPolicy(cfg.email_frequency_cap)
  if (!policy) return { status: 'skipped', reason: 'policy_not_configured' }

  // 只返回 audienceId 和策略：这个结果会被 Inngest 存进运行记录，密钥不能在里面。
  return { status: 'ok', audienceId: audience.audienceId, policy }
}

// ── 函数 ────────────────────────────────────────────────────────────────────

export interface EmailFrequencyCapDeps {
  loadConfig: (clientId: string) => Promise<FrequencyCapConfigResult>
  check: typeof checkRecipientsFrequencyCap
  /** 在检查那一步里才读密钥，避免它出现在任何 step 的返回值（会被持久化）里。 */
  readApiKey: () => string
}

export function createEmailFrequencyCapFunction(
  deps: EmailFrequencyCapDeps = {
    loadConfig: loadFrequencyCapConfig,
    check: checkRecipientsFrequencyCap,
    readApiKey: () => process.env.MAILCHIMP_API_KEY ?? '',
  },
) {
  return inngest.createFunction(
    {
      id: EMAIL_FREQUENCY_CAP_CHECK_FN_ID,
      name: 'Email: pre-send frequency cap check (read-only)',
      retries: 1,
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: EMAIL_FREQUENCY_CAP_CHECK_REQUESTED },
    async ({ event, step }) => {
      const parsed = Payload.safeParse(event.data)
      if (!parsed.success) return { status: 'invalid_payload' as const }

      const { client_id: clientId, request_id: requestId } = parsed.data

      // 时间戳在 step 里取，重放时稳定 —— 否则每次重试都会得到不同的 checked_at，
      // 收据就不再是「那一次检查」的记录了。
      // 事件 id 带客户和收件人内容摘要：同一个 request_id 换一批人、或两个客户撞 id，
      // 都不会让新的回执被去重吞掉。
      const digest = createHash('sha256')
        .update([...new Set(parsed.data.recipients.map((e) => e.trim().toLowerCase()))].sort().join('\n'))
        .digest('hex')
        .slice(0, 16)
      const eventIdBase = `freqcap:${clientId}:${requestId}:${digest}`

      const stampedAt = await step.run('stamp', () => new Date().toISOString())

      const config = await step.run('load-config', async (): Promise<FrequencyCapConfigResult> => {
        try {
          return await deps.loadConfig(clientId)
        } catch {
          return { status: 'skipped', reason: 'config_unreadable' }
        }
      })

      if (config.status === 'skipped') {
        await step.sendEvent('emit-skipped', {
          name: EMAIL_FREQUENCY_CAP_CHECKED,
          id: `${eventIdBase}:skipped`,
          data: {
            status: 'skipped',
            reason: config.reason,
            request_id: requestId,
            client_id: clientId,
            no_publish: true,
            mailchimp_writes: 0,
            created_at: stampedAt,
          },
        })
        return { status: 'skipped' as const, reason: config.reason, request_id: requestId }
      }

      const receipt = await step.run('check', () =>
        deps.check({
          clientId,
          requestId,
          cfg: { apiKey: deps.readApiKey(), audienceId: config.audienceId },
          policy: config.policy,
          emails: parsed.data.recipients,
          now: new Date(stampedAt),
        }),
      )

      await step.sendEvent('emit-receipt', {
        name: EMAIL_FREQUENCY_CAP_CHECKED,
        id: `${eventIdBase}:checked`,
        data: { status: 'checked', receipt },
      })

      return {
        status: 'checked' as const,
        request_id: requestId,
        scanned: receipt.scanned,
        allowed_count: receipt.allowed_count,
        excluded_count: receipt.excluded_count,
        lookup_failed_count: receipt.lookup_failed_count,
      }
    },
  )
}

export const emailFrequencyCapCheck = createEmailFrequencyCapFunction()
