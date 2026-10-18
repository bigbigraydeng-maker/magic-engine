/**
 * Orchestration for the two YouTube workflow stages. Pure of I/O: every
 * dependency is injected so the stages are testable and the Inngest functions
 * stay thin. Both stages are fail-closed and always leave a receipt.
 *
 * Stage 1 (staging): approved factory work order -> private upload -> read-back.
 * Stage 2 (public step): one-time grant consumed -> publishStagedVideo, which is
 * hard-wired to dry_run here. There is intentionally no path from an event to
 * `execute`; enabling it needs a separate, reviewed change (see scope gap).
 */

import { randomUUID } from 'node:crypto'
import {
  ChannelLockError,
  lockChannel,
  readBackVideo,
  uploadStagingVideo,
} from './client'
import { publishStagedVideo, type PublishReceipt } from './publish'
import type { ApprovedWorkOrder, ReceiptRow } from './store'
import type { GateResult } from './gates'

export const YOUTUBE_STAGING_REQUESTED_EVENT = 'youtube.staging.requested' as const
export const YOUTUBE_PUBLIC_AUTHORIZED_EVENT = 'youtube.public.authorized' as const

export interface StagingEventData {
  requestId: string
  clientId: string
  workOrderId: string
}

export interface PublicAuthorizedEventData {
  clientId: string
  nonce: string
}

export interface StagingDeps {
  getChannelId: (clientId: string) => Promise<string | null>
  getWorkOrder: (clientId: string, id: string) => Promise<ApprovedWorkOrder | null>
  alreadyStaged: (clientId: string, workOrderId: string) => Promise<boolean>
  getToken: (clientId: string) => Promise<string>
  fetchVideo: (url: string) => Promise<Blob>
  saveReceipt: (r: ReceiptRow) => Promise<void>
  fetchImpl?: typeof fetch
}

export async function runStaging(ev: StagingEventData, deps: StagingDeps): Promise<ReceiptRow> {
  let pendingWritten = false
  let finalRequestId: string = ev.requestId
  const base = { requestId: ev.requestId, clientId: ev.clientId, workOrderId: ev.workOrderId, stage: 'staging' as const }
  const finish = async (r: Omit<ReceiptRow, keyof typeof base | 'channelId'> & { channelId?: string }) => {
    const row: ReceiptRow = { ...base, channelId: r.channelId ?? 'unknown', ...r }
    if (pendingWritten) row.requestId = finalRequestId
    await deps.saveReceipt(row)
    return row
  }

  const channelId = await deps.getChannelId(ev.clientId)
  if (!channelId) return finish({ status: 'blocked', reason: 'channel_not_configured', noPublish: true })
  const wo = await deps.getWorkOrder(ev.clientId, ev.workOrderId)
  if (!wo) return finish({ channelId, status: 'blocked', reason: 'work_order_not_approved', noPublish: true })
  if (await deps.alreadyStaged(ev.clientId, ev.workOrderId)) {
    return finish({ channelId, status: 'blocked', reason: 'already_staged', noPublish: true })
  }

  try {
    const token = await deps.getToken(ev.clientId)
    await lockChannel(token, channelId, deps.fetchImpl)
    const video = await deps.fetchVideo(wo.videoUrl)
    // Written immediately BEFORE the upload (not before the token/download steps, which cannot
    // leave anything on the channel): if the process dies mid-upload this row blocks a blind
    // re-upload; a failure before this point leaves no row, so a retry stays possible.
    await deps.saveReceipt({ ...base, channelId, status: 'pending', noPublish: true })
    finalRequestId = randomUUID()
    pendingWritten = true
    const uploaded = await uploadStagingVideo(
      token,
      channelId,
      { title: wo.title, description: wo.description, privacyStatus: 'private', video },
      deps.fetchImpl,
    )
    const back = await readBackVideo(token, uploaded.videoId, deps.fetchImpl)
    const ok = back?.channelId === channelId && back.privacyStatus === 'private'
    return finish({
      channelId,
      videoId: uploaded.videoId,
      status: ok ? 'staged' : 'failed',
      reason: ok ? undefined : 'readback_mismatch',
      noPublish: true,
      detail: { privacyStatus: back?.privacyStatus ?? null, thumbnailUrl: back?.thumbnailUrl ?? null, gates: [] },
    })
  } catch (err) {
    const reason = err instanceof ChannelLockError ? 'channel_mismatch' : 'staging_error'
    return finish({
      channelId,
      status: reason === 'channel_mismatch' ? 'blocked' : 'failed',
      reason,
      noPublish: true,
      detail: { error: err instanceof Error ? err.message.slice(0, 300) : 'unknown' },
    })
  }
}

