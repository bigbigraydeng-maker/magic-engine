/**
 * Instagram Stories — create a media container, poll its status, and publish it.
 *
 * Pure and injectable: every function takes an optional `fetcher` and never
 * touches the network unless the caller supplies one (defaults to global fetch).
 * Error classification mirrors `publishPagePhotoPost` in ./page-posts so callers
 * can reason about retry safety the same way across posts and stories.
 *
 * The three functions are independent and never poll internally; the caller's
 * relay function owns polling (see design §4.2).
 *
 * timeoutMs applies per request.
 *
 * TODO(verify-with-real-call): Story support under Facebook Login is unverified.
 */

import { GRAPH_BASE } from './graph-base'
import { PagePublishError } from './page-posts'
import { assertGraphId, assertHttpsUrl, getGraphJson, postGraphJson } from './story-graph'

/**
 * Create an Instagram Story media container. The container is not published
 * yet; the caller stores `containerId` and later calls `publishIgContainer`.
 */
export async function createIgStoryContainer(input: {
  igUserId: string
  accessToken: string
  media: { kind: 'image'; imageUrl: string } | { kind: 'video'; videoUrl: string }
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<{ containerId: string; raw: Record<string, unknown> }> {
  assertGraphId(input.igUserId, 'createIgStoryContainer igUserId')

  let mediaBody: Record<string, string>
  if (input.media.kind === 'image') {
    assertHttpsUrl(input.media.imageUrl, 'createIgStoryContainer imageUrl')
    mediaBody = { media_type: 'STORIES', image_url: input.media.imageUrl }
  } else {
    assertHttpsUrl(input.media.videoUrl, 'createIgStoryContainer videoUrl')
    mediaBody = { media_type: 'STORIES', video_url: input.media.videoUrl }
  }

  const body = await postGraphJson({
    url: `${GRAPH_BASE}/${input.igUserId}/media`,
    body: { ...mediaBody, access_token: input.accessToken },
    label: `createIgStoryContainer ${input.igUserId}`,
    secrets: [input.accessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const containerId = body.id
  if (!containerId) {
    throw new PagePublishError(`createIgStoryContainer ${input.igUserId}: provider returned no container id`, {
      certainty: 'unknown',
    })
  }
  return { containerId, raw: body as Record<string, unknown> }
}

/**
 * Read a container's processing status. In-progress statuses (e.g. IN_PROGRESS)
 * are returned as-is and never throw; only transport or Graph errors throw,
 * classified the same way as publishing.
 */
export async function getIgContainerStatus(input: {
  containerId: string
  accessToken: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<{ statusCode: string | null; raw: Record<string, unknown> }> {
  assertGraphId(input.containerId, 'getIgContainerStatus containerId')

  const params = new URLSearchParams({ fields: 'status_code', access_token: input.accessToken })
  const body = await getGraphJson({
    url: `${GRAPH_BASE}/${input.containerId}?${params.toString()}`,
    label: `getIgContainerStatus ${input.containerId}`,
    secrets: [input.accessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })

  return { statusCode: body.status_code ?? null, raw: body as Record<string, unknown> }
}

/**
 * Publish a previously created container, returning the published media id.
 */
export async function publishIgContainer(input: {
  igUserId: string
  accessToken: string
  containerId: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<{ mediaId: string; raw: Record<string, unknown> }> {
  assertGraphId(input.igUserId, 'publishIgContainer igUserId')
  assertGraphId(input.containerId, 'publishIgContainer containerId')

  const body = await postGraphJson({
    url: `${GRAPH_BASE}/${input.igUserId}/media_publish`,
    body: { creation_id: input.containerId, access_token: input.accessToken },
    label: `publishIgContainer ${input.igUserId}`,
    secrets: [input.accessToken],
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
  const mediaId = body.id
  if (!mediaId) {
    throw new PagePublishError(`publishIgContainer ${input.igUserId}: provider returned no media id`, {
      certainty: 'unknown',
    })
  }
  return { mediaId, raw: body as Record<string, unknown> }
}
