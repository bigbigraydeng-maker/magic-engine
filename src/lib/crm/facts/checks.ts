/**
 * 事实的核对与降级 —— 纯函数，不碰 IO。
 *
 * 模型交回来的引文要回原文里核对：对不上就是编的，整条判断降级。
 * 这是铁律 8（绝不凭空注入客户业务数据）在代码里的样子 —— 销售会照着
 * 这些事实去打电话，编一句「他说要下单」是伤害客户。
 *
 * 离线探针和线上任务共用这一份：探针上被降级的，线上也必须被降级。
 */

import { quoteIsGrounded } from '@/lib/crm/stage-from-conversation'
import type { Facts } from './schema'
import { cannedKey, isCanned, type FactsMsg } from './canned'

/**
 * 引文真的在对话里吗。
 *
 * 长引文走 `quoteIsGrounded`（归一化后包含）；短引文（< 8 字）在归一化后
 * 太容易误判，改用原文直接包含 —— 短句本来就该逐字对上。
 */
export function grounded(quote: string, transcript: string): boolean {
  if (quote.length === 0) return false
  if (quoteIsGrounded(quote, transcript)) return true
  if (quote.length < 8) return transcript.includes(quote)
  return false
}

/** 找引文出处用的前缀长度 —— 够长到不会撞车，又容得下模型少抄几个字。 */
const QUOTE_MATCH_PREFIX = 40

/** 我们后来还继续跟进的话，就不算「最终拒绝」。 */
const KEPT_WORKING_CHARS = 40

/**
 * 「我们拒绝了」这句话站得住吗。
 *
 * 光有引文不够：销售说完「做不了」之后又追着问细节，那说明这单没死。
 * 所以找出引文所在的那条出站消息，看它**之后**还有没有一条够长的、
 * 非罐头的出站消息 —— 有 = 我们还在谈，拒绝不成立。
 */
export function declineStands(
  quote: string,
  transcript: string,
  msgs: FactsMsg[],
  canned: Set<string>,
): boolean {
  if (!grounded(quote, transcript)) return false
  const prefix = quote.toLowerCase().slice(0, QUOTE_MATCH_PREFIX)
  let declineAt = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.direction !== 'outbound') continue
    if ((m.body ?? '').toLowerCase().includes(prefix)) {
      declineAt = i
      break
    }
  }
  if (declineAt === -1) return true
  for (let i = declineAt + 1; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.direction !== 'outbound') continue
    if (isCanned(m, canned)) continue
    if ((m.body ?? '').trim().length > KEPT_WORKING_CHARS) return false
  }
  return true
}

/**
 * 把站不住的判断降级 —— 返回**新对象**，绝不改输入。
 *
 * (a) 拒绝站不住 → `we_declined` 归 false
 * (b) 说客人给了细节，却拿不出一句能核对的客人原话 → 不信，归 false
 * (c) 说我们报过价，引文非空却对不上 → 归 false（空引文不降级，见下）
 * (e) `is_spam_or_unrelated` 以 `spam_kind` 为准（种类点不出来就不算垃圾）
 * 其余字段原样保留。
 */
export function sanitizeFacts(
  f: Facts,
  transcript: string,
  msgs: FactsMsg[],
  canned: Set<string>,
): Facts {
  const next: Facts = { ...f }

  // (e) 「是不是垃圾」只认点得出名的种类：布尔要跟 spam_kind 一致，不一致以种类为准。
  next.is_spam_or_unrelated = next.spam_kind !== 'none'

  if (next.we_declined && !declineStands(next.decline_quote, transcript, msgs, canned)) {
    next.we_declined = false
  }

  if (next.customer_gave_specifics && !grounded(next.customer_quote, transcript)) {
    next.customer_gave_specifics = false
  }

  if (next.we_gave_price && next.our_quote.length > 0 && !grounded(next.our_quote, transcript)) {
    next.we_gave_price = false
  }

  return next
}

/** 导出给测试用：罐头 key 的归一化规则和 canned.ts 必须一致。 */
export { cannedKey }
