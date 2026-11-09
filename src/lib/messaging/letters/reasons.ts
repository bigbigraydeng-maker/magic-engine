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
}

export const UNKNOWN_REASON_TEXT = '系统出错'

/** 只认自己表里的码（继承来的键如 constructor 不算）；码为空或认不出 → 「系统出错」。 */
export function reasonTextFor(code: string | null | undefined): string {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(LETTER_REASON_TEXT, code)) {
    return UNKNOWN_REASON_TEXT
  }
  return LETTER_REASON_TEXT[code]
}
