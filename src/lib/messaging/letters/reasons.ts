/**
 * 原因码 → 人话（服务器翻译，页面直接显示，不再自己翻）。
 * 来自发信设计窗口读数据接口约定 §4；集中放一张表，新增原因码只在这里加。
 * 认不出的原因码一律说「系统出错」，绝不把原码显示给人。
 */

export const LETTER_REASON_TEXT: Readonly<Record<string, string>> = {
  frequency_full: '他最近 7 天已收 2 封',
  dnc: '他要求别再联系',
  mailchimp_suppressed: '他已在 Mailchimp 退订或邮箱无效',
  email_unsubscribed: '他点过退订',
  no_consent_basis: '查不到他同意收信的依据',
  sales_email_exists: '销售已经给他写过信',
  bad_email: '邮箱地址有问题',
  system_address: '邮箱地址有问题',
  not_in_allowlist: '不在试发名单里',
  excluded_tag: '他带着不发信的标记',
  render_failed: '缺少名字，这封信排不出来',
  stale: '超过 3 天没发出去，已作废',
  bounced: '邮箱退回',
  soft_bounced: '暂时没送达',
  quiet_hours: '稍后自动再试',
  lock_busy: '稍后自动再试',
  cap_reached: '今天的发信上限到了，明天继续',
  hard_bounced_address: '这个邮箱以前退过信',
  legacy_welcomed: '旧的欢迎信批次已经发过',
  address_duplicate: '同一个邮箱已经收过这封',
  provider_rejected: '发信服务拒收了',
  unknown_outcome: '发送结果不明，等人核对',
  expired_unknown: '发送结果不明，等人核对',
  expired_20h: '发送结果不明，等人核对',
  not_sent_confirmed: '已确认没发出',
  complained: '他投诉过',
  auth_inactive: '授权失效，已停发',
  not_armed: '授权失效，已停发',
  template_changed: '授权失效，已停发',
  gate_changed: '授权失效，已停发',
}

/** 各种「暂时查不清」的码（`xxx_unverifiable` / `xxx_unreadable`）：说同一句，不用一个个列。 */
export const UNVERIFIABLE_REASON_TEXT = '暂时查不清，稍后自动再试'
const UNVERIFIABLE_SUFFIX_RE = /_(unverifiable|unreadable)$/

export const UNKNOWN_REASON_TEXT = '系统出错'

/** 只认自己表里的码（继承来的键如 constructor 不算）；码为空或认不出 → 「系统出错」。 */
export function reasonTextFor(code: string | null | undefined): string {
  if (typeof code !== 'string') return UNKNOWN_REASON_TEXT
  if (Object.prototype.hasOwnProperty.call(LETTER_REASON_TEXT, code)) return LETTER_REASON_TEXT[code]
  if (UNVERIFIABLE_SUFFIX_RE.test(code)) return UNVERIFIABLE_REASON_TEXT
  return UNKNOWN_REASON_TEXT
}
