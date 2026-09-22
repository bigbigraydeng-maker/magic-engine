/**
 * Meta Page posts — fetch organic FB Page Reels/videos + score by engagement.
 *
 * Used by winner-reel-sync engine to identify winners for automatic promotion
 * to a paid Pool Builder Ad Set.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export interface PagePost {
  postId: string
  fullId: string       // "<page_id>_<post_id>"
  createdAt: string    // ISO
  message: string
  mediaType: string    // 'video' | 'photo' | 'album' | 'link' | ...
  reactions: number
  comments: number
  shares: number
  score: number        // engagement score, see scorePost()
}

interface RawAttachment {
  media_type?: string
}

interface RawPost {
  id: string
  message?: string
  created_time?: string
  attachments?: { data?: RawAttachment[] }
  reactions?: { summary?: { total_count?: number } }
  comments?:  { summary?: { total_count?: number } }
  shares?:    { count?: number }
}

/**
 * engagement score with a recency boost so a strong new post outranks a stale one.
 * Weights: reactions=1, comments=2, shares=3 (shares are the strongest interest signal).
 * recencyBoost: 1.5 if within 7 days, 1.2 within 30 days, 1.0 older.
 */
export function scorePost(
  reactions: number,
  comments: number,
  shares: number,
  createdAt: string,
): number {
  const base = reactions + comments * 2 + shares * 3
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  const boost = ageDays < 7 ? 1.5 : ageDays < 30 ? 1.2 : 1.0
  return Math.round(base * boost)
}

/**
 * Fetch recent published posts from a FB Page.
 * Requires a Page Access Token (User Token cannot list /published_posts).
 */
