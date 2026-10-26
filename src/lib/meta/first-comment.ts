import { createHash } from 'node:crypto'

// 共享的 Facebook「首评」写入器。
//
// 从 facebook-reel-adapter.ts 里抽出来(纯重构,Reel 行为不变),好让 Daily Plan 帖复用同一套:
// ① 先扫已有评论找零宽幂等标记 —— 命中就返回,绝不重复发;
// ② 没命中才 POST 一条,把标记单独放在正文下一行,下次扫描能认出来;
// ③ 读失败一律抛错,绝不「读不到就当没有」然后盲发。

/**
 * 幂等标记:namespace 区分业务线(例如 'daily-plan-first-comment'),tag 是该帖子的幂等键。
 * 同一 namespace+tag 永远得到同一个不可见标记;不同 namespace 互不冲突。
 */
export function buildFirstCommentMarker(namespace: string, tag: string): string {
  const hash = createHash('sha256').update(`${namespace}:${tag}`).digest('hex').slice(0, 8)
  const bits = hash
    .split('')
    .map((c) => parseInt(c, 16).toString(2).padStart(4, '0'))
    .join('')
  // \u2063 不可见分隔符作锚点;1 → \u200c 零宽不连字,0 → \u200b 零宽空格。
  return '\u2063' + bits.split('').map((bit) => (bit === '1' ? '\u200c' : '\u200b')).join('')
}

export interface EnsureFirstCommentArgs {
  /** 例如 'https://graph.facebook.com/v25.0' */
  graphBase: string
  /** 评论挂靠的对象 id(Reel 的 video_id / 帖子的 post_id) */
  objectId: string
  /** 设了就必须满足 objectId 以 `${expectedPageId}_` 打头,否则在任何网络请求前抛错 */
  expectedPageId?: string
  accessToken: string
  /** 不可见幂等标记:追加到正文末尾,并在已有评论里搜索 */
  marker: string
  message: string
  /** 错误文案里用的对象名,例如 'Reel' 或 '每日计划帖' */
  failureLabel: string
  /** 默认用全局 fetch */
  fetcher?: typeof fetch
  /** 最多翻几页评论,默认 5 */
  maxPages?: number
}

/** 正文与不可见标记之间必须隔一个换行:标记紧贴正文时,正文若以链接结尾,平台会把零宽字符算进链接(utm_content 被污染)。 */
export function composeFirstCommentBody(message: string, marker: string): string {
  return `${message}\n${marker}`
}

export async function ensureFacebookFirstComment(args: EnsureFirstCommentArgs): Promise<string> {
  const doFetch = args.fetcher ?? fetch
  const maxPages = args.maxPages ?? 5

  if (args.expectedPageId && !args.objectId.startsWith(`${args.expectedPageId}_`)) {
    throw new Error(`首评目标不属于页面 ${args.expectedPageId}`)
  }

  const params = new URLSearchParams({
    fields: 'id,message',
    filter: 'stream',
    order: 'reverse_chronological',
    limit: '100',
    access_token: args.accessToken,
  })

  let nextUrl: string | undefined = `${args.graphBase}/${args.objectId}/comments?${params}`
  let pagesRead = 0

  while (nextUrl && pagesRead < maxPages) {
    const read = await doFetch(nextUrl)
    pagesRead += 1
    const existingJson = (await read.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>
      paging?: { next?: unknown }
    }
    if (!read.ok || !Array.isArray(existingJson.data)) {
      throw new Error(`读取 ${args.failureLabel} 首评失败 ${read.status}`)
    }
    const existing = existingJson.data.find(
      (comment) => typeof comment.message === 'string' && comment.message.includes(args.marker),
    )
    if (existing && typeof existing.id === 'string') return existing.id

    const next = existingJson.paging?.next
    nextUrl = typeof next === 'string' ? next : undefined
  }

  // 翻到上限还有下一页 = 没扫完。此时盲发可能重复,宁可不发(魏征复审:读不全按未知处理)。
  if (nextUrl) throw new Error(`${args.failureLabel} 首评幂等扫描未完成(评论超过 ${maxPages} 页),为避免重复未发布`)

  const body = new URLSearchParams({
    message: composeFirstCommentBody(args.message, args.marker),
    access_token: args.accessToken,
  })
  const created = await doFetch(`${args.graphBase}/${args.objectId}/comments`, { method: 'POST', body })
  const createdJson = (await created.json().catch(() => ({}))) as Record<string, unknown>
  if (!created.ok || typeof createdJson.id !== 'string') {
    throw new Error(`发布 ${args.failureLabel} 首评失败 ${created.status}: ${JSON.stringify(createdJson)}`)
  }
  return createdJson.id
}
