/**
 * 「是不是内部邮箱」——广告诊断日报只许发内部（阶段 1），D7 也据此判收件人里有没有客户邮箱。
 *
 * 判据只认**域名**：写死的内部域名清单 + 环境变量 ADMIN_EMAIL_DOMAIN（与后台员工鉴权 whitelist.ts 同一个来源）
 * + ADMIN_EMAILS 里逐个列出的员工邮箱。
 * 🔴 AD_HEALTH_DIGEST_TO / ME_MAIL_TO 这类「收件地址」变量**不自动算内部**——它们被误设成客户邮箱时
 *    会把内部日报发给客户（2026-09-14 魏征实测）。
 * 支持 `Name <a@b.com>` 形式；逗号分隔的多个地址要先拆开再判（这里只判单个地址）。
 */

import { INTERNAL_EMAIL_DOMAINS } from './thresholds'

export function bareAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/)
  return (m ? m[1] : raw).trim().toLowerCase()
}

export function isInternalEmail(raw: string): boolean {
  const address = bareAddress(raw)
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return false
  const domain = address.split('@')[1]
  const envDomain = (process.env.ADMIN_EMAIL_DOMAIN ?? '').trim().toLowerCase()
  const envEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return INTERNAL_EMAIL_DOMAINS.some(d => domain === d) || (!!envDomain && domain === envDomain) || envEmails.includes(address)
}

/** 把「逗号/分号分隔的一串」或数组拆成单个地址。 */
export function splitAddresses(values: Array<string | undefined | null>): string[] {
  return values.flatMap(v => (v ?? '').split(/[,;]/)).map(s => s.trim()).filter(Boolean)
}
