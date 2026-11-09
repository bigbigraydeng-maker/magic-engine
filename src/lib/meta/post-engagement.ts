/**
 * 读一条已发布 Facebook 帖子的 reactions / comments / shares 总数。
 *
 * 只用 `pages_read_engagement` 拿得到的普通边，不碰 `read_insights` —— 不需要
 * 任何客户重新授权。
 *
 * 三条纪律：
 *  1. 明确的数字才是数字。字段缺席或读不出 total_count 一律记「没读到」，绝不塌成 0；
 *     0 是「实测零次互动」，跟「问不到」混在一起会让效果报告说谎。
 *  2. `shares` 缺席暂不当 0 —— 没有实测证据前记 `omitted_unverified`，宁可少一个
 *     数字也不编一个 0。
 *  3. `code=100` 不等于帖子被删。只有 subcode 33 或 message 明说才是对象没了；
 *     判据对齐 `comments.ts:reasonFor`。
 */

import { GRAPH_BASE } from './graph-base'

export type FieldRead =
  | { kind: 'value'; value: number }
  /** 返回了但读不出数字 —— 权限降级或形状意外。 */
  | { kind: 'absent' }
  /** shares 专用：字段整个缺席。没有实证前不当 0。 */
  | { kind: 'omitted_unverified' }

export type GraphFailure = {
  /** permanent：重试无意义，写 unmeasurable 回执。transient：让 Inngest 有界重试。 */
  kind: 'permanent' | 'transient'
  reason: string
  code: number | null
  subcode: number | null
}

export interface EngagementRead {
  reactions: FieldRead
  comments: FieldRead
  shares: FieldRead
}

/**
 * Graph 顶层错误 → 永久 / 临时。
 *
 * 未知错误码归**临时**：多重试几次便宜，把一条本可测的帖子永久跳过很贵；
 * `retries` 上限兜底。与 `comments.ts` 既有哲学一致。
 */
export function classifyGraphError(err: {
  code?: unknown
  error_subcode?: unknown
  message?: unknown
}): GraphFailure {
  const code = typeof err.code === 'number' ? err.code : null
  const subcode = typeof err.error_subcode === 'number' ? err.error_subcode : null
  const message = typeof err.message === 'string' ? err.message : ''
  const at = (kind: GraphFailure['kind'], reason: string) => ({ kind, reason, code, subcode })

  if (code === 190) return at('permanent', 'token_invalid')
  if (code === 10 || code === 200) return at('permanent', 'permission_denied')
  // 🔴 只有 subcode 33 / message 明说，才敢下「帖子没了」这个永久结论。
  if (code === 100 && (subcode === 33 || /does not exist/i.test(message))) {
    return at('permanent', 'object_gone')
  }
  // 其余的 100 是通用参数错 —— 不知道是什么，按临时办，别谎称帖子被删。
  if (code === 100) return at('transient', 'graph_bad_request')
  if (code === 4 || code === 17 || code === 341 || code === 613) return at('transient', 'rate_limited')
  return at('transient', 'graph_unknown')
}

/** `reactions` / `comments`：`{summary:{total_count:N}}`。读不出数字就是 absent。 */
export function readSummaryCount(raw: unknown): FieldRead {
  const summary = raw && typeof raw === 'object' ? (raw as { summary?: unknown }).summary : null
  const total =
    summary && typeof summary === 'object' ? (summary as { total_count?: unknown }).total_count : null
  return typeof total === 'number' && Number.isFinite(total) && total >= 0
    ? { kind: 'value', value: total }
    : { kind: 'absent' }
}

/** `shares`：`{count:N}`，或整个字段缺席。缺席 ≠ 0（纪律 2）。 */
export function readShareCount(raw: unknown): FieldRead {
  if (raw === undefined || raw === null) return { kind: 'omitted_unverified' }
  const count = typeof raw === 'object' ? (raw as { count?: unknown }).count : null
  return typeof count === 'number' && Number.isFinite(count) && count >= 0
    ? { kind: 'value', value: count }
    : { kind: 'absent' }
}

export type FetchEngagementResult =
  | { ok: true; read: EngagementRead }
  | { ok: false; failure: GraphFailure }

/** 读一次。只读，绝不写 Facebook。`fetcher` 可注入以便测试。 */
export async function fetchPostEngagement(
  postId: string,
  pageAccessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<FetchEngagementResult> {
  const url =
    `${GRAPH_BASE}/${encodeURIComponent(postId)}` +
    `?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares` +
    `&access_token=${encodeURIComponent(pageAccessToken)}`
  const fail = (reason: string): FetchEngagementResult => ({
    ok: false,
    failure: { kind: 'transient', reason: reason.slice(0, 200), code: null, subcode: null },
  })

  let res: Response
  try {
    res = await fetcher(url)
  } catch (e) {
    return fail(`network:${e instanceof Error ? e.message : String(e)}`)
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  // 没有可解析的 JSON（代理错误页 / 网关）—— 永远当临时，别猜。
  if (!body) return fail(`http_${res.status}_no_json`)
  if (body.error && typeof body.error === 'object') {
    return { ok: false, failure: classifyGraphError(body.error as Record<string, unknown>) }
  }
  if (!res.ok) return fail(`http_${res.status}`)

  return {
    ok: true,
    read: {
      reactions: readSummaryCount(body.reactions),
      comments: readSummaryCount(body.comments),
      shares: readShareCount(body.shares),
    },
  }
}
