import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'
import type { CostMetric } from '@/lib/ads-strategy/portfolio/goal-context'
import { metricLabel } from './compare'

export interface EarlyWarningEmailFacts {
  clientName: string
  clientId: string
  entityId: string
  level: 'adset' | 'campaign'
  metric: CostMetric
  accountDay: string
  todayCprMajor: number | null
  baselineCprMajor: number
  spendMajor: number
  currency: string
  zeroResults: boolean
  kind: 'cpl_spike' | 'spend_over_cap_margin'
  capMajor?: number
  forecastOrSpendMajor?: number
}

export type EarlyWarningEmailStatus = 'sent' | 'no_recipients' | 'no_api_key' | 'send_failed'

export interface EarlyWarningMailer {
  send(input: { to: string[]; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>
}

export function buildEarlyWarningSubject(facts: EarlyWarningEmailFacts): string {
  if (facts.kind === 'spend_over_cap_margin') {
    return `【广告提醒】${facts.clientName} 预计日花费将超上限（${facts.accountDay}）`
  }
  return `【广告预警】${facts.clientName} 今日${metricLabel(facts.metric)}偏高（${facts.accountDay}）`
}

export function buildEarlyWarningText(facts: EarlyWarningEmailFacts): string {
  const lines = [
    facts.kind === 'spend_over_cap_margin'
      ? `${facts.clientName} 在 ${facts.accountDay} 的账户花费预计将超过已批准日上限。`
      : `${facts.clientName}：${facts.level === 'adset' ? '广告组' : '广告系列'} ${facts.entityId} 今日 ${metricLabel(facts.metric)} 明显高于近 7 个完整自然日的平均。`,
    facts.kind === 'spend_over_cap_margin'
      ? `预计/当前合计约 ${facts.forecastOrSpendMajor?.toFixed(2)} ${facts.currency}，日上限 ${facts.capMajor?.toFixed(2)} ${facts.currency}。`
      : facts.zeroResults
        ? `今日已花费 ${facts.spendMajor.toFixed(2)} ${facts.currency}，尚无${facts.metric === 'leads' ? '留资' : facts.metric === 'messaging' ? '私信对话' : '成效'}，按规则视为超标。`
        : `今日约 ${facts.todayCprMajor?.toFixed(2)} ${facts.currency}，7 日均约 ${facts.baselineCprMajor.toFixed(2)} ${facts.currency}（超出 20% 阈值）。`,
    '这条只是提醒，系统没有自动暂停或改预算。',
    `详情： https://app.magicengine.com.au/dashboard/clients/${encodeURIComponent(facts.clientId)}/ads-health`,
  ]
  return lines.join('\n')
}

export async function deliverEarlyWarningEmail(
  recipients: string[],
  facts: EarlyWarningEmailFacts,
  mailer?: EarlyWarningMailer,
): Promise<EarlyWarningEmailStatus> {
  if (recipients.length === 0) return 'no_recipients'
  const subject = buildEarlyWarningSubject(facts)
  const text = buildEarlyWarningText(facts)
  if (mailer) {
    const r = await mailer.send({ to: recipients, subject, text })
    return r.ok ? 'sent' : 'send_failed'
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return 'no_api_key'
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: meMailFrom('Magic Engine 广告预警'),
    to: recipients,
    subject,
    text,
  })
  if (error) return 'send_failed'
  return 'sent'
}

export type EarlyWarningChannelResult = EarlyWarningEmailStatus | 'telegram_unconfigured'

export interface EarlyWarningChannels {
  email(to: string[], facts: EarlyWarningEmailFacts): Promise<EarlyWarningChannelResult>
  telegram?(_chatIds: string[], _text: string): Promise<'telegram_unconfigured'>
}

export function defaultEarlyWarningChannels(): EarlyWarningChannels {
  return { email: (to, facts) => deliverEarlyWarningEmail(to, facts), telegram: async () => 'telegram_unconfigured' }
}