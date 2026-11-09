/**
 * Meta Graph API — Page comment read/reply/hide/private-reply.
 *
 * Mirrors the style of meta/client.ts: thin fetch wrappers, graceful failure
 * (return null / false and log rather than throw), Page access token passed in.
 *
 * Requires a Page Access Token with pages_read_engagement + pages_read_user_content
 * (reading comments other people wrote) and pages_manage_engagement (reply/hide).
 * Without pages_read_user_content Graph answers #10 on every such read.
 * Private replies additionally require pages_messaging and only work within
 * 7 days of the comment, once per comment.
 */

import { GRAPH_BASE } from './graph-base'

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
 * Why a comment read failed, in the only terms that matter to the caller:
 * is calling again next run capable of a different answer?
 *
 *   permission_denied  — the token may not read other people's comments here
 *                        (Graph #10 / #200). Needs a human to widen the scope.
 *   object_gone        — deleted, or invisible to this token (Graph #100/33).
 *   deprecated_object  — Graph has no endpoint for this object any more (#12).
 *                        Legacy "status" objects; there is no replacement call.
 *   token_invalid      — token expired / revoked (#190). Page-wide, not per-post.
 *   transient          — rate limit, 5xx, network. Retrying is the right move.
 */
export type CommentFetchFailureReason =
  | 'permission_denied'
  | 'object_gone'
  | 'deprecated_object'
  | 'token_invalid'
  | 'transient'

export interface CommentFetchFailure {
  reason: CommentFetchFailureReason
  /** Graph `error.code`, null when the body was not Graph JSON. */
  code: number | null
  /** Graph `error.error_subcode`, null when absent. */
  subcode: number | null
  message: string
  /** true = worth calling again next run; false = nothing changes until a human/config does. */
  transient: boolean
}

export type CommentFetchResult =
  | { ok: true; comments: PageComment[] }
  | { ok: false; failure: CommentFetchFailure }

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number }
}

function reasonFor(
  code: number | null,
  subcode: number | null,
  message: string,
): CommentFetchFailureReason {
  if (code === 190) return 'token_invalid'
  if (code === 10 || code === 200) return 'permission_denied'
  if (code === 12) return 'deprecated_object'
  if (code === 100) {
    // #100/33 is Meta's single answer for "deleted" and "your token cannot see
    // it" — indistinguishable from outside, and a dead end either way.
    return subcode === 33 || /does not exist/i.test(message) ? 'object_gone' : 'transient'
  }
  return 'transient'
}

/**
 * Turn a Graph error body into a verdict. Exported for tests — the whole
 * retry/skip decision hangs on this, so it must be checkable without a network.
 *
 * Unrecognised shapes fall through to 'transient': over-retrying a handful of
 * posts is cheap, permanently skipping a post that would have worked is not.
 */
export function classifyCommentFetchError(rawBody: string): CommentFetchFailure {
  let parsed: GraphErrorBody | null = null
  try {
    parsed = JSON.parse(rawBody) as GraphErrorBody
  } catch {
    parsed = null
  }
  const err = parsed?.error
  const code = typeof err?.code === 'number' ? err.code : null
  const subcode = typeof err?.error_subcode === 'number' ? err.error_subcode : null
  const message = err?.message ?? rawBody.slice(0, 200)
  const reason = reasonFor(code, subcode, message)
  return { reason, code, subcode, message, transient: reason === 'transient' }
}

/**
 * Fetch comments on a single post, newest first — telling the caller WHY a read
 * failed instead of flattening every failure into an empty list.
 *
 * `postId` must be the id Graph accepts on the /comments edge: for a Page feed
 * post that is the full `<page_id>_<post_id>` form. Passing the bare suffix
 * makes Graph resolve it as a legacy singular status object and answer #12.
 *
 * `pageId` is used only to mark self-authored comments (isFromPage).
 */
export async function fetchPostCommentsResult(
  postId: string,
  pageId: string,
  pageAccessToken: string,
  limit = 50,
): Promise<CommentFetchResult> {
  const params = new URLSearchParams({
    fields: 'id,message,created_time,from',
    // 'stream' returns ALL comments (top-level + nested replies + comments that
    // arrived via paid/boosted delivery), whereas the default 'toplevel' hides
    // most of them on a boosted post/Reel.
    filter: 'stream',
    order: 'reverse_chronological',
    limit: String(limit),
    access_token: pageAccessToken,
  })
  const url = `${GRAPH_BASE}/${postId}/comments?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[meta/comments] fetchPostComments error:', message)
    return { ok: false, failure: { reason: 'transient', code: null, subcode: null, message, transient: true } }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const failure = classifyCommentFetchError(body)
    // Keep the old log prefix (ops greps for it) but say which kind of failure
    // it is — a 400 that repeats hourly and a 400 we will never retry are not
    // the same event, and the old line could not tell them apart.
    console.error(
      `[meta/comments] fetchPostComments HTTP ${res.status} post=${postId} reason=${failure.reason}:`,
      failure.message.slice(0, 200),
    )
    return { ok: false, failure }
  }

  const json = (await res.json()) as { data?: RawComment[] }
  const comments = (json.data ?? []).map((c) => {
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
  return { ok: true, comments }
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
