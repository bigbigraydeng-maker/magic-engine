/**
 * Facebook Page Stories — publish photo/video Stories and read them back.
 *
 * Pure and injectable: every function takes an optional `fetcher` and never
 * touches the network unless the caller supplies one (defaults to global fetch).
 * Transport and failure classification are delegated to ./story-graph, which
 * mirrors `publishPagePhotoPost` in ./page-posts so callers can reason about
 * retry safety the same way across posts and stories.
 *
 * NOTE: `timeoutMs` applies PER REQUEST. A three-step video story (start,
 * upload, finish) can therefore take up to 3x `timeoutMs` in the worst case.
 */

import { GRAPH_BASE } from './graph-base'
import { PagePublishError } from './page-posts'
import {
  assertGraphId,
  assertHttpsUrl,
  getGraphJson,
  postGraphJson,
  requestGraph,
} from './story-graph'

export interface PublishedPageStory {
  postId: string
  raw: Record<string, unknown>
}

export interface PageStoryRow {
  postId: string
  status: string
  creationTime: string | null
  mediaType: string | null
  mediaId: string | null
  url: string | null
}

/**
 * Re-throw a PagePublishError preserving its classification detail fields but
 * appending a suffix to the message. Non-PagePublishError values are rethrown
 * unchanged.
 */
function rethrowWithSuffix(error: unknown, suffix: string): never {
  if (error instanceof PagePublishError) {
    throw new PagePublishError(`${error.message}${suffix}`, {
      certainty: error.certainty,
      httpStatus: error.httpStatus,
      graphCode: error.graphCode,
      graphSubcode: error.graphSubcode,
    })
  }
  throw error
}

/**
 * Publish a photo Story to a Facebook Page.
 *
 * Two steps: upload the image as an unpublished photo (`published:false`) to get
 * a photo id, then attach that photo to the Page's photo_stories edge.
 *
 * NOTE: the unpublished photo object created by step 1 is not cleaned up here;
 * a step-2 failure leaves it behind. Cleanup is out of scope for this change.
 *
 * TODO(story-link-sticker): link sticker parameter support is unverified; do not add.
 */
