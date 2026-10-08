export interface GraphGetResult {
  ok: boolean
  status: number
  body: unknown
}

export interface PostResolverDeps {
  /**
   * read-only Graph GET. `path` like "/123/published_posts".
   * The implementation (not this module) adds API version, access token
   * and encodes the query.
   */
  graphGet: (path: string, query: Record<string, string>) => Promise<GraphGetResult>
}

export type PostResolveFailure =
  | 'bad_input'
  | 'graph_error'
  | 'bad_shape'
  | 'no_match'
  | 'ambiguous'
  | 'page_mismatch'

export type PostResolveResult =
  | { ok: true; postId: string; matchedBy: 'attachment_target' | 'attachment_url' }
  | { ok: false; reason: PostResolveFailure; message: string }

export const PUBLISHED_POSTS_FIELDS = 'id,created_time,attachments{media_type,target{id},url}'
export const PUBLISHED_POSTS_LIMIT = 25

const ID_PATTERN = /^\d{5,25}$/
const POST_ID_PATTERN = /^(\d+)_(\d+)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Returns true when `url` contains `/reel/<videoId>` or `/videos/<videoId>`
 * where the video id is followed by end-of-string, '/', '?' or '&'.
 * This prevents a longer number that merely starts with the video id
 * (e.g. videoId "222222" must not match ".../reel/2222229999/").
 */
function urlMatchesVideo(url: string, videoId: string): boolean {
  const escaped = videoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`/(?:reel|videos)/${escaped}(?:$|[/?&])`)
  return pattern.test(url)
}

interface AttachmentMatch {
  matched: boolean
  matchedBy: 'attachment_target' | 'attachment_url'
}

function matchAttachment(attachment: unknown, videoId: string): AttachmentMatch {
  if (!isRecord(attachment)) {
    return { matched: false, matchedBy: 'attachment_target' }
  }

  const target = attachment.target
  if (isRecord(target) && target.id === videoId) {
    return { matched: true, matchedBy: 'attachment_target' }
  }

  const url = attachment.url
  if (typeof url === 'string' && urlMatchesVideo(url, videoId)) {
    return { matched: true, matchedBy: 'attachment_url' }
  }

  return { matched: false, matchedBy: 'attachment_target' }
}

interface PostMatch {
  postId: string
  matchedBy: 'attachment_target' | 'attachment_url'
}

function matchPost(post: unknown, videoId: string): PostMatch | null {
  if (!isRecord(post)) return null

  const id = post.id
  if (typeof id !== 'string' || !POST_ID_PATTERN.test(id)) return null

  const attachments = post.attachments
  if (!isRecord(attachments)) return null

  const data = attachments.data
  if (!Array.isArray(data)) return null

  let matchedBy: 'attachment_target' | 'attachment_url' | null = null
  for (const attachment of data) {
    const result = matchAttachment(attachment, videoId)
    if (result.matched) {
      // Prefer 'attachment_target' as the reported matchedBy if either kind matched.
      if (result.matchedBy === 'attachment_target') {
        matchedBy = 'attachment_target'
        break
      }
      if (matchedBy === null) {
        matchedBy = 'attachment_url'
      }
    }
  }

  if (matchedBy === null) return null
  return { postId: id, matchedBy }
}

export async function resolvePromotablePostId(
  deps: PostResolverDeps,
  input: { pageId: string; videoId: string },
): Promise<PostResolveResult> {
  const { pageId, videoId } = input

  if (!ID_PATTERN.test(pageId) || !ID_PATTERN.test(videoId)) {
    return {
      ok: false,
      reason: 'bad_input',
      message: '页面 ID 或视频 ID 格式不正确，无法查询。',
    }
  }

  let result: GraphGetResult
  try {
    result = await deps.graphGet(`/${pageId}/published_posts`, {
      fields: PUBLISHED_POSTS_FIELDS,
      limit: String(PUBLISHED_POSTS_LIMIT),
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'graph_error',
      message: `读取主页帖子失败：${errorMessage(error)}`,
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      reason: 'graph_error',
      message: `读取主页帖子失败，接口返回状态码 ${result.status}。`,
    }
  }

  const body = result.body
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return {
      ok: false,
      reason: 'bad_shape',
      message: '主页帖子返回的数据结构不符合预期。',
    }
  }

  const matches = new Map<string, 'attachment_target' | 'attachment_url'>()
  for (const post of body.data) {
    const match = matchPost(post, videoId)
    if (match === null) continue

    const existing = matches.get(match.postId)
    if (existing === undefined || (existing === 'attachment_url' && match.matchedBy === 'attachment_target')) {
      matches.set(match.postId, match.matchedBy)
    }
  }

  if (matches.size === 0) {
    return {
      ok: false,
      reason: 'no_match',
      message: '只检查了最近 25 条帖子，没有找到指向该视频的帖子；Reel 可能太旧或不是主页帖子。',
    }
  }

  if (matches.size > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: '找到多条指向该视频的帖子，无法确定要推广哪一条。',
    }
  }

  const [postId, matchedBy] = matches.entries().next().value as [string, 'attachment_target' | 'attachment_url']
  const pagePart = postId.slice(0, postId.indexOf('_'))

  if (pagePart !== pageId) {
    return {
      ok: false,
      reason: 'page_mismatch',
      message: '找到的帖子不属于该主页，无法推广。',
    }
  }

  return { ok: true, postId, matchedBy }
}
