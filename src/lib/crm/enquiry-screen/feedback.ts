/**
 * 销售对「这个人是不是有效咨询」的纠错记录 —— 写在「改阶段」事件的 note 里，格式固定，机器读得回来。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md §5.3.2
 *
 * 为什么放在 note 里：不加表、不加列。每一次人的判决都是一条带标签的样本（退回 / 真客人 + 原因代码
 * + 当时那封信，信在触点里能连回来），将来对账、校准判据都从这里取。
 *
 *   退回：    [退回|<原因代码>] 自由文字
 *   真客人：  [真客人] 自由文字
 */

import { NON_ENQUIRY_CATEGORIES, type NonEnquiryCategory } from './types'

export type ReturnReasonCode = NonEnquiryCategory | 'duplicate_or_test' | 'other'

export const RETURN_REASONS: ReadonlyArray<{ code: ReturnReasonCode; label: string }> = [
  { code: 'solicitation', label: '推销 / 合作邀请' },
  { code: 'bulk_marketing', label: '群发营销' },
  { code: 'system_notice', label: '系统通知' },
  { code: 'auto_reply', label: '自动回复' },
  { code: 'protest', label: '抗议 / 表态' },
  { code: 'duplicate_or_test', label: '重复或测试' },
  { code: 'other', label: '其他' },
]

const CODES: ReadonlySet<string> = new Set(RETURN_REASONS.map((r) => r.code))

export function isReturnReasonCode(v: unknown): v is ReturnReasonCode {
  return typeof v === 'string' && CODES.has(v)
}

const MAX_TEXT = 200

function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT)
}

export function buildReturnNote(code: ReturnReasonCode, text?: string | null): string {
  const t = cleanText(text)
  return t ? `[退回|${code}] ${t}` : `[退回|${code}]`
}

export function buildRealCustomerNote(text?: string | null): string {
  const t = cleanText(text)
  return t ? `[真客人] ${t}` : '[真客人]'
}

export type ParsedFeedback =
  | { kind: 'return'; code: ReturnReasonCode; text: string }
  | { kind: 'real'; text: string }
  | null

const RETURN_RE = /^\[退回\|([a-z_]+)\]\s*([\s\S]*)$/
const REAL_RE = /^\[真客人\]\s*([\s\S]*)$/

export function parseFeedbackNote(note: string | null | undefined): ParsedFeedback {
  if (!note) return null
  const trimmed = note.trim()
  const ret = RETURN_RE.exec(trimmed)
  if (ret) {
    const code = ret[1]
    // 认不出的原因代码当「其他」，不丢这条纠错。
    return { kind: 'return', code: isReturnReasonCode(code) ? code : 'other', text: ret[2].trim() }
  }
  const real = REAL_RE.exec(trimmed)
  if (real) return { kind: 'real', text: real[1].trim() }
  return null
}

/** 5 类里的原因代码，供对账脚本把「人退回的原因」和「机器判的类别」对照。 */
export const MACHINE_CATEGORY_CODES: readonly string[] = NON_ENQUIRY_CATEGORIES
