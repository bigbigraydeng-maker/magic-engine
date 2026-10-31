/**
 * 广告系列被服务暂停之后，写一封给负责人的信。
 * 收件人只从环境变量来。没配就记「未配置收件人」，不用占位地址。
 * 信里不写倒计时，也不催。
 */

import { meMailFrom } from '@/lib/email/sender'

export const STOP_PAUSE_EVENT = 'ads.service_pause.completed'

const URGENCY = /尽快|马上|紧急|立刻|催|倒计时|请立即|赶紧|ASAP|urgent/i

export interface StopPauseFacts {
  campaign_name: string
  campaign_id: string
  ad_account_id: string
  spend_today_cents: number | null
  spend_lifetime_cents: number | null
  currency: string
  fault_code: string
  fault_what: string
  as_of: string
}

export interface MailSender {
  send(input: { to: string; subject: string; text: string }): Promise<{ ok: boolean }>
}

export type StopEmailStatus = 'sent' | 'recipient_unconfigured' | 'send_failed'

const FAULT_LABEL: Readonly<Record<string, string>> = {
  over_daily_cap: '超过当天花费上限',
  crm_leads_missing: '线索没有进到客户资料',
  ad_rejected: '广告被拒或有问题',
}

/** 空白或不是邮箱 = 没配。不退回别的收件变量。 */
export function readStopAlertRecipient(env: Record<string, string | undefined>): string | null {
  const raw = env.ME_STOP_ALERT_EMAIL?.trim() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null
  return raw
}

export function formatMinor(cents: number | null, currency: string): string {
  if (cents === null || !Number.isFinite(cents)) return '没读到'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(cents))
  return `${currency} ${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function formatNz(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '没读到'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function faultLabel(code: string): string {
  return code.split('+').map(part => FAULT_LABEL[part] ?? part).join('，')
}

/** 固定这几句。调用方可以再检查里面没有催促字眼。 */
export function buildStopNotice(facts: StopPauseFacts): { subject: string; text: string } {
  const text = [
    '广告系列已经暂停。',
    `系列：${facts.campaign_name}（编号 ${facts.campaign_id}）`,
    `账户：${facts.ad_account_id}`,
    `当天花费：${formatMinor(facts.spend_today_cents, facts.currency)}`,
    `累计花费：${formatMinor(facts.spend_lifetime_cents, facts.currency)}`,
    `暂停原因：${faultLabel(facts.fault_code)}。${facts.fault_what}`,
    `数据时间：${formatNz(facts.as_of)}（新西兰时间）`,
    '要恢复投放，由负责人在 Magic Engine 里点确认卡。',
  ].join('\n')
  return { subject: `广告系列已经暂停：${facts.campaign_name}`, text }
}

export function noticeHasUrgency(text: string): boolean {
  return URGENCY.test(text)
}

export async function deliverStopNotice(input: {
  facts: StopPauseFacts
  recipient: string | null
  mail: MailSender | null
}): Promise<StopEmailStatus> {
  if (input.recipient === null) return 'recipient_unconfigured'
  if (input.mail === null) return 'send_failed'
  const notice = buildStopNotice(input.facts)
  try {
    const sent = await input.mail.send({ to: input.recipient, subject: notice.subject, text: notice.text })
    return sent.ok ? 'sent' : 'send_failed'
  } catch {
    return 'send_failed'
  }
}

/** 发信客户端在函数里面建，不在模块加载时建。密钥没有 = 发送失败，和「没配收件人」分开。 */
export async function sendStopNoticeWithResend(input: { to: string; subject: string; text: string }): Promise<{ ok: boolean }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false }
  const { Resend } = await import('resend')
  const client = new Resend(key)
  const result = await client.emails.send({
    from: meMailFrom('Magic Engine'),
    to: input.to,
    subject: input.subject,
    text: input.text,
  })
  return { ok: !result.error }
}