export async function publishPagePhotoStory(input: {
  pageId: string
  pageAccessToken: string
  imageUrl: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<PublishedPageStory> {
  assertGraphId(input.pageId, 'publishPagePhotoStory pageId')
  assertHttpsUrl(input.imageUrl, 'publishPagePhotoStory imageUrl')

  const photo = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/photos`,
    body: { url: input.imageUrl, published: false, access_token: input.pageAccessToken },
    label: `publishPagePhotoStory ${input.pageId} (upload)`,
    secrets: [input.pageAccessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const photoId = photo.id
  if (!photoId) {
    throw new PagePublishError(`publishPagePhotoStory ${input.pageId}: provider returned no photo id`, {
      certainty: 'unknown',
    })
  }

  let story: Awaited<ReturnType<typeof postGraphJson>>
  try {
    story = await postGraphJson({
      url: `${GRAPH_BASE}/${input.pageId}/photo_stories`,
      body: { photo_id: photoId, access_token: input.pageAccessToken },
      label: `publishPagePhotoStory ${input.pageId} (publish)`,
      secrets: [input.pageAccessToken],
      timeoutMs: input.timeoutMs,
      fetcher: input.fetcher,
    })
  } catch (error: unknown) {
    rethrowWithSuffix(error, `; unpublished photo ${photoId} left behind (step 1 succeeded)`)
  }
  const postId = story.post_id
  if (!postId) {
    throw new PagePublishError(
      `publishPagePhotoStory ${input.pageId}: provider returned no post id; unpublished photo ${photoId} may be left behind`,
      { certainty: 'unknown' },
    )
  }
  return { postId, raw: story as Record<string, unknown> }
}

/**
 * Publish a video Story to a Facebook Page.
 *
 * Three steps: start an upload session, upload the bytes from `videoUrl`, then
 * finish the session. The caller must ensure `videoUrl` is a host Meta accepts.
 *
 * UNVERIFIED: the upload header names/format come from a documentation summary
 * and have not been confirmed by a real call.
 */
export async function publishPageVideoStory(input: {
  pageId: string
  pageAccessToken: string
  videoUrl: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<PublishedPageStory> {
  assertGraphId(input.pageId, 'publishPageVideoStory pageId')
  assertHttpsUrl(input.videoUrl, 'publishPageVideoStory videoUrl')

  const { videoId, uploadUrl } = await startVideoSession(input)
  const suffix = `; video upload session video_id=${videoId} (check its state before any retry)`
  try {
    assertHttpsUrl(uploadUrl, 'publishPageVideoStory upload_url', ['facebook.com', 'fbcdn.net'])
    await uploadVideoBytes({
      uploadUrl,
      videoUrl: input.videoUrl,
      pageAccessToken: input.pageAccessToken,
      label: `publishPageVideoStory ${input.pageId} (upload)`,
      timeoutMs: input.timeoutMs,
      fetcher: input.fetcher,
    })
    return await finishVideoSession({ ...input, videoId })
  } catch (error: unknown) {
    return rethrowWithSuffix(error, suffix)
  }
}

/** Step 1: open an upload session; a missing video_id/upload_url is an unknown outcome. */
async function startVideoSession(input: {
  pageId: string
  pageAccessToken: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<{ videoId: string; uploadUrl: string }> {
  const start = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/video_stories`,
    body: { upload_phase: 'start', access_token: input.pageAccessToken },
    label: `publishPageVideoStory ${input.pageId} (start)`,
    secrets: [input.pageAccessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  if (!start.video_id || !start.upload_url) {
    throw new PagePublishError(`publishPageVideoStory ${input.pageId}: provider returned no upload session`, {
      certainty: 'unknown',
    })
  }
  return { videoId: start.video_id, uploadUrl: start.upload_url }
}

/** Step 3: finish the session; a missing post_id is an unknown outcome. */
async function finishVideoSession(input: {
  pageId: string
  pageAccessToken: string
  videoId: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<PublishedPageStory> {
  const finish = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/video_stories`,
    body: { video_id: input.videoId, upload_phase: 'finish', access_token: input.pageAccessToken },
    label: `publishPageVideoStory ${input.pageId} (finish)`,
    secrets: [input.pageAccessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  if (!finish.post_id) {
    throw new PagePublishError(`publishPageVideoStory ${input.pageId}: provider returned no post id`, {
      certainty: 'unknown',
    })
  }
  return { postId: finish.post_id, raw: finish as Record<string, unknown> }
}

/**
 * Upload the video bytes to the session's upload_url. The `file_url` header
 * tells Graph where to pull the bytes from; the OAuth header carries the Page
 * token. Same failure classification as the JSON steps.
 *
 * UNVERIFIED: the upload header names/format come from a documentation summary
 * and have not been confirmed by a real call.
 */
async function uploadVideoBytes(input: {
  uploadUrl: string
  videoUrl: string
  pageAccessToken: string
  label: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<void> {
  // TODO(verify-with-real-call): exact upload headers
  await requestGraph({
    url: input.uploadUrl,
    method: 'POST',
    headers: {
      file_url: input.videoUrl,
      Authorization: `OAuth ${input.pageAccessToken}`,
    },
    label: input.label,
    secrets: [input.pageAccessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
}

interface RawStory {
  post_id?: string
  status?: string
  creation_time?: string
  media_type?: string
  media_id?: string
  url?: string
}

/** Type guard for a raw story entry coming back from Graph. */
function isRawStory(value: unknown): value is RawStory {
  return typeof value === 'object' && value !== null
}

/** Map a raw story entry to a PageStoryRow, or null when post_id is missing. */
function toPageStoryRow(raw: RawStory): PageStoryRow | null {
  const postId = raw.post_id
  if (!postId) return null
  return {
    postId,
    status: raw.status ?? '',
    creationTime: raw.creation_time ?? null,
    mediaType: raw.media_type ?? null,
    mediaId: raw.media_id ?? null,
    url: raw.url ?? null,
  }
}

/**
 * Read back a Page's Stories for post-publish verification. `since`/`until`
 * are sent as unix seconds. Never throws on an empty list; a Graph error is
 * surfaced as a PagePublishError with the same classification as publishing.
 * Entries without a post_id are dropped. `hasMore` is true when Graph returns
 * a non-empty `paging.next` cursor.
 */
export async function listPageStories(input: {
  pageId: string
  pageAccessToken: string
  since?: Date
  until?: Date
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<{ stories: PageStoryRow[]; hasMore: boolean }> {
  assertGraphId(input.pageId, 'listPageStories pageId')

  const fields = 'post_id,status,creation_time,media_type,media_id,url'
  const params = new URLSearchParams({ fields, access_token: input.pageAccessToken })
  if (input.since) params.set('since', String(Math.floor(input.since.getTime() / 1000)))
  if (input.until) params.set('until', String(Math.floor(input.until.getTime() / 1000)))
  const url = `${GRAPH_BASE}/${input.pageId}/stories?${params.toString()}`

  const body = await getGraphJson({
    url,
    label: `listPageStories ${input.pageId}`,
    secrets: [input.pageAccessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })

  const stories: PageStoryRow[] = []
  for (const entry of body.data ?? []) {
    if (!isRawStory(entry)) continue
    const row = toPageStoryRow(entry)
    if (row) stories.push(row)
  }
  const next = body.paging?.next
  const hasMore = typeof next === 'string' && next.length > 0
  return { stories, hasMore }
}
