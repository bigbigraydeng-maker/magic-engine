/**
 * 一句拒绝的话，拒的是「电话」还是「所有联系」。
 *
 * PM 2026-11-09：客人说「不要给我打电话」，不等于「不要联系我」——短信、邮件、WhatsApp
 * 照样可以联系。但任何「所有渠道都别联系」的说法**一律不许被削弱**。
 *
 * 最贵的错：把拒绝所有联系的人判成 `phone_only`（那会把他放给邮件）。所以 `phone_only`
 * 是**白名单**（魏征 2026-11-09 P0）—— 只有下面全部成立才给：
 *   · 有电话说法
 *   · 没有任何全面拒绝说法
 *   · 拿掉电话说法和「明确同意别的渠道」的原文之后，剩下的字里**没有一个风险词**
 * 拿不准一律 `needs_review`（调用方按全面拒绝处理）。
 *
 * 例外：电话说法带回电约定或时间限定（「今天别打，周五回电」「三月前别打」）——
 * 那是约时间，不是拒绝电话，返回 `none`，交给 `classifyNote` 后面的规则。
 * 但只要有风险词，风险词优先（宁可多拦）。
 *
 * 词表在 `refusal-patterns.ts`，本文件只放判断。
 */

import {
  BOOKED_ELSEWHERE_PATTERNS,
  CALLBACK_PATTERNS,
  FULL_REFUSAL_PATTERNS,
  NO_INTEREST_PATTERNS,
  OTHER_CHANNEL_OK_PATTERNS,
  PHONE_ONLY_PATTERNS,
  RISK_WORD_PATTERNS,
  TIME_LIMIT_PATTERNS,
} from './refusal-patterns'

export type RefusalScope = 'phone_only' | 'all' | 'needs_review' | 'none'

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

/**
 * 把命中的原文都换成空格。全局替换用的是**本地新建**的带 `g` 副本，
 * 词表里的原正则不带 `g`、也不被改动。
 */
function stripAll(text: string, patterns: RegExp[]): string {
  return patterns.reduce((acc, p) => acc.replace(new RegExp(p.source, `${p.flags}g`), ' '), text)
}

/**
 * 「没兴趣 / 已经在别家订了」也算风险词（魏征 2026-11-09 P0-1）：旧代码把
 * 「not interested do not call」判成 not_interested，邮件和 Mailchimp 都停；
 * 判成只别打电话会把他放回邮件名单。
 */
const PHONE_RISK_PATTERNS: RegExp[] = [...RISK_WORD_PATTERNS, ...NO_INTEREST_PATTERNS, ...BOOKED_ELSEWHERE_PATTERNS]

/** 有电话说法、没有全面拒绝时，剩下的字决定是只别打电话、约时间，还是要人看。 */
function phoneScope(t: string): RefusalScope {
  const rest = stripAll(t, PHONE_ONLY_PATTERNS)
  const restForRisk = stripAll(rest, OTHER_CHANNEL_OK_PATTERNS)
  if (anyMatch(restForRisk, PHONE_RISK_PATTERNS)) return 'needs_review'
  if (anyMatch(rest, CALLBACK_PATTERNS) || anyMatch(rest, TIME_LIMIT_PATTERNS)) return 'none'
  return 'phone_only'
}

export function classifyRefusalScope(raw: string | null | undefined): RefusalScope {
  const t = (raw ?? '').trim()
  if (!t) return 'none'

  const phone = anyMatch(t, PHONE_ONLY_PATTERNS)
  const full = anyMatch(t, FULL_REFUSAL_PATTERNS)

  if (full) {
    if (phone || anyMatch(t, OTHER_CHANNEL_OK_PATTERNS)) return 'needs_review'
    return 'all'
  }
  if (!phone) return 'none'
  return phoneScope(t)
}