export interface PublicStepDeps {
  consume: (nonce: string, clientId: string) => Promise<{
    clientId: string
    channelId: string
    videoId: string
    grantedBy: string
    grantedAt: string
  } | null>
  getStaged: (clientId: string, videoId: string) => Promise<{ gates: GateResult[]; channelId: string } | null>
  getChannelId: (clientId: string) => Promise<string | null>
  getToken: (clientId: string) => Promise<string>
  saveReceipt: (r: ReceiptRow) => Promise<void>
  fetchImpl?: typeof fetch
}

export async function runPublicStep(ev: PublicAuthorizedEventData, deps: PublicStepDeps): Promise<ReceiptRow> {
  const requestId = randomUUID()
  const grant = await deps.consume(ev.nonce, ev.clientId)
  const save = async (r: Partial<ReceiptRow> & Pick<ReceiptRow, 'status' | 'channelId'>): Promise<ReceiptRow> => {
    const row: ReceiptRow = {
      requestId,
      clientId: ev.clientId,
      stage: 'public_step',
      noPublish: true,
      authorizationNonce: ev.nonce,
      ...r,
    }
    await deps.saveReceipt(row)
    return row
  }
  if (!grant || grant.clientId !== ev.clientId) {
    return save({ status: 'blocked', reason: 'authorization_invalid', channelId: grant?.channelId ?? 'unknown' })
  }
  const staged = await deps.getStaged(grant.clientId, grant.videoId)
  if (!staged || staged.channelId !== grant.channelId) {
    return save({ status: 'blocked', reason: 'video_not_staged', channelId: grant.channelId, videoId: grant.videoId })
  }
  // A grant issued before the client's channel was reconfigured must not apply to the new setup.
  if ((await deps.getChannelId(grant.clientId)) !== grant.channelId) {
    return save({ status: 'blocked', reason: 'channel_config_changed', channelId: grant.channelId, videoId: grant.videoId })
  }
  let receipt: PublishReceipt
  try {
    const token = await deps.getToken(grant.clientId)
    receipt = await publishStagedVideo(
      {
        accessToken: token,
        clientId: grant.clientId,
        channelId: grant.channelId,
        videoId: grant.videoId,
        gates: staged.gates,
        authorization: {
          videoId: grant.videoId,
          channelId: grant.channelId,
          grantedBy: grant.grantedBy,
          nonce: ev.nonce,
          grantedAt: grant.grantedAt,
        },
        mode: 'dry_run', // never 'execute' from an event; see file header
      },
      deps.fetchImpl,
    )
  } catch (err) {
    return save({
      status: 'failed',
      reason: 'public_step_error',
      channelId: grant.channelId,
      videoId: grant.videoId,
      authorizedBy: grant.grantedBy,
      detail: { error: err instanceof Error ? err.message.slice(0, 300) : 'unknown' },
    })
  }
  return save({
    status: receipt.status,
    reason: receipt.reason,
    channelId: grant.channelId,
    videoId: grant.videoId,
    noPublish: true,
    authorizedBy: grant.grantedBy,
    detail: { publishRequestId: receipt.requestId, blockingGates: receipt.blockingGates ?? [] },
  })
}
