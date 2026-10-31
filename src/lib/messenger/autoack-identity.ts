/**
 * The identity and text of ME's F1 auto-acknowledgement, kept apart from the
 * Inngest function so read-only code (reply metrics) can recognise the message
 * without importing a workflow module. The sender email is shared with F2's
 * human-approved drafts (`DRAFT_SENT_BY_EMAIL`), so the email alone does not
 * prove a message is the auto-ack — match the body as well.
 */
import { AUTOMATED_NOTICE } from './smart-ack/types'

export const AUTOACK_SENT_BY_EMAIL = 'governed-reply-agent@magicengine.cloud'

/**
 * 现在发出去的自动安抚：**只有英文**（PM 2026-10-21：自动回复不可以出现中文）。
 * 客人可能是任何语言，不替他猜；中文客人由顾问用中文接。
 */
export const AUTOACK_TEMPLATE =
  'Thanks for your message — one of our team will get back to you with the details shortly.'

/**
 * 2026-10-21 之前发出去的版本（中英双语）。历史消息里还躺着这句，
 * 回复指标要继续把它认成「ME 的自动安抚」，不然老消息会被算成顾问回复。只用于**识别**，不再发送。
 */
export const LEGACY_AUTOACK_TEMPLATE =
  'Thanks for your message — one of our team will get back to you with the details shortly.\n' +
  '感谢您的留言，我们的顾问正在为您整理详细信息，稍后回复您。'

/** 这条正文是不是 ME 自动安抚（新版或旧版），两边都忽略零宽字符和首尾空白。 */
export function isAutoAckBody(body: string, normalise: (s: string) => string): boolean {
  const text = normalise(body)
  // 智能版每条文字都不同，靠末尾固定的「自动回复」提示识别（代码追加，模型写不出来）。
  if (text.endsWith(normalise(AUTOMATED_NOTICE))) return true
  return text === normalise(AUTOACK_TEMPLATE) || text === normalise(LEGACY_AUTOACK_TEMPLATE)
}
