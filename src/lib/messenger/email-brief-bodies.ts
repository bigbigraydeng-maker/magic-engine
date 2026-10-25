import { cleanEmailBody } from './email-thread'

/** 一条待清洗的邮件消息。`storedBody` 是库里那 255 字摘要，拉不到全文时拿它兜底。 */
export interface EmailMessageRef {
  messageId: string
  storedBody: string
}

/** 拉一封邮件全文。失败时返回 null —— 调用方退回 255 字摘要，绝不当成空邮件。 */
export type FetchFullText = (messageId: string) => Promise<string | null>

export interface ResolvedBody {
  messageId: string
  /** 喂给模型的正文。可能是空串，表示这条消息没有任何客人自己写的内容。 */
  text: string
  /** 正文来自哪里，写进运行记录用。 */
  source: 'full' | 'stored_fallback'
}

export interface ResolveSummary {
  bodies: ResolvedBody[]
  /** 拉全文失败、退回 255 字摘要的条数。 */
  fellBack: number
  /** 清洗后没有任何内容的条数（例如客人只转发了我们自己的邮件、一个字没写）。 */
  empty: number
}

/** 一次最多拉几封全文。线程可以很长，而调用方有时间和 token 预算。 */
export const MAX_FULL_TEXT_FETCHES = 12

/** 转发内容的标签行。必须逐字一致，防止模型把转发内容当成客人自己写的。 */
const FORWARDED_LABEL = '[客人转发过来的内容，不是客人自己写的]'

/** 判断字符串是否为空或只有空白。 */
function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

/**
 * 把清洗后的 `{ own, forwarded }` 拼成喂给模型的正文。
 * 返回 `{ text, empty }`，`empty` 表示这条消息没有任何可总结的内容。
 */
function composeText(own: string, forwarded: string): { text: string; empty: boolean } {
  if (own === '' && forwarded === '') {
    return { text: '', empty: true }
  }
  if (forwarded === '') {
    return { text: own, empty: false }
  }
  const labelled = `${FORWARDED_LABEL}\n${forwarded}`
  if (own === '') {
    return { text: labelled, empty: false }
  }
  return { text: `${own}\n\n${labelled}`, empty: false }
}

/** 清洗一段正文并组装成 `ResolvedBody`，同时报告是否为空。 */
function buildBody(
  messageId: string,
  raw: string | null | undefined,
  source: ResolvedBody['source'],
): { body: ResolvedBody; empty: boolean } {
  const cleaned = cleanEmailBody(raw)
  const { text, empty } = composeText(cleaned.own, cleaned.forwarded)
  return { body: { messageId, text, source }, empty }
}

/**
 * 尝试拉取一封全文；失败（抛错、null、空白）时返回 null。
 * 单封邮件读不出来，绝不能连累整条线程。
 */
async function tryFetchFullText(
  fetchFullText: FetchFullText,
  messageId: string,
): Promise<string | null> {
  try {
    const full = await fetchFullText(messageId)
    if (isBlank(full)) {
      return null
    }
    return full
  } catch {
    return null
  }
}

/**
 * 解析整条线程的正文。
 *
 * 只有最后 `MAX_FULL_TEXT_FETCHES` 条会去拉全文（消息已按时间排序，最新的最重要）。
 * 更早的条目只用 `storedBody` 解析，`source` 记为 `'stored_fallback'`。
 * 注意：这些早条目**不计入** `fellBack` —— 它们并没有失败，只是按预算没去拉全文。
 * 请不要把这里「修正」成一个假的失败计数。
 */
export async function resolveEmailBodies(
  messages: readonly EmailMessageRef[],
  fetchFullText: FetchFullText,
): Promise<ResolveSummary> {
  if (messages.length === 0) {
    return { bodies: [], fellBack: 0, empty: 0 }
  }

  const fetchStart = Math.max(0, messages.length - MAX_FULL_TEXT_FETCHES)
  const bodies: ResolvedBody[] = []
  let fellBack = 0
  let empty = 0

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (i < fetchStart) {
      // 预算之外的早条目：只用 255 字摘要，不算失败。
      const { body, empty: isEmpty } = buildBody(
        message.messageId,
        message.storedBody,
        'stored_fallback',
      )
      bodies.push(body)
      if (isEmpty) {
        empty += 1
      }
      continue
    }

    // 顺序拉取，绝不 Promise.all：邮件服务商按邮箱限流，
    // 调用方的时间预算也是按「一次一个请求」估的。
    const full = await tryFetchFullText(fetchFullText, message.messageId)
    if (full === null) {
      const { body, empty: isEmpty } = buildBody(
        message.messageId,
        message.storedBody,
        'stored_fallback',
      )
      bodies.push(body)
      fellBack += 1
      if (isEmpty) {
        empty += 1
      }
      continue
    }

    const { body, empty: isEmpty } = buildBody(message.messageId, full, 'full')
    bodies.push(body)
    if (isEmpty) {
      empty += 1
    }
  }

  return { bodies, fellBack, empty }
}

/** 这个线程还剩下任何可总结的内容吗？全空就不该写卡 —— 没有卡比一张凭空编的卡好。 */
export function hasAnythingToSummarise(summary: ResolveSummary): boolean {
  // 不带 g 标志，可安全重复 .test()。
  const hasLetter = /\p{L}/u
  return summary.bodies.some((body) => hasLetter.test(body.text))
}
