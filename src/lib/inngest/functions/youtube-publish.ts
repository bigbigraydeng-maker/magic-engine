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
  getClientChannelId,
  insertReceipt,
} from '@/lib/youtube-publish/store'

const getToken = (clientId: string) => getValidToken(clientId, PLATFORM_PROVIDERS.GOOGLE_YOUTUBE)

async function fetchVideo(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`video download failed (${res.status})`)
  return res.blob()
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
        alreadyStaged: async (c, w) => (await findStagedReceipt(c, { workOrderId: w })) !== null,
        getToken,
        fetchVideo,
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
        consume: consumeAuthorization,
        getStaged: (c, v) => findStagedReceipt(c, { videoId: v }),
        getToken,
        saveReceipt: insertReceipt,
      }),
    )
  },
)
