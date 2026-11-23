/**
 * 成交/咨询「不发送」原因。页面下拉、审核接口、自动过期共用这一份，
 * 避免人在页面上看见的选项和接口肯收的值各写各的。
 */

export const CONVERSION_REJECT_REASONS = [
  { value: 'customer_opted_out', label: '客人明确说过别用他的信息' },
  { value: 'not_real_sale', label: '不是真成交（补开发票之类）' },
  { value: 'duplicate', label: '重复了，同一笔已经有一条' },
  { value: 'past_window', label: '超过时限' },
  { value: 'other', label: '其它（下面写一句）' },
] as const

export type ConversionRejectReason = (typeof CONVERSION_REJECT_REASONS)[number]['value']

/** 自动过期写入的原因码，以及审计里记的规则名。 */
export const PAST_WINDOW_REJECT_REASON = 'past_window' satisfies ConversionRejectReason
export const PAST_WINDOW_RULE = 'past_event_window'

const VALUES: readonly string[] = CONVERSION_REJECT_REASONS.map((r) => r.value)

export function isConversionRejectReason(value: string): value is ConversionRejectReason {
  return VALUES.includes(value)
}
