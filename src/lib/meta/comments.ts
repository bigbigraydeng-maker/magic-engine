/**
 * Meta Graph API — Page comment read/reply/hide/private-reply.
 *
 * Mirrors the style of meta/client.ts: thin fetch wrappers, graceful failure
 * (return null / false and log rather than throw), Page access token passed in.
 *
 * Requires a Page Access Token with pages_read_engagement (read) and
 * pages_manage_engagement (reply/hide). Private replies additionally require
 * pages_messaging and only work within 7 days of the comment, once per comment.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export interface PageComment {
  commentId: string
  postId: string
  message: string
  fromId: string | null
  fromName: string | null
  createdAt: string
  /** True when this comment was written by the Page itself (skip — avoids reply loops). */
  isFromPage: boolean
}

interface RawComment {
  id: string
  message?: string
  created_time?: string
  from?: { id?: string; name?: string }
}

/**
 * Fetch comments on a single post, newest first.
 * `pageId` is used only to mark self-authored comments (isFromPage).
 */
export async function fetchPostComments(
  postId: string,
  pageId: string,
  pageAccessToken: string,
  limit = 50,
): Promise<PageComment[]> {
  const params = new URLSearchParams({
    fields: 'id,message,created_time,from',
    order: 'reverse_chronological',
    limit: String(limit),
    access_token: pageAccessToken,
  })
  const url = `${GRAPH_BASE}/${postId}/comments?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/comments] fetchPostComments error:', err)
    return []
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/comments] fetchPostComments HTTP ${res.status}:`, body.slice(0, 300))
    return []
  }

  const json = (await res.json()) as { data?: RawComment[] }
  return (json.data ?? []).map((c) => {
    const fromId = c.from?.id ?? null
    return {
      commentId: c.id,
      postId,
      message: c.message ?? '',
      fromId,
      fromName: c.from?.name ?? null,
      createdAt: c.created_time ?? new Date().toISOString(),
      isFromPage: fromId === pageId,
    }
  })
}

/**
 * Post a public reply nested under a comment.
 * Returns the new reply's comment id, or null on failure.
 */
export async function replyToComment(
  commentId: string,
  message: string,
  pageAccessToken: string,
): Promise<string | null> {
  const url = `${GRAPH_BASE}/${commentId}/comments`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: pageAccessToken }).toString(),
    })
  } catch (err) {
    console.error('[meta/comments] replyToComment error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/comments] replyToComment HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = (await res.json()) as { id?: string }
  return json.id ?? null
}

/**
 * Send a private (DM) reply to the person who wrote a comment.
 * Only valid within 7 days of the comment and once per comment.
 * Returns true on success.
 */
export async function sendPrivateReply(
  commentId: string,
  message: string,
  pageAccessToken: string,
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${commentId}/private_replies`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: pageAccessToken }).toString(),
    })
  } catch (err) {
    console.error('[meta/comments] sendPrivateReply error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/comments] sendPrivateReply HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  return true
}

/**
 * Delete a comment we own (e.g. revert an auto-reply from the audit view).
 * Returns true on success.
 */
export async function deleteComment(
  commentId: string,
  pageAccessToken: string,
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${commentId}?access_token=${encodeURIComponent(pageAccessToken)}`
  let res: Response
  try {
    res = await fetch(url, { method: 'DELETE' })
  } catch (err) {
    console.error('[meta/comments] deleteComment error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/comments] deleteComment HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = (await res.json()) as { success?: boolean }
  return json.success === true
}

/**
 * Hide (not delete) a comment — used for spam.
 * Returns true on success.
 */
export async function hideComment(
  commentId: string,
  pageAccessToken: string,
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${commentId}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ is_hidden: 'true', access_token: pageAccessToken }).toString(),
    })
  } catch (err) {
    console.error('[meta/comments] hideComment error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/comments] hideComment HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = (await res.json()) as { success?: boolean }
  return json.success === true
}