export async function fetchPagePosts(
  pageId: string,
  pageAccessToken: string,
  limit = 30,
): Promise<PagePost[]> {
  const fields = [
    'id',
    'message',
    'created_time',
    'attachments{media_type}',
    'reactions.summary(true)',
    'comments.summary(true)',
    'shares',
  ].join(',')

  const url = `${GRAPH_BASE}/${pageId}/published_posts?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(pageAccessToken)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetchPagePosts ${pageId}: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { data?: RawPost[]; error?: { message: string } }
  if (body.error) throw new Error(`fetchPagePosts ${pageId}: ${body.error.message}`)

  return (body.data ?? []).map((p) => {
    const postId = p.id.includes('_') ? p.id.split('_')[1] : p.id
    const attachment = p.attachments?.data?.[0]
    const rx = p.reactions?.summary?.total_count ?? 0
    const cm = p.comments?.summary?.total_count  ?? 0
    const sh = p.shares?.count                   ?? 0
    const createdAt = p.created_time ?? new Date().toISOString()
    return {
      postId,
      fullId: p.id,
      createdAt,
      message: p.message ?? '',
      mediaType: attachment?.media_type ?? 'unknown',
      reactions: rx,
      comments: cm,
      shares: sh,
      score: scorePost(rx, cm, sh, createdAt),
    }
  })
}

/**
 * Filter posts to video-type only, drop blacklisted-keyword posts, then sort by score.
 */
export function rankVideoWinners(
  posts: PagePost[],
  blacklistKeywords: string[] = [],
  minScore = 0,
): PagePost[] {
  const bl = blacklistKeywords.map((k) => k.toLowerCase())
  return posts
    .filter((p) => p.mediaType === 'video')
    .filter((p) => p.score >= minScore)
    .filter((p) => !bl.some((k) => p.message.toLowerCase().includes(k)))
    .sort((a, b) => b.score - a.score)
}

/**
 * Fetch a Page's Reels (video reels). Reels are video objects — their comments
 * live on the video object, NOT on the /published_posts "feed" representation
 * (which undercounts). Returns PagePost-shaped rows so callers can treat reels
 * and posts uniformly; `postId` here is the reel's video id, usable directly
 * with the /{id}/comments edge.
 *
 * Graceful: returns [] on any error (the edge/permission may vary per account).
 */
export async function fetchPageReels(
  pageId: string,
  pageAccessToken: string,
  limit = 50,
): Promise<PagePost[]> {
  const fields = ['id', 'created_time', 'description', 'comments.filter(stream).summary(true).limit(0)'].join(',')
  const url = `${GRAPH_BASE}/${pageId}/video_reels?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(pageAccessToken)}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/page-posts] fetchPageReels error:', err)
    return []
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/page-posts] fetchPageReels HTTP ${res.status}:`, body.slice(0, 200))
    return []
  }

  const body = (await res.json()) as {
    data?: Array<{ id: string; created_time?: string; description?: string; comments?: { summary?: { total_count?: number } } }>
    error?: { message: string }
  }
  if (body.error) {
    console.error('[meta/page-posts] fetchPageReels error:', body.error.message)
    return []
  }

  return (body.data ?? []).map((r) => {
    const createdAt = r.created_time ?? new Date().toISOString()
    const cm = r.comments?.summary?.total_count ?? 0
    return {
      postId: r.id,
      fullId: r.id,
      createdAt,
      message: r.description ?? '',
      mediaType: 'reel',
      reactions: 0,
      comments: cm,
      shares: 0,
      score: 0,
    }
  })
}

export interface ManagedPage {
  id: string
  name: string
}

/** 10 × 100 Pages — far above any identity we hold; bounds a runaway cursor. */
const MAX_MANAGED_PAGE_REQUESTS = 10

/**
 * The Pages this token can act for, so ME can offer a pick-list instead of
 * asking someone to hunt down a numeric Page ID. The vanity URL a client gives
 * you (facebook.com/CTSTOURS) is not the id the Graph API needs, and there is
 * no reliable way to convert one to the other by hand.
 *
 * Returns null when the token is rejected — the caller shows "not connected"
 * rather than an empty list, which would read as "you manage no Pages".
 */
export async function listManagedPages(userToken: string): Promise<ManagedPage[] | null> {
  // Follow paging.next: an identity managing more than one page of results would
  // otherwise make binding verification reject a Page that is really there.
  let url: string | null = `${GRAPH_BASE}/me/accounts?fields=id,name&limit=100&access_token=${encodeURIComponent(userToken)}`
  const out: ManagedPage[] = []
  for (let page = 0; url && page < MAX_MANAGED_PAGE_REQUESTS; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch {
      return null
    }
    if (!res.ok) return null

    const body = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>
      paging?: { next?: string }
    }
    for (const p of body.data ?? []) {
      if (typeof p.id === 'string') out.push({ id: p.id, name: p.name ?? p.id })
    }
    url = typeof body.paging?.next === 'string' ? body.paging.next : null
  }
  return out
}

/**
 * Exchange the caller's User access token for a Page access token.
 * Meta's /me/accounts endpoint returns each Page the user manages + its own token.
 */
export async function getPageAccessToken(
  userToken: string,
  pageId: string,
): Promise<string | null> {
  const url = `${GRAPH_BASE}/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(userToken)}`
  const res = await fetch(url)
  if (!res.ok) return null
  const body = (await res.json()) as { data?: Array<{ id: string; access_token: string }> }
  return body.data?.find((p) => p.id === pageId)?.access_token ?? null
}

export interface PublishedPagePost {
  /** The feed post id — this is what Insights and permalinks key off. */
  postId: string
  /** Which Graph field the id came from. `/photos` returns both `id` (the
   *  photo object) and `post_id` (the feed story); they are not the same
   *  object and only the latter is a Page post. We prefer `post_id` and record
   *  when we had to fall back, rather than silently passing off a photo id as
   *  a post id. A scheduled photo only ever returns `id` — its story id is
   *  resolved later, after it goes public (see `readPageStoryId`). */
  postIdSource: 'post_id' | 'id'
  permalink: string
  /** Raw response, kept verbatim so a receipt can be audited later. */
  raw: Record<string, unknown>
}

/** Fixed reason codes — never raw Graph error text, which can carry ids/tokens. */
export type PageStoryIdFailureReason =
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'graph_error'
  | 'object_not_found'
  | 'no_page_story_id'
  | 'page_prefix_mismatch'

export type PageStoryIdReadback =
  | { ok: true; postId: string }
  | { ok: false; reason: PageStoryIdFailureReason }

const STORY_ID_TIMEOUT_MS = 10_000

function storyIdHttpFailure(
  res: Response,
  body: { error?: { code?: number; error_subcode?: number } } | null,
): PageStoryIdReadback | null {
  // Code 100 alone is "invalid parameter" and covers many things; only subcode
  // 33 means the object does not exist (same rule as meta/post-engagement.ts).
  if (body?.error) {
    const gone = body.error.code === 100 && body.error.error_subcode === 33
    return { ok: false, reason: gone ? 'object_not_found' : 'graph_error' }
  }
  if (!res.ok) return { ok: false, reason: 'http_error' }
  return null
}

/**
 * Read a photo's feed story id (`page_story_id`) back from Graph.
 *
 * Meta documents `page_story_id` as applying only to *published* photos, so a
 * scheduled photo has none until Facebook makes it public — callers must wait
 * until after `scheduled_publish_time` (see the story-resolve workflow).
 *
 * Only an id of the form `<pageId>_<digits>` is accepted: anything else is not
 * a story on this Page. Never throws; `object_not_found` (Graph code 100 + subcode 33) means
 * the photo is gone, e.g. recalled.
 */
export async function readPageStoryId(input: {
  photoId: string
  pageId: string
  pageAccessToken: string
  fetcher?: typeof fetch
  timeoutMs?: number
}): Promise<PageStoryIdReadback> {
  const doFetch = input.fetcher ?? fetch
  const url = `${GRAPH_BASE}/${encodeURIComponent(input.photoId)}?fields=page_story_id&access_token=${encodeURIComponent(input.pageAccessToken)}`
  let res: Response
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(input.timeoutMs ?? STORY_ID_TIMEOUT_MS) })
  } catch (error: unknown) {
    // The abort reason is a DOMException, which is not always `instanceof Error`.
    const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' }
  }
  const body = (await res.json().catch(() => null)) as
    | { page_story_id?: unknown; error?: { code?: number; error_subcode?: number } }
    | null
  const failure = storyIdHttpFailure(res, body)
  if (failure) return failure

  const storyId = body?.page_story_id
  if (typeof storyId !== 'string' || storyId.length === 0) return { ok: false, reason: 'no_page_story_id' }
  if (!/^\d{5,25}_\d{5,25}$/.test(storyId) || !storyId.startsWith(`${input.pageId}_`)) {
    return { ok: false, reason: 'page_prefix_mismatch' }
  }
  return { ok: true, postId: storyId }
}

/**
 * Publish a photo Post to a Facebook Page.
 *
 * Uses the Page's own `/photos` edge with a remote image `url`, so ME never
 * has to stage the bytes itself. Requires a *Page* access token — a User token
 * is rejected by Graph for this edge.
 *
 * `scheduledPublishTime`: when set, Facebook holds the post and publishes it
 * itself at that time. Preferred over ME holding the post: Facebook's own
 * scheduler survives our restarts, appears in Business Suite where the client
 * can see and edit it, and needs zero infrastructure on our side. Constraints:
 * Graph requires the timestamp to be at least 10 minutes and at most ~6 months
 * in the future; the caller decides "publish now vs schedule" before this
 * function, so we can pass unchanged what we're told.
 *
 * Throws on any non-2xx or Graph-level error; the caller decides whether that
 * is fatal for the batch. It never retries: a retry here could double-post,
 * and duplicate suppression belongs to the caller's idempotency key.
 */
export async function publishPagePhotoPost(input: {
  pageId: string
  pageAccessToken: string
  message: string
  imageUrl: string
  scheduledPublishTime?: Date
  fetcher?: typeof fetch
}): Promise<PublishedPagePost> {
  const doFetch = input.fetcher ?? fetch

  const requestBody: Record<string, unknown> = {
    url: input.imageUrl,
    caption: input.message,
    access_token: input.pageAccessToken,
  }
  if (input.scheduledPublishTime) {
    // Facebook's contract for scheduled posts. `published:false` alone would
    // create a hidden draft; the pair is what tells Facebook to auto-publish.
    requestBody.published = false
    requestBody.scheduled_publish_time = Math.floor(input.scheduledPublishTime.getTime() / 1000)
  } else {
    requestBody.published = true
  }

  const res = await doFetch(`${GRAPH_BASE}/${input.pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  const body = (await res.json().catch(() => null)) as
    | { id?: string; post_id?: string; error?: { message?: string } }
    | null

  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`publishPagePhotoPost ${input.pageId}: ${detail}`)
  }

  const postId = body?.post_id ?? body?.id
  if (!postId) throw new Error(`publishPagePhotoPost ${input.pageId}: provider returned no post id`)

  return {
    postId,
    postIdSource: body?.post_id ? 'post_id' : 'id',
    permalink: `https://www.facebook.com/${postId}`,
    raw: (body ?? {}) as Record<string, unknown>,
  }
}

