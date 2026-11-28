/** Sends one weekly follow-up report. Never throws. The caller names the recipients; none = nothing is sent. */

import { sendDigestMail, type DigestMailer, type DigestSendResult } from '@/lib/crm/digest-shared'
import { buildWeeklyBody, buildWeeklySubject, type WeeklyReport } from './weekly-report'

export async function sendWeeklyFollowupReport(params: {
  report: WeeklyReport
  timeZone: string
  recipients: string[]
  apiKey?: string
  mailerFactory?: (apiKey: string) => DigestMailer
  /** One report per client per week: a retry after "accepted but not recorded" does not send twice. */
  idempotencyKey?: string
}): Promise<DigestSendResult> {
  const { recipients } = params
  if (recipients.length === 0) return { sent: false, reason: '没有收件人（调用方必须显式指定，本函数不猜）', recipients }
  return sendDigestMail({
    fromLabel: 'Magic Engine Weekly Follow-up',
    recipients,
    subject: buildWeeklySubject(params.report),
    html: buildWeeklyBody(params.report, params.timeZone),
    apiKey: params.apiKey,
    mailerFactory: params.mailerFactory,
    idempotencyKey: params.idempotencyKey,
  })
}
