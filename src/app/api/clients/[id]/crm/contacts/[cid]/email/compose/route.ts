/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose
 *
 * 在 CRM 里给一个**还没有邮件往来**的客人发第一封邮件（真人点发送才会调）。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md
 *
 * Body: { subject, body, requestId, expectedRecipient, template? }
 *   requestId          前端每个「写邮件」框生成一次的 UUID；双击 / 重试用同一个，服务端据此不重复发
 *   expectedRecipient  抽屉上显示的收件地址；和服务端最终取的不一致就拒发
 *   template           用模板写的信才带：{ key, version, catalogVersion, picks, inputs, callBasis }（见 email-templates/request.ts）
 *
 * 所有的闸（开关、只发给咨询过的人、别再联系、配额、防重复、模板版本、文字检查、7 天频次…）都在 `sendMailNew` 里，
 * 这里只做鉴权和翻译，并在拿到结果后**立刻**记一份回执（用了版本化设置的客户才记；旧配置客户行为不变）。
 *
 * Responses: 200 { ok, messageId, conversationId, duplicate? } / 400 / 401 / 403 / 404 / 409 / 424 / 429 / 502 / 503
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { parseTemplateRequest } from '@/lib/crm/email-templates/request'
import { emptyMeta, type TemplateRequest } from '@/lib/crm/email-templates/send-gates'
import { recordSendAttemptProd } from '@/lib/crm/email-templates/send-record-prod'
import { SendStartedError, sendMailNew, type SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'

interface RouteParams {
  params: { id: string; cid: string }
}

const CRASH_MESSAGE = '系统出错了，这封邮件有没有发出去还不确定。请先到时间线确认，别重复发送。'
const NOT_SENT_MESSAGE = '系统出错了，这封邮件没有发出。请稍后再试。'

/**
 * 发送已经开始之后抛了异常（SendStartedError）：信可能已经发出，记成「状态不明」（后台会在 10 分钟后对账补一行结论），
 * 不记成失败；它自带回执要的信息，用模板写的和自己写的信都一样记；旧配置客户没有回执（null）。
 * 其余异常（sendMailNew 之外，例如建依赖时出错）：信一定没有发出，也没有审计行可对账——记成「失败」，不记「状态不明」
 * （否则这条「不明」永远收不了口，还会让同一份模板对这位客人冷却拦着），且只有用模板写的信才记，和以前一样。
 */
function crashResult(err: unknown, template: TemplateRequest | null): SendMailNewResult | null {
  if (err instanceof SendStartedError) {
    if (err.meta === null) return null
    return { ok: false, status: 503, reason: 'send_unknown', error: CRASH_MESSAGE, meta: { ...err.meta, blockDetail: 'route_exception' } }
  }
  if (template === null) return null
  const meta = { ...emptyMeta(), templateKey: template.key, templateVersion: template.version, blockDetail: 'route_exception' }
  return { ok: false, status: 503, reason: 'internal_error', error: NOT_SENT_MESSAGE, meta }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const sentByEmail = access.user.email?.toLowerCase().trim()
  if (!sentByEmail) {
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    payload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = parseTemplateRequest(payload.template)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, reason: 'invalid_input' }, { status: 400 })
  }
  const template = parsed.template
  const record = { clientId: params.id, contactId: params.cid, requestId: payload.requestId, actorEmail: sentByEmail }

  let result: SendMailNewResult
  try {
    result = await sendMailNew(
      {
        clientId: params.id,
        contactId: params.cid,
        subject: payload.subject,
        body: payload.body,
        sentByEmail,
        requestId: payload.requestId,
        expectedRecipient: payload.expectedRecipient,
        ...(template === null ? {} : { template }),
      },
      createMailNewDeps(params.id),
    )
  } catch (err) {
    console.error('[crm/email/compose] 发送流程抛出异常:', err instanceof Error ? err.message : err)
    const crash = crashResult(err, template)
    if (crash !== null) await recordSendAttemptProd({ ...record, result: crash })
    const message = err instanceof SendStartedError ? CRASH_MESSAGE : NOT_SENT_MESSAGE
    return NextResponse.json({ error: message, reason: 'internal_error' }, { status: 503 })
  }

  await recordSendAttemptProd({ ...record, result })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, conversationId: result.conversationId, duplicate: result.duplicate === true })
}
