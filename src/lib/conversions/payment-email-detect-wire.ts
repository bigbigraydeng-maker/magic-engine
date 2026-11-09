/**
 * 邮箱付款识别的生产装配：找出开了开关的客户 → 取邮箱令牌 → 跑识别 → 发业务事件。
 *
 * 客户名单来自配置（`clients.leads_config.payment_email_detect.enabled = true`），不写死任何客户；
 * 没配的客户一条都不会碰。识别本身（判定、写库、外发闸）全在 `payment-email-detect-run`。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { inngest } from '@/lib/inngest/client'
import { getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { fetchMessageText } from '@/lib/microsoft/mail-graph'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { metaCapiWriter } from '@/lib/meta/capi/writer'
import { emptySummary, runPaymentEmailDetection, type PaymentDetectSummary } from './payment-email-detect-run'

/** 业务可读事件名（CLAUDE.md §3）：每个客户每次运行有产出时发一条，只带计数，不带任何个人信息。 */
export const PAYMENT_EMAIL_DETECTED_EVENT = 'conversion.payment_email.detected'

export interface DetectAllOptions {
  nowIso: string
  dryRun?: boolean
}

async function enabledClientIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .filter('leads_config->payment_email_detect->>enabled', 'eq', 'true')
  if (error) throw new Error(`读取已开启邮箱付款识别的客户失败：${error.message}`)
  return (data ?? []).map((r) => r.id as string)
}

async function runOne(clientId: string, opts: DetectAllOptions): Promise<PaymentDetectSummary> {
  const { data: conn, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id')
    .eq('client_id', clientId)
    .eq('provider', MICROSOFT_MAIL_PROVIDER)
    .eq('status', CONNECTION_STATUS.ACTIVE)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`读取邮箱连接失败：${error.message}`)
  if (!conn) return { ...emptySummary(opts.dryRun === true), reason: 'no_mailbox' }

  const token = await getValidTokenForConnection(conn.id as string)
  const summary = await runPaymentEmailDetection(clientId, {
    supabase: supabaseAdmin,
    fetchText: (messageId) => fetchMessageText(token, messageId),
    sendDeps: { writer: metaCapiWriter, fetcher: fetch },
    mailboxAddress: (conn.account_id as string | null) ?? null,
    now: new Date(opts.nowIso),
    dryRun: opts.dryRun,
  })
  await emitDetectedEvent(clientId, summary)
  return summary
}

async function emitDetectedEvent(clientId: string, s: PaymentDetectSummary): Promise<void> {
  const produced = s.autoCreated + s.humanQueued + s.needsHuman.length + s.duplicates
  if (s.dryRun || produced === 0) return
  try {
    await inngest.send({
      name: PAYMENT_EMAIL_DETECTED_EVENT,
      data: {
        client_id: clientId,
        auto_created: s.autoCreated,
        auto_approved: s.autoApproved,
        send_statuses: s.autoSendStatuses,
        human_queued: s.humanQueued,
        needs_human: s.needsHuman.length,
        duplicates: s.duplicates,
        no_publish: false,
      },
    })
  } catch (e) {
    // 事件没发出去不该让已经完成的识别回滚；回执仍在 me_conversion_audit 里。
    console.error('[payment-email-detect] event send failed', e instanceof Error ? e.message : e)
  }
}

/** 对所有开了开关的客户各跑一遍；一个客户失败不连坐别的客户。返回 clientId → 汇总（或错误）。 */
export async function runPaymentEmailDetectionForEnabledClients(
  opts: DetectAllOptions,
): Promise<Record<string, PaymentDetectSummary | { error: string }>> {
  const out: Record<string, PaymentDetectSummary | { error: string }> = {}
  for (const id of await enabledClientIds()) {
    try {
      out[id] = await runOne(id, opts)
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return out
}
