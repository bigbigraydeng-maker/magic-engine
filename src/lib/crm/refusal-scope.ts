/**
 * 一句拒绝的话，拒的是「电话」还是「所有联系」。
 *
 * PM 2026-11-09：客人说「不要给我打电话」，不等于「不要联系我」——短信、邮件、WhatsApp
 * 照样可以联系。但 `note-parser.ts` 的 `DNC_PATTERNS` 把「不要电话」「do not like phone
 * call」「只邮件联系」都当成「别再联系」，勾上就是全渠道永久拦截（2026-11-09 实测误伤：
 * 「不想我们回电话，但请发 2027 目录」「不喜欢电话，要跟进 Best of China」）。
 *
 * 本文件**只是一个纯判断函数，第 1 刀不接进任何线上逻辑**：线上 `classifyNote` 仍是旧行为。
 * 原因：如果先把解析器改成「只别打电话」而电话那一侧的拦截（第 2 刀）还没接上，
 * 中间这段时间一句「不要电话」会既不拦邮件也不拦电话——那比现在更糟。
 * 本函数现在只给只读试跑脚本用：列出「按新规则会被改判的存量」，让 PM 先看名单。
 *
 * 判法的原则（跟 `DNC_PATTERNS` 一致）：拿不准，往「多拦」的方向。
 *   · 只有**明确**说电话的说法，才会判成 `phone_only`
 *   · 同一句里既有「只别打电话」的意思、又有任何一种全面拒绝 → `needs_review`，由员工看，不自动判
 *   · 全面拒绝的说法维持原样（含 `does not want to talk`：它说不清是别打电话还是别联系）
 *
 * ⚠️ 正则都只有 `i` 标志：带 `g` 的 `.test()` 会记住 `lastIndex`，第二次调用时对时错。
 */

import { DNC_PATTERNS } from './note-parser'

/** 明确只说「电话」的拒绝。 */
const PHONE_ONLY_PATTERNS: RegExp[] = [
  /不要(打)?电话/,
  /只(要)?邮件联系/,
  /do\s*not\s*(like|want)\s*(phone|call)/i,
  /does\s*not\s*(like|want)\s*(to\s*)?(phone|(us\s*to\s*)?call)/i,
  /(do\s*not|don'?t)\s*(want\s*)?(us\s*to\s*)?(call|phone)\s*(me|back|again)?/i,
]

/** 「只要邮件 / 只要资料」一类：说明他愿意走别的渠道，但没说清是不是拒绝电话。 */
const OTHER_CHANNEL_OK_PATTERNS: RegExp[] = [
  /(just|only)\s*(need|want)\s*(the\s*)?(email|e-mail|information|info)/i,
  /只(要|需要)(邮件|资料|信息)/,
  /(please\s*)?send\s*(us\s*)?(the\s*|our\s*)?(2027\s*)?(catalog|catalogue|brochure|email)/i,
]

/** 把已归入电话的几条从全面拒绝里拿掉，剩下的才是「全面拒绝」。 */
const PHONE_SOURCES = new Set(
  [
    String.raw`do\s*not\s*(like|want)\s*(phone|call)`,
    '不要(打)?电话',
    '只邮件联系',
  ],
)
const FULL_REFUSAL_PATTERNS: RegExp[] = DNC_PATTERNS.filter((p) => !PHONE_SOURCES.has(p.source))

export type RefusalScope = 'phone_only' | 'all' | 'needs_review' | 'none'

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

export function classifyRefusalScope(raw: string | null | undefined): RefusalScope {
  const t = (raw ?? '').trim()
  if (!t) return 'none'

  const phone = anyMatch(t, PHONE_ONLY_PATTERNS)
  const full = anyMatch(t, FULL_REFUSAL_PATTERNS)
  const otherChannel = anyMatch(t, OTHER_CHANNEL_OK_PATTERNS)

  if (phone && full) return 'needs_review'
  if (phone) return 'phone_only'
  if (full && otherChannel) return 'needs_review'
  if (full) return 'all'
  return 'none'
}
