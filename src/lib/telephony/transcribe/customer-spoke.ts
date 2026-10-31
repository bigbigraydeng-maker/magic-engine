/**
 * 「客人到底开没开口」的核验。
 *
 * 语音信箱 / 自动应答 / 对方全程没出声，都会被转写服务写成一段文字，模型很容易当成「聊过了」。
 * 这里只做纯函数判断，不依赖 analysis-schema（避免循环引用）。
 */

export const CUSTOMER_SPOKE_VALUES = ['yes', 'no', 'unclear'] as const
export type CustomerSpokeVerdict = (typeof CUSTOMER_SPOKE_VALUES)[number]

/** 语音信箱 / 自动应答的典型问候语（英文 + 中文）。 */
export const VOICEMAIL_GREETING =
  /at the (?:tone|beep)|after the (?:tone|beep)|record your message|leave (?:a|your) (?:message|name)|voice ?mail|mailbox|answering (?:machine|service)|语音信箱|请留言|嘀声|滴声/i

/** 把文本压成可比较的形式：小写，去掉空白和常见标点。 */
function squash(s: string): string {
  return s.toLowerCase().replace(/[\s\u3000"'“”‘’.,，。!！?？、:;；]+/g, '')
}

/** 转写里有几个声道出现过话（行首形如「声道1：」「声道2：」）。 */
export function speakingChannelCount(transcript: string): number {
  const channels = new Set<string>()
  for (const m of transcript.matchAll(/^声道(\d+)：/gm)) channels.add(m[1])
  return channels.size
}

export interface RawCustomerSpoke { customerSpoke: CustomerSpokeVerdict; customerSpokeQuote: string | null }

/**
 * 核验模型给的「客人开没开口」。宁可说不清，也不乱说「开过口」：
 *  - 模型说 yes：quote 必须非空且原样出现在转写里（squash 后 includes）；否则 unclear。
 *    转写里只要出现语音信箱问候语（VOICEMAIL_GREETING 命中整段转写），员工对着信箱留言也会让模型误判，
 *    所以一律降为 unclear（不声称聊过，但也不判没聊）。quote 本身命中问候语 → 'no'。
 *  - 模型说 no：转写命中 VOICEMAIL_GREETING，或只有 ≤1 个声道出过声 → 'no'；否则 unclear（没证据就不下"没开口"的结论）。
 *  - 其他（unclear）→ unclear。
 */
export function verifyCustomerSpoke(raw: RawCustomerSpoke, transcript: string): CustomerSpokeVerdict {
  if (raw.customerSpoke === 'yes') {
    const quote = raw.customerSpokeQuote?.trim() ?? ''
    const squashed = squash(quote)
    // 压缩后为空（纯标点 / 空白）的「原话」不是证据，否则 includes('') 恒为真。
    if (!squashed || !squash(transcript).includes(squashed)) return 'unclear'
    if (VOICEMAIL_GREETING.test(quote)) return 'no'
    if (VOICEMAIL_GREETING.test(transcript)) return 'unclear'
    return 'yes'
  }
  if (raw.customerSpoke === 'no') {
    if (VOICEMAIL_GREETING.test(transcript)) return 'no'
    if (speakingChannelCount(transcript) <= 1) return 'no'
    return 'unclear'
  }
  return 'unclear'
}
