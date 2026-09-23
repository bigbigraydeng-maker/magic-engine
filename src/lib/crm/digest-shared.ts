/**
 * 汇总信共用的那几件小东西。
 *
 * 为什么单开一个文件：ME 现在有两封形状一样的汇总信 ——
 *   · `email-reply-digest`   客人来信没人回
 *   · `lead-followup-digest` 客人填了表没人回
 * 两封信的转义、脱敏、等待时长、直达链接、发信通道完全一致。第二封如果把
 * 这些抄一遍，日后改一处就漏一处：`stripAddress` 那条脱敏红线只在其中一封
 * 生效，等于没有。所以判定和渲染的公共部分只留一份，两封都从这里拿。
 *
 * 这里**只放两封信都用得上的**。各自的判据、文案、主题行留在各自的文件里。
 */

import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'
import { describeSendError } from '@/lib/ads-strategy/digest'

/** 后台入口（登录后可见），拼客人记录的直达链接用。 */
export const APP_BASE = 'https://app.magicengine.com.au'

/** HTML 转义。客人名字是外部输入，直接拼进正文等于开门。 */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 名字里长得像邮箱地址的那一截。`<>` 不算地址的一部分。 */
const EMAIL_TOKEN = /[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/g

/**
 * 把名字里的邮箱地址掐成 @ 前那一截。
 *
 * 为什么要做这件事：`contacts.display_name` 有一部分来自 Graph 的
 * `from.emailAddress.name`，而 Outlook 在对方没设显示名时会把它填成**邮箱地址
 * 本身** —— 直接渲染就是把客人的联系方式原样复制进一封会被转发的邮件里。
 *
 * 为什么不整条换成「未留姓名」：一批客人全显示「未留姓名」等于名单作废，
 * 销售认不出该先回谁。`wang.customer` 还能认人，但已经不是一个能直接发信的地址。
 */
export function stripAddress(name: string): string {
  const out = name.replace(EMAIL_TOKEN, (addr) => addr.slice(0, addr.indexOf('@'))).trim()
  return out || '未留姓名'
}

/**
 * 等了多久说成人话。
 *
 * 「等了 51 小时」没人能一眼换算，「等了 2 天 3 小时」才有紧迫感。
 * 时间戳解析不出来时说「时间不详」，而不是显示 NaN 或者干脆把这条丢掉 ——
 * 丢掉就等于这位客人从名单上消失了。
 */
export function humanWait(ms: number): string {
  if (!Number.isFinite(ms)) return '时间不详'
  if (ms < 3_600_000) return '不到 1 小时'
  const totalHours = Math.floor(ms / 3_600_000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days === 0) return `${hours} 小时`
  if (hours === 0) return `${days} 天`
  return `${days} 天 ${hours} 小时`
}

/**
 * 直达链接指向 CRM 里这个人的记录，不是收件箱那条线程视图 ——
 * 线程视图明写着「只回不了信、且是付费功能」，点进去会扑空。
 *
 * 🔴 必须是绝对网址。相对路径会被「需要你动手」那栏的链接闸判成 broken，
 *    整条待办被静默丢掉（狄仁杰 2026-08-05 实测 kept=0）。
 */
export function contactUrl(clientId: string, contactId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/all?contact=${encodeURIComponent(contactId)}`
}

/** 发信通道，测试用假件替换，绝不真发。 */
export interface DigestMailer {
  emails: {
    send(payload: {
      from: string
      to: string[]
      subject: string
      html: string
    }): Promise<{ error: unknown }>
  }
}

export interface DigestSendResult {
  sent: boolean
  /** 没发出去的原因，说人话 */
  reason?: string
  /** 这次实际用的收件人（含 fallback 之后的结果），方便调用方记日志 */
  recipients: string[]
}

export function defaultMailer(apiKey: string): DigestMailer {
  return new Resend(apiKey)
}

/**
 * 真正把一封汇总信发出去。**永不抛异常** —— 发信失败不该把上游那趟同步
 * 或那趟巡检一起带崩。
 *
 * 收件人由调用方决定，这里不做 fallback：该退回哪个信箱是各封信自己的策略，
 * 藏在共用层里会让「绝不猜客户地址」这条纪律变得看不见。
 */
export async function sendDigestMail(params: {
  fromLabel: string
  recipients: string[]
  subject: string
  html: string
  apiKey?: string
  mailerFactory?: (apiKey: string) => DigestMailer
}): Promise<DigestSendResult> {
  const { fromLabel, recipients, subject, html } = params
  const apiKey = params.apiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY 未配置', recipients }

  try {
    const mailer = (params.mailerFactory ?? defaultMailer)(apiKey)
    const { error } = await mailer.emails.send({
      from: meMailFrom(fromLabel),
      to: recipients,
      subject,
      html,
    })
    if (error) return { sent: false, reason: describeSendError(error), recipients }
    return { sent: true, recipients }
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : '发信时出现未知错误',
      recipients,
    }
  }
}