/**
 * Delete a Page post — used by the recall flow to undo an unwanted publish.
 *
 * Idempotent in effect: a fresh delete returns `{success:true}`; a post that
 * was already deleted (or never existed under this id) comes back as Graph
 * code 100 "object does not exist", which we fold into a normal success so a
 * retry of the same recall does not surface as a failure. Any other error is
 * thrown so the batch can decide whether to keep going.
 *
 * Requires a Page access token with `pages_manage_posts`, same as publish.
 */
export async function deletePagePost(input: {
  postId: string
  pageAccessToken: string
  fetcher?: typeof fetch
}): Promise<{ alreadyGone: boolean; raw: Record<string, unknown> }> {
  const doFetch = input.fetcher ?? fetch
  const url = `${GRAPH_BASE}/${encodeURIComponent(input.postId)}?access_token=${encodeURIComponent(input.pageAccessToken)}`
  const res = await doFetch(url, { method: 'DELETE' })
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; error?: { message?: string; code?: number } }
    | null

  if (res.ok && body?.success) {
    return { alreadyGone: false, raw: (body ?? {}) as Record<string, unknown> }
  }
  if (body?.error?.code === 100) {
    return { alreadyGone: true, raw: (body ?? {}) as Record<string, unknown> }
  }

  const detail = body?.error?.message ?? `HTTP ${res.status}`
  throw new Error(`deletePagePost ${input.postId}: ${detail}`)
}
