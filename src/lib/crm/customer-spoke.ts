/**
 * 这通电话里，客人本人到底开没开口。
 *
 * ## 为什么不能只看 answered / reached
 *
 * Twilio 在语音信箱的问候语被「接起」时也会报 `answered = true`，外呼接通（`reached`）同理 ——
 * 它们只说明「有一条线路接通了」，不说明「客人说了话」。把语音信箱当成聊上了，
 * 就会把从没联系上的人推进「已联系」，甚至从今天名单里藏起来。
 *
 * ## 判据从哪来
 *
 * 通话分析流水线把结论写进触点 `metadata.customer_spoke`（'yes' | 'no' | 'unclear'）。
 * 人工复核否掉分析结果时写 `metadata.call_analysis_review = 'rejected'`，此时结论不可信。
 *
 * ## 未知一律保守
 *
 * 分析还没出结果、分析失败、被人否掉 —— 都返回 null（未知）。调用方必须按「不能声称聊过」处理，
 * 但也绝不能因此把人藏起来（人留在今天名单里，等下一轮或员工自己看）。
 */

export type CustomerSpoke = 'yes' | 'no' | 'unclear'

/**
 * 读通话分析给出的「客人开没开口」。
 * 返回 null 表示未知：没分析过、分析失败、或人工复核否掉了分析结果。
 */
export function customerSpokeOf(metadata: Record<string, unknown> | null | undefined): CustomerSpoke | null {
  if (!metadata) return null
  if (metadata.call_analysis_review === 'rejected') return null
  const v = metadata.customer_spoke
  if (v === 'yes' || v === 'no' || v === 'unclear') return v
  return null
}

/** 这通电话能证明客人本人开过口（分析确认 `customer_spoke === 'yes'`）。 */
export function callProvesCustomerSpoke(metadata: Record<string, unknown> | null | undefined): boolean {
  return customerSpokeOf(metadata) === 'yes'
}

/** 分析确认客人没出声（语音信箱 / 对方没说话）。未知不算。 */
export function isVoicemailOrSilentCall(metadata: Record<string, unknown> | null | undefined): boolean {
  return customerSpokeOf(metadata) === 'no'
}
