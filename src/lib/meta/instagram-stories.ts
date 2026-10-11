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
 * TODO(verify-with-real-call): Story support under Facebook Login is unverified.
 */

import { GRAPH_BASE } from './graph-base'
import { PagePublishError, classifyPublishFailure } from './page-posts'

interface GraphErrorBody {
  message?: string
  code?: number
  error_subcode?: number
}

interface GraphResponseBody {
  id?: string
  status_code?: string
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
    // No response at all: the request may or may not have reached Instagram.
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
  const mediaBody =
    input.media.kind === 'image'
      ? { media_type: 'STORIES', image_url: input.media.imageUrl }
      : { media_type: 'STORIES', video_url: input.media.videoUrl }

  const body = await postGraphJson({
    url: `${GRAPH_BASE}/${input.igUserId}/media`,
    body: { ...mediaBody, access_token: input.accessToken },
    label: `createIgStoryContainer ${input.igUserId}`,
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
  const doFetch = input.fetcher ?? fetch
  const params = new URLSearchParams({ fields: 'status_code', access_token: input.accessToken })
  const url = `${GRAPH_BASE}/${input.containerId}?${params.toString()}`

  let res: Response
  try {
    res = await doFetch(url, {
      ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new PagePublishError(reason, { certainty: 'unknown' })
  }

  const body = (await res.json().catch(() => null)) as GraphResponseBody | null
  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`
    throw new PagePublishError(`getIgContainerStatus ${input.containerId}: ${detail}`, {
      certainty: res.ok ? 'unknown' : classifyPublishFailure(res.status, body?.error),
      httpStatus: res.status,
      graphCode: body?.error?.code ?? null,
      graphSubcode: body?.error?.error_subcode ?? null,
    })
  }

  return { statusCode: body?.status_code ?? null, raw: (body ?? {}) as Record<string, unknown> }
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
  const body = await postGraphJson({
    url: `${GRAPH_BASE}/${input.igUserId}/media_publish`,
    body: { creation_id: input.containerId, access_token: input.accessToken },
    label: `publishIgContainer ${input.igUserId}`,
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
