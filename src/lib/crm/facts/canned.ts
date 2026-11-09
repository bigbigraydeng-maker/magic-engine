/**
 * 罐头话术识别 + 对话渲染 —— 纯函数，不碰 IO。
 *
 * 自动回复（价目表、欢迎语、机器人答话）在对话里长得像「我们说过话」，
 * 但它不是人说的：价目表不等于报价，欢迎语不等于安排了下步。这里把
 * 反复出现在多段对话里的出站文本认出来，标成 `US (auto-reply)`。
 *
 * 离线探针和线上任务共用这一份：探针上看到的对话长什么样，线上就是什么样。
 */

export interface FactsMsg {
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}

/** 归一化后取前 60 字 —— 同一段话术的细微空白/大小写差异要能对上。 */
export function cannedKey(body: string | null): string {
  if (body === null) return ''
  return body.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
}

/**
 * 出现在 >= `minConversations` 段**不同**对话里的出站文本 = 罐头话术。
 *
 * 同一段话在一段对话里刷 5 遍不算 —— 那可能只是销售重复发了一次。
 * 太短的 key（< 12 字）一律不认：「ok」「thanks」到处都是，认了会把真话也吞掉。
 */
export function findCanned(
  outboundBodiesPerConversation: Array<Array<string | null>>,
  minConversations = 3,
): Set<string> {
  const seenIn = new Map<string, number>()
  for (const bodies of outboundBodiesPerConversation) {
    const keys = new Set<string>()
    for (const body of bodies) {
      const key = cannedKey(body)
      if (key.length >= 12) keys.add(key)
    }
    for (const key of keys) seenIn.set(key, (seenIn.get(key) ?? 0) + 1)
  }
  const canned = new Set<string>()
  for (const [key, count] of seenIn) {
    if (count >= minConversations) canned.add(key)
  }
  return canned
}

/** 只有出站消息可能是罐头话术；入站永远是客人自己打的。 */
export function isCanned(m: FactsMsg, canned: Set<string>): boolean {
  if (m.direction !== 'outbound') return false
  return canned.has(cannedKey(m.body))
}

/**
 * 最后一句「人话」是谁说的。
 *
 * 从尾巴往回走：客人说的 → 'customer'；我们这边非罐头的一句 → 'us'；
 * 罐头出站跳过（机器人答话不代表我们跟进过）。都没有就默认 'customer'。
 */
export function lastSpeaker(msgs: FactsMsg[], canned: Set<string>): 'customer' | 'us' {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.direction === 'inbound') return 'customer'
    if (!isCanned(m, canned)) return 'us'
  }
  return 'customer'
}

/** 单条消息最多留这么多字 —— 一封带整段引用历史的邮件不该吃掉整个预算。 */
const MAX_LINE_CHARS = 600

/** 整段对话最多留这么多字，超长时留**最后**那些（最近的话最重要）。 */
const MAX_TRANSCRIPT_CHARS = 12_000

/** 落单的 UTF-16 代理项（半个 emoji）会让下游 JSON 编码炸掉，直接删掉。 */
function stripLoneSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDFFF]/g, '')
}

function renderLine(m: FactsMsg, canned: Set<string>): string {
  const body = stripLoneSurrogates((m.body ?? '').trim()).slice(0, MAX_LINE_CHARS)
  if (m.direction === 'inbound') return `CUSTOMER: ${body}`
  if (isCanned(m, canned)) return `US (auto-reply): ${body}`
  return `US: ${body}`
}

/**
 * 把消息拼成模型读得懂的对话。
 *
 * 三种标签：`CUSTOMER:` / `US:` / `US (auto-reply):`。超长时**砍掉最老的**，
 * 因为「他现在到哪一步」这个问题，最近的话永远比两个月前的重要。
 */
export function buildTranscript(msgs: FactsMsg[], canned: Set<string>): string {
  const rendered = msgs.map((m) => renderLine(m, canned))
  const joined = rendered.join('\n')
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined
  return joined.slice(joined.length - MAX_TRANSCRIPT_CHARS)
}
