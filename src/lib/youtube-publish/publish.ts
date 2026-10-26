/**
 * Gated "go Public" step for a staged YouTube video. Fail-closed: every check
 * below must pass before anything is written, and the default mode is a dry run
 * that never calls a write endpoint.
 *
 * videos.update needs youtube.force-ssl (now requested by the OAuth flow). Connections
 * authorised before that scope was added lack it, so `execute` is refused by Google
 * until the channel account re-authorises.
 */

import { randomUUID } from 'node:crypto'
import { ChannelLockError, lockChannel, readBackVideo, type VideoReadback } from './client'
import { evaluatePublishGates, type GateResult, type PublishGateId } from './gates'

const API = 'https://www.googleapis.com/youtube/v3'
/** An authorization is for one video and goes stale quickly. */
const AUTHORIZATION_TTL_MS = 30 * 60 * 1000

export interface PublishAuthorization {
  videoId: string
  channelId: string
  grantedBy: string
  /** Unique per grant. The caller must record it as consumed; it is echoed in the receipt. */
  nonce: string
  /** ISO time the owner said yes in the current conversation for THIS video. */
  grantedAt: string
}

export type PublishBlockReason =
  | 'authorization_invalid'
  | 'gates_not_passed'
  | 'channel_mismatch'
  | 'video_not_found'
  | 'video_on_other_channel'
  | 'already_public'
  | 'thumbnail_missing'
  | 'status_unknown'
  | 'update_failed'

export interface PublishReceipt {
  requestId: string
  videoId: string
  channelId: string
  /** ME client the publish belongs to (for the receipt trail). */
  clientId: string
  status: 'blocked' | 'dry_run_ok' | 'published' | 'failed'
  /** True whenever nothing public was created by this call. */
  noPublish: boolean
  reason?: PublishBlockReason
  blockingGates?: Array<{ id: PublishGateId; reason: string }>
  authorizedBy?: string
  authorizationNonce?: string
  createdAt: string
}

export interface PublishInput {
  accessToken: string
  clientId: string
  channelId: string
  videoId: string
  gates: GateResult[]
  authorization: PublishAuthorization | null
  /** Defaults to 'dry_run'. 'execute' is the only mode that writes. */
  mode?: 'dry_run' | 'execute'
}

function authorizationValid(a: PublishAuthorization | null, input: PublishInput, now: number): boolean {
  if (!a || !a.nonce?.trim() || a.videoId !== input.videoId || a.channelId !== input.channelId) return false
  const granted = Date.parse(a.grantedAt)
  return Number.isFinite(granted) && granted <= now && now - granted <= AUTHORIZATION_TTL_MS
}

function checkStaged(video: VideoReadback | null, channelId: string): PublishBlockReason | null {
  if (!video) return 'video_not_found'
  if (video.channelId !== channelId) return 'video_on_other_channel'
  if (!video.privacyStatus) return 'status_unknown'
  if (video.privacyStatus === 'public') return 'already_public'
  if (!video.thumbnailUrl) return 'thumbnail_missing'
  return null
}

async function setPublic(
  accessToken: string,
  videoId: string,
  currentStatus: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<void> {
  // part=status replaces the whole status object, so send back what YouTube holds now
  // (license, embeddable, madeForKids, ...) and drop only the scheduling field.
  const { publishAt: _publishAt, ...kept } = currentStatus
  const res = await fetchImpl(`${API}/videos?part=status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: videoId, status: { ...kept, privacyStatus: 'public' } }),
  })
  if (!res.ok) throw new Error(`YouTube videos.update failed (${res.status}): ${await res.text()}`)
}

export async function publishStagedVideo(
  input: PublishInput,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<PublishReceipt> {
  const base = {
    requestId: randomUUID(),
    videoId: input.videoId,
    channelId: input.channelId,
    clientId: input.clientId,
    createdAt: new Date(now()).toISOString(),
  }
  const blocked = (
    reason: PublishBlockReason,
    extra?: Partial<PublishReceipt>,
  ): PublishReceipt => ({ ...base, status: 'blocked', noPublish: true, reason, ...extra })

  if (!authorizationValid(input.authorization, input, now())) return blocked('authorization_invalid')
  const verdict = evaluatePublishGates(input.gates, input.videoId)
  if (!verdict.canGoPublic) return blocked('gates_not_passed', { blockingGates: verdict.blocking })

  try {
    await lockChannel(input.accessToken, input.channelId, fetchImpl)
  } catch (err) {
    if (err instanceof ChannelLockError) return blocked('channel_mismatch')
    throw err
  }
  const current = await readBackVideo(input.accessToken, input.videoId, fetchImpl)
  const staged = checkStaged(current, input.channelId)
  if (staged || !current) return blocked(staged ?? 'video_not_found')

  const authorizedBy = input.authorization?.grantedBy
  const authorizationNonce = input.authorization?.nonce
  if ((input.mode ?? 'dry_run') !== 'execute') {
    return { ...base, status: 'dry_run_ok', noPublish: true, authorizedBy, authorizationNonce }
  }
  return executePublic(input, current.rawStatus, { ...base, authorizationNonce }, authorizedBy, fetchImpl)
}

/** Writes public and always returns a receipt, including when the outcome is uncertain. */
async function executePublic(
  input: PublishInput,
  currentStatus: Record<string, unknown>,
  base: Pick<PublishReceipt, 'requestId' | 'videoId' | 'channelId' | 'clientId' | 'createdAt' | 'authorizationNonce'>,
  authorizedBy: string | undefined,
  fetchImpl: typeof fetch,
): Promise<PublishReceipt> {
  try {
    await setPublic(input.accessToken, input.videoId, currentStatus, fetchImpl)
  } catch {
    return { ...base, status: 'failed', noPublish: true, reason: 'update_failed', authorizedBy }
  }
  try {
    const after = await readBackVideo(input.accessToken, input.videoId, fetchImpl)
    if (after?.privacyStatus === 'public') {
      return { ...base, status: 'published', noPublish: false, authorizedBy }
    }
  } catch {
    // fall through: the write was accepted but could not be confirmed
  }
  // Write accepted, state unconfirmed: report that it may be public so a human checks Studio.
  return { ...base, status: 'failed', noPublish: false, reason: 'status_unknown', authorizedBy }
}
