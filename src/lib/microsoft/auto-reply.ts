/**
 * 自动回复识别（纯函数，不依赖 supabase —— 从 mail-ingest.ts 原样搬出，
 * 让不想拉进服务端依赖的模块也能用同一份词表）。
 */

/**
 * 自动回复的主题前缀。
 *
 * 只看主题、只看开头，跟 mail-sender 里同一套保守做法：一封真回信的主题几乎
 * 不可能以这些词开头，而「包含」会把「Re: 关于 out of office 期间的行程」误伤。
 * 认不出来就当成真回信 —— 漏判一封自动回复只是让一张卡早一天变灰，
 * 误判一封真回信却会让销售以为自己没跟过、重复联系客人。
 */
const AUTO_REPLY_SUBJECTS = [
  'automatic reply',
  'auto reply',
  'auto-reply',
  'automatic response',
  'out of office',
  'out-of-office',
  'ooo:',
  'undeliverable',
  'delivery status notification',
  '自动回复',
  '自動回覆',
]

/** 这封出站邮件是机器发的自动回执，不是人写的回信。 */
export function isAutoReply(subject: string | null): boolean {
  const s = (subject ?? '').trim().toLowerCase()
  if (!s) return false
  // 去掉转发/回复前缀再判 —— 「Re: Automatic reply: …」仍然是自动回执。
  const stripped = s.replace(/^((re|fw|fwd|回复|轉寄)\s*:\s*)+/i, '')
  return AUTO_REPLY_SUBJECTS.some((p) => stripped.startsWith(p))
}
