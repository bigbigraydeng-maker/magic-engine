/**
 * 「发一封 + 记回执」：CRM 里所有真人点发送的信都走这里（compose 路由、发目录、以后的放行跟进信）。
 * 不另起发信管道：所有闸都在 `sendMailNew`；发信渠道只在 `createMailNewDeps` 那一层，换渠道这里不用改。
 * 设计稿：docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.6
 *
 * 回执：发到那一步的尝试，`sendMailNew` 在锁内先记一份（`recordUnderLock`）；这里拿到结果后再记一次所有结果
 * （被拦的、出错的），同一请求同一结果回执表只留一行。
 */

import { emptyMeta, type TemplateRequest } from './send-gates'
import { recordSendAttemptProd } from './send-record-prod'
import { SendStartedError, sendMailNew, type SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'

export const CRASH_MESSAGE = '系统出错了，这封邮件有没有发出去还不确定。请先到时间线确认，别重复发送。'
export const NOT_SENT_MESSAGE = '系统出错了，这封邮件没有发出。请稍后再试。'

export interface SendTemplateEmailArgs {
  clientId: string
  contactId: string
  /** The signed-in staff member, from the access check. Never read from a request body. */
  actorEmail: string
  requestId: unknown
  subject: unknown
  body: unknown
  expectedRecipient: unknown
  template: TemplateRequest | null
}

/** sendMailNew threw: the answer for the staff member, and whether a mail may have gone out. */
export interface SendCrash {
  crashed: true
  mayHaveSent: boolean
  message: string
}

/**
 * 发送已经开始之后抛了异常（SendStartedError）：信可能已经发出，记成「状态不明」（后台会在 10 分钟后对账补一行结论），
 * 不记成失败；它自带回执要的信息，用模板写的和自己写的信都一样记；旧配置客户没有回执（null）。
 * 其余异常（sendMailNew 之外，例如建依赖时出错）：信一定没有发出，也没有审计行可对账——记成「失败」，不记「状态不明」
 * （否则这条「不明」永远收不了口，还会让同一份模板对这位客人冷却拦着），且只有用模板写的信才记，和以前一样。
 */
export function crashResult(err: unknown, template: TemplateRequest | null): SendMailNewResult | null {
  if (err instanceof SendStartedError) {
    if (err.meta === null) return null
    return { ok: false, status: 503, reason: 'send_unknown', error: CRASH_MESSAGE, meta: { ...err.meta, blockDetail: 'route_exception' } }
  }
  if (template === null) return null
  const meta = { ...emptyMeta(), templateKey: template.key, templateVersion: template.version, blockDetail: 'route_exception' }
  return { ok: false, status: 503, reason: 'internal_error', error: NOT_SENT_MESSAGE, meta }
}

export async function sendTemplateEmail(args: SendTemplateEmailArgs): Promise<SendMailNewResult | SendCrash> {
  const record = { clientId: args.clientId, contactId: args.contactId, requestId: args.requestId, actorEmail: args.actorEmail }
  let result: SendMailNewResult
  try {
    result = await sendMailNew(
      {
        clientId: args.clientId,
        contactId: args.contactId,
        subject: args.subject,
        body: args.body,
        sentByEmail: args.actorEmail,
        requestId: args.requestId,
        expectedRecipient: args.expectedRecipient,
        ...(args.template === null ? {} : { template: args.template }),
      },
      createMailNewDeps(args.clientId),
    )
  } catch (err) {
    console.error('[send-template-email] 发送流程抛出异常:', err instanceof Error ? err.message : err)
    const crash = crashResult(err, args.template)
    if (crash !== null) await recordSendAttemptProd({ ...record, result: crash })
    const mayHaveSent = err instanceof SendStartedError
    return { crashed: true, mayHaveSent, message: mayHaveSent ? CRASH_MESSAGE : NOT_SENT_MESSAGE }
  }
  await recordSendAttemptProd({ ...record, result })
  return result
}
