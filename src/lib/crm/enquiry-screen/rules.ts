/**
 * 第一层确定性规则（纯函数，不碰网络）。
 *
 * 只做「一眼就能判死」的两件事：主题像自动回复、发件域是群发服务中转。
 * 其余交给模型（classify.ts），模型判完还要过 quote 校验。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md
 */

import { isAutoReply } from '@/lib/microsoft/auto-reply'
import type { NonEnquiryCategory } from './types'

export interface MessageText {
  subject: string | null
  preview: string | null
  fromAddress: string | null
}

export interface RuleVerdict {
  category: NonEnquiryCategory
  reason: string
}

/**
 * 群发服务的中转域名后缀。发件地址落在这些域（或其子域）上，
 * 说明这封信是营销平台代发的，不可能是客人本人写的咨询。
 */
export const RELAY_DOMAIN_SUFFIXES: readonly string[] = [
  'mailchimpapp.com',
  'mcsv.net',
  'rsgsv.net',
  'sendgrid.net',
  'mailgun.org',
  'sparkpostmail.com',
  'amazonses.com',
  'constantcontact.com',
  'createsend.com',
  'klaviyomail.com',
]

/** 取 '@' 之后的域名，小写；没有 '@' 或为空返回 null。 */
function domainOf(address: string | null): string | null {
  if (!address) return null
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address.slice(at + 1).trim().toLowerCase()
  return domain.length > 0 ? domain : null
}

/** 域名等于后缀，或是后缀的子域（`x.mcsv.net` 命中，`notmcsv.net` 不命中）。 */
function matchesRelaySuffix(domain: string): boolean {
  return RELAY_DOMAIN_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith('.' + suffix))
}

/**
 * 第一层：确定性硬否决。命中即「不是咨询」，模型说什么都不改。
 * 认不出来返回 null，交给下一层。
 */
export function layerOneVerdict(m: MessageText): RuleVerdict | null {
  if (isAutoReply(m.subject)) {
    return { category: 'auto_reply', reason: '自动回复（主题）' }
  }
  const domain = domainOf(m.fromAddress)
  if (domain && matchesRelaySuffix(domain)) {
    return { category: 'bulk_marketing', reason: '群发服务中转地址' }
  }
  return null
}

export type EvidenceHit = { hit: true; term: string } | { hit: false }

/** 把一条消息的 subject + preview 拼进同一个 haystack（小写）。 */
function haystackOf(messages: MessageText[]): string {
  return messages.map((m) => `${m.subject ?? ''} ${m.preview ?? ''}`).join(' ').toLowerCase()
}

/** 名字里有没有非 ASCII 字母（中文、日文等）—— 这类名字 \b 不可靠，改用 includes。 */
function hasNonAsciiLetter(name: string): boolean {
  return /[^\x00-\x7F]/.test(name)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 正面证据：正文里出现了询价词，或提到了某位员工的名字。
 * 命中即「这封信在问事」，模型再说「不是咨询」也不筛（宁可漏筛，不错筛真客人）。
 */
export function hasEnquiryEvidence(
  messages: MessageText[],
  opts: { terms: readonly string[]; staffNames: readonly string[] },
): EvidenceHit {
  const haystack = haystackOf(messages)

  for (const raw of opts.terms) {
    const term = raw.toLowerCase()
    if (!term) continue
    if (haystack.includes(term)) return { hit: true, term }
  }

  for (const raw of opts.staffNames) {
    const name = raw.trim().toLowerCase()
    if (name.length < 3) continue
    if (hasNonAsciiLetter(name)) {
      if (haystack.includes(name)) return { hit: true, term: `staff:${raw.trim()}` }
    } else {
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`)
      if (re.test(haystack)) return { hit: true, term: `staff:${raw.trim()}` }
    }
  }

  return { hit: false }
}
