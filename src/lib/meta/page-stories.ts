/**
 * Facebook Page Stories — publish photo/video Stories and read them back.
 *
 * Pure and injectable: every function takes an optional `fetcher` and never
 * touches the network unless the caller supplies one (defaults to global fetch).
 * Error classification mirrors `publishPagePhotoPost` in ./page-posts so callers
 * can reason about retry safety the same way across posts and stories.
 */

import { GRAPH_BASE } from './graph-base'
import { PagePublishError, classifyPublishFailure } from './page-posts'

export interface PublishedPageStory {
  postId: string
  raw: Record<string, unknown>
}

interface GraphErrorBody {
  message?: string
  code?: number
  error_subcode?: number
}

interface GraphResponseBody {
  id?: string
  post_id?: string
  video_id?: string
  upload_url?: string
  error?: GraphErrorBody
}

/**
 * POST a JSON body to a Graph edge and classify the outcome exactly like
 * `publishPagePhotoPost`:
 *  - fetch throws (no response)            => certainty 'unknown'
 *  - 2xx carrying a Graph error body       => certainty 'unknown'
 *  - non-2xx                               => classifyPublishFailure(status, error)
 * The thrown message never contains the access token.
 */
async function postGraphJson(input: {
  url: string
  body: Record<string, unknown>
  label: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<GraphResponseBody> {
  const doFetch = input.fetcher ?? fetch
  let res: Response
  try {
    res = await doFetch(input.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.body),
      ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
    })
  } catch (error: unknown) {
    // No response at all: the request may or may not have reached Facebook.
    const reason = error instanceof Error ? error.message : String(error)
    throw new PagePublishError(reason, { certainty: 'unknown' })
  }

  const body = (await res.json().catch(() => null)) as GraphResponseBody | null
  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`
    throw new PagePublishError(`${input.label}: ${detail}`, {
      // A 2xx that carries an error body is not a clear refusal — treat as unknown.
      certainty: res.ok ? 'unknown' : classifyPublishFailure(res.status, body?.error),
      httpStatus: res.status,
      graphCode: body?.error?.code ?? null,
      graphSubcode: body?.error?.error_subcode ?? null,
    })
  }
  return body ?? {}
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
  const photo = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/photos`,
    body: { url: input.imageUrl, published: false, access_token: input.pageAccessToken },
    label: `publishPagePhotoStory ${input.pageId} (upload)`,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const photoId = photo.id
  if (!photoId) {
    throw new PagePublishError(`publishPagePhotoStory ${input.pageId}: provider returned no photo id`, {
      certainty: 'unknown',
    })
  }

  const story = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/photo_stories`,
    body: { photo_id: photoId, access_token: input.pageAccessToken },
    label: `publishPagePhotoStory ${input.pageId} (publish)`,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const postId = story.post_id
  if (!postId) {
    throw new PagePublishError(`publishPagePhotoStory ${input.pageId}: provider returned no post id`, {
      certainty: 'unknown',
    })
  }
  return { postId, raw: story as Record<string, unknown> }
}

/**
 * Publish a video Story to a Facebook Page.
 *
 * Three steps: start an upload session, upload the bytes from `videoUrl`, then
 * finish the session. The caller must ensure `videoUrl` is a host Meta accepts.
 */
export async function publishPageVideoStory(input: {
  pageId: string
  pageAccessToken: string
  videoUrl: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<PublishedPageStory> {
  const start = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/video_stories`,
    body: { upload_phase: 'start', access_token: input.pageAccessToken },
    label: `publishPageVideoStory ${input.pageId} (start)`,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const videoId = start.video_id
  const uploadUrl = start.upload_url
  if (!videoId || !uploadUrl) {
    throw new PagePublishError(`publishPageVideoStory ${input.pageId}: provider returned no upload session`, {
      certainty: 'unknown',
    })
  }

  await uploadVideoBytes({
    uploadUrl,
    videoUrl: input.videoUrl,
    pageAccessToken: input.pageAccessToken,
    label: `publishPageVideoStory ${input.pageId} (upload)`,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })

  const finish = await postGraphJson({
    url: `${GRAPH_BASE}/${input.pageId}/video_stories`,
    body: { video_id: videoId, upload_phase: 'finish', access_token: input.pageAccessToken },
    label: `publishPageVideoStory ${input.pageId} (finish)`,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const postId = finish.post_id
  if (!postId) {
    throw new PagePublishError(`publishPageVideoStory ${input.pageId}: provider returned no post id`, {
      certainty: 'unknown',
    })
  }
  return { postId, raw: finish as Record<string, unknown> }
}

/**
 * Upload the video bytes to the session's upload_url. The `file_url` header
 * tells Graph where to pull the bytes from; the OAuth header carries the Page
 * token. Same failure classification as the JSON steps.
 */
async function uploadVideoBytes(input: {
  uploadUrl: string
  videoUrl: string
  pageAccessToken: string
  label: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<void> {
  const doFetch = input.fetcher ?? fetch
  let res: Response
  try {
    // TODO(verify-with-real-call): exact upload headers
    res = await doFetch(input.uploadUrl, {
      method: 'POST',
      headers: {
        file_url: input.videoUrl,
        Authorization: `OAuth ${input.pageAccessToken}`,
      },
      ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new PagePublishError(reason, { certainty: 'unknown' })
  }

  const body = (await res.json().catch(() => null)) as GraphResponseBody | null
  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`
    throw new PagePublishError(`${input.label}: ${detail}`, {
      certainty: res.ok ? 'unknown' : classifyPublishFailure(res.status, body?.error),
      httpStatus: res.status,
      graphCode: body?.error?.code ?? null,
      graphSubcode: body?.error?.error_subcode ?? null,
    })
  }
}

export interface PageStoryRow {
  postId: string
  status: string
  creationTime: string | null
  mediaType: string | null
  mediaId: string | null
  url: string | null
}

interface RawStory {
  post_id?: string
  status?: string
  creation_time?: string
  media_type?: string
  media_id?: string
  url?: string
}

/**
 * Read back a Page's Stories for post-publish verification. `since`/`until`
 * are sent as unix seconds. Never throws on an empty list; a Graph error is
 * surfaced as a PagePublishError with the same classification as publishing.
 */
export async function listPageStories(input: {
  pageId: string
  pageAccessToken: string
  since?: Date
  until?: Date
  fetcher?: typeof fetch
}): Promise<PageStoryRow[]> {
  const doFetch = input.fetcher ?? fetch
  const fields = 'post_id,status,creation_time,media_type,media_id,url'
  const params = new URLSearchParams({ fields, access_token: input.pageAccessToken })
  if (input.since) params.set('since', String(Math.floor(input.since.getTime() / 1000)))
  if (input.until) params.set('until', String(Math.floor(input.until.getTime() / 1000)))
  const url = `${GRAPH_BASE}/${input.pageId}/stories?${params.toString()}`

  let res: Response
  try {
    res = await doFetch(url)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new PagePublishError(reason, { certainty: 'unknown' })
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: RawStory[]; error?: GraphErrorBody }
    | null
  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`
    throw new PagePublishError(`listPageStories ${input.pageId}: ${detail}`, {
      certainty: res.ok ? 'unknown' : classifyPublishFailure(res.status, body?.error),
      httpStatus: res.status,
      graphCode: body?.error?.code ?? null,
      graphSubcode: body?.error?.error_subcode ?? null,
    })
  }

  return (body?.data ?? []).map((s) => ({
    postId: s.post_id ?? '',
    status: s.status ?? '',
    creationTime: s.creation_time ?? null,
    mediaType: s.media_type ?? null,
    mediaId: s.media_id ?? null,
    url: s.url ?? null,
  }))
}
