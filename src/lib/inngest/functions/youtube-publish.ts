/**
 * YouTube publishing workflow (design: CLAUDE.md §3 Inngest rule).
 *
 *   youtube.staging.requested  -> private upload of an approved factory video + read-back receipt
 *   youtube.public.authorized  -> one-time grant consumed -> public step, DRY RUN ONLY
 *
 * retries: 0 on purpose — an upload retried blindly is a duplicate video on the client's channel.
 * Both events are cloud-owned (not in WORKER_OWNED_EVENTS).
 */
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { getValidToken } from '@/lib/platform-oauth/token-manager'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import {
  runPublicStep,
  runStaging,
  YOUTUBE_PUBLIC_AUTHORIZED_EVENT,
  YOUTUBE_STAGING_REQUESTED_EVENT,
  type PublicAuthorizedEventData,
  type StagingEventData,
} from '@/lib/youtube-publish/workflow'
import {
  consumeAuthorization,
  findStagedReceipt,
  getApprovedWorkOrder,
  hasStagingAttempt,
  getClientChannelId,
  insertReceipt,
} from '@/lib/youtube-publish/store'

const getToken = (clientId: string) => getValidToken(clientId, PLATFORM_PROVIDERS.GOOGLE_YOUTUBE)

const MAX_VIDEO_BYTES = 512 * 1024 * 1024

/** Only the factory's own storage host, no redirects, bounded size and time, video content only. */
export async function fetchFactoryVideo(url: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const allowedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://invalid.invalid').hostname
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.hostname !== allowedHost) throw new Error('video host not allowed')
  const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`video download failed (${res.status})`)
  if (!(res.headers.get('content-type') ?? '').startsWith('video/')) throw new Error('not a video')
  if (Number(res.headers.get('content-length') ?? '0') > MAX_VIDEO_BYTES) throw new Error('video too large')
  // Stream with a byte cap: content-length may be absent (chunked) or wrong.
  const reader = res.body?.getReader()
  if (!reader) throw new Error('empty video body')
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_VIDEO_BYTES) {
      await reader.cancel()
      throw new Error('video too large')
    }
    parts.push(value)
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('content-type') ?? 'video/mp4' })
}

export const youtubeStaging = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}youtube-staging`,
    name: 'YouTube — stage approved factory video (private)',
    retries: 0,
    concurrency: { limit: 1 },
  },
  { event: YOUTUBE_STAGING_REQUESTED_EVENT },
  async ({ event, step }) => {
    const data = event.data as StagingEventData
    return step.run('stage', () =>
      runStaging(data, {
        getChannelId: getClientChannelId,
        getWorkOrder: getApprovedWorkOrder,
        alreadyStaged: hasStagingAttempt,
        getToken,
        fetchVideo: fetchFactoryVideo,
        saveReceipt: insertReceipt,
      }),
    )
  },
)

export const youtubePublicStep = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}youtube-public-step`,
    name: 'YouTube — public step (dry run only)',
    retries: 0,
    concurrency: { limit: 1 },
  },
  { event: YOUTUBE_PUBLIC_AUTHORIZED_EVENT },
  async ({ event, step }) => {
    const data = event.data as PublicAuthorizedEventData
    return step.run('public-step', () =>
      runPublicStep(data, {
        consume: (nonce, clientId) => consumeAuthorization(nonce, clientId),
        getStaged: (c, v) => findStagedReceipt(c, { videoId: v }),
        getToken,
        saveReceipt: insertReceipt,
      }),
    )
  },
)
