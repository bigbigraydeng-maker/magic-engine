/**
 * CRM 发邮件的回执收口（设计稿 docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §9）。
 *
 * 触发：`crm.email_send.attempted`。只有 outcome=unknown（信可能已经发出，但当时没拿到确认）的才会往下走：
 * 等 10 分钟，重新对账，结案就追加一行 sent / failed 回执；还没结案就报错让 Inngest 重试（最多 3 次）。
 * 其余结果（已发出 / 被拦 / 失败）回执早已同步写好，这里直接结束。
 *
 * 🔴 不发信、不改客户数据：只读审计行和邮箱草稿状态，写的只有一行追加型回执。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { CRM_EMAIL_SEND_ATTEMPTED } from '../crm-email-events'
import { findReceiptByRequest, insertReceipt } from '@/lib/crm/email-templates/receipt-store'
import { settleUnknownSend, unknownIdsFromEvent, type SettleDeps, type SettleResult } from '@/lib/crm/email-templates/settle-unknown'
import { reconcileSendRequest } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'

export const SETTLE_AFTER = '10m'

function realDeps(): SettleDeps {
  return {
    findUnknown: (ids) => findReceiptByRequest(supabaseAdmin, ids.clientId, ids.contactId, ids.requestId, 'unknown'),
    reconcile: (ids) => reconcileSendRequest(ids, createMailNewDeps()),
    insert: (receipt) => insertReceipt(supabaseAdmin, receipt),
  }
}

export async function runSettleStep(data: unknown, deps: SettleDeps = realDeps()): Promise<SettleResult> {
  const ids = unknownIdsFromEvent(data)
  if (ids === null) return { status: 'skipped' }
  const result = await settleUnknownSend(ids, deps)
  if (result.status === 'unresolved') throw new Error('这封邮件的发送状态仍未确认，稍后重试。')
  return result
}

/** The slice of Inngest's `step` this function uses (a fake can stand in for it in tests). */
export interface SettleStepTools {
  sleep(id: string, duration: string): Promise<void>
  run(id: string, fn: () => Promise<SettleResult>): Promise<SettleResult>
}

export async function runCrmEmailSendReceipt(
  data: unknown,
  step: SettleStepTools,
  deps?: SettleDeps,
): Promise<SettleResult> {
  if (unknownIdsFromEvent(data) === null) return { status: 'skipped' }
  await step.sleep('wait-before-reconcile', SETTLE_AFTER)
  return step.run('settle', () => runSettleStep(data, deps))
}

export function createCrmEmailSendReceipt(deps?: SettleDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}crm-email-send-receipt`,
      name: 'CRM email: settle a send whose outcome was unknown',
      retries: 3,
    },
    { event: CRM_EMAIL_SEND_ATTEMPTED },
    async ({ event, step }) =>
      runCrmEmailSendReceipt(
        event.data,
        {
          sleep: async (id, duration) => {
            await step.sleep(id, duration)
          },
          run: (id, fn) => step.run(id, fn),
        },
        deps,
      ),
  )
}

export const crmEmailSendReceipt = createCrmEmailSendReceipt()
