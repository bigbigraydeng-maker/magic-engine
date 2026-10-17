/**
 * YouTube Data API v3 publishing adapter (L3 Connector, Publishing Hub family).
 *
 * Scope of this module: channel identity lock, non-public upload (private /
 * unlisted), thumbnail upload and read-back. Going Public is a separate,
 * gated step (see gates.ts) and is intentionally NOT implemented here.
 *
 * The target channel id is client configuration passed in by the caller;
 * nothing client-specific lives in this file.
 */

const API = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3'

/** Separate from COMBINED_GOOGLE_SCOPES on purpose: widening the shared set silently breaks live connections. */
export const YOUTUBE_PUBLISH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

export type StagingPrivacy = 'private' | 'unlisted'

export interface YouTubeChannel {
  id: string
  title: string
}

export class ChannelLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChannelLockError'
  }
}

type FetchLike = typeof fetch

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

async function failOnError(res: Response, what: string): Promise<void> {
  if (res.ok) return
  throw new Error(`YouTube ${what} failed (${res.status}): ${await res.text()}`)
}

export async function listAuthorizedChannels(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<YouTubeChannel[]> {
  const res = await fetchImpl(`${API}/channels?part=id,snippet&mine=true`, {
    headers: authHeaders(accessToken),
  })
  await failOnError(res, 'channels.list')
  const data = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>
  }
  return (data.items ?? []).map((i) => ({ id: i.id, title: i.snippet?.title ?? '' }))
}

/** Exact-match lock: throws unless the authorised account manages the expected channel. */
export async function lockChannel(
  accessToken: string,
  expectedChannelId: string,
  fetchImpl: FetchLike = fetch,
): Promise<YouTubeChannel> {
  const channels = await listAuthorizedChannels(accessToken, fetchImpl)
  const match = channels.find((c) => c.id === expectedChannelId)
  if (!match) {
    throw new ChannelLockError(
      `Authorised account does not manage channel ${expectedChannelId}; refusing to write.`,
    )
  }
  return match
}

export interface UploadInput {
  title: string
  description: string
  tags?: string[]
  privacyStatus: StagingPrivacy
  /** Blob carries its own size and type (e.g. video/mp4). */
  video: Blob
}

export interface UploadReceipt {
  videoId: string
  channelId: string
  privacyStatus: StagingPrivacy
  uploadedAt: string
}

/** Resumable upload, non-public only. Caller must have run lockChannel first. */
export async function uploadStagingVideo(
  accessToken: string,
  channelId: string,
  input: UploadInput,
  fetchImpl: FetchLike = fetch,
): Promise<UploadReceipt> {
  if (input.privacyStatus !== 'private' && input.privacyStatus !== 'unlisted') {
    throw new Error('uploadStagingVideo only accepts private or unlisted')
  }
  const mime = input.video.type || 'video/mp4'
  const init = await fetchImpl(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(input.video.size),
    },
    body: JSON.stringify({
      snippet: { title: input.title, description: input.description, tags: input.tags ?? [] },
      status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: false },
    }),
  })
  await failOnError(init, 'videos.insert (init)')
  const location = init.headers.get('location')
  if (!location) throw new Error('YouTube videos.insert returned no resumable upload URL')

  const put = await fetchImpl(location, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: input.video,
  })
  await failOnError(put, 'videos.insert (upload)')
  const created = (await put.json()) as { id?: string }
  if (!created.id) throw new Error('YouTube videos.insert returned no video id')
  return {
    videoId: created.id,
    channelId,
    privacyStatus: input.privacyStatus,
    uploadedAt: new Date().toISOString(),
  }
}

export async function setThumbnail(
  accessToken: string,
  videoId: string,
  image: Blob,
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': image.type || 'image/png' },
    body: image,
  })
  await failOnError(res, 'thumbnails.set')
  return res.json()
}

export interface VideoReadback {
  videoId: string
  channelId: string | null
  title: string | null
  privacyStatus: string | null
  publishAt: string | null
  thumbnailUrl: string | null
}

export async function readBackVideo(
  accessToken: string,
  videoId: string,
  fetchImpl: FetchLike = fetch,
): Promise<VideoReadback | null> {
  const res = await fetchImpl(
    `${API}/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`,
    { headers: authHeaders(accessToken) },
  )
  await failOnError(res, 'videos.list')
  const data = (await res.json()) as {
    items?: Array<{
      id: string
      snippet?: {
        channelId?: string
        title?: string
        thumbnails?: Record<string, { url?: string }>
      }
      status?: { privacyStatus?: string; publishAt?: string }
    }>
  }
  const item = data.items?.[0]
  if (!item) return null
  const thumbs = item.snippet?.thumbnails ?? {}
  return {
    videoId: item.id,
    channelId: item.snippet?.channelId ?? null,
    title: item.snippet?.title ?? null,
    privacyStatus: item.status?.privacyStatus ?? null,
    publishAt: item.status?.publishAt ?? null,
    thumbnailUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.default)?.url ?? null,
  }
}
