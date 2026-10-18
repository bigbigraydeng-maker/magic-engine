/**
 * Gated "go Public" step for a staged YouTube video. Fail-closed: every check
 * below must pass before anything is written, and the default mode is a dry run
 * that never calls a write endpoint.
 *
 * Known gap: videos.update needs a broader OAuth scope than the upload+readonly
 * pair stored today, so `execute` mode will be refused by Google until the
 * connection is re-authorised with that scope (a separate, reviewed change).
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

export interface PublishReceipt {
  requestId: string
  videoId: string
  channelId: string
  status: 'blocked' | 'dry_run_ok' | 'published'
  /** True whenever nothing public was created by this call. */
  noPublish: boolean
  reason?: PublishBlockReason
  blockingGates?: Array<{ id: PublishGateId; reason: string }>
  authorizedBy?: string
  createdAt: string
}

export interface PublishInput {
  accessToken: string
  channelId: string
  videoId: string
  gates: GateResult[]
  authorization: PublishAuthorization | null
  /** Defaults to 'dry_run'. 'execute' is the only mode that writes. */
  mode?: 'dry_run' | 'execute'
}

function authorizationValid(a: PublishAuthorization | null, input: PublishInput, now: number): boolean {
  if (!a || a.videoId !== input.videoId || a.channelId !== input.channelId) return false
  const granted = Date.parse(a.grantedAt)
  return Number.isFinite(granted) && granted <= now && now - granted <= AUTHORIZATION_TTL_MS
}

function checkStaged(video: VideoReadback | null, channelId: string): PublishBlockReason | null {
  if (!video) return 'video_not_found'
  if (video.channelId !== channelId) return 'video_on_other_channel'
  if (video.privacyStatus === 'public') return 'already_public'
  if (!video.thumbnailUrl) return 'thumbnail_missing'
  return null
}

async function setPublic(accessToken: string, videoId: string, fetchImpl: typeof fetch): Promise<void> {
  // part=status replaces the whole status object; keep the values staging used.
  const res = await fetchImpl(`${API}/videos?part=status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: videoId,
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }),
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
    createdAt: new Date(now()).toISOString(),
  }
  const blocked = (
    reason: PublishBlockReason,
    extra?: Partial<PublishReceipt>,
  ): PublishReceipt => ({ ...base, status: 'blocked', noPublish: true, reason, ...extra })

  if (!authorizationValid(input.authorization, input, now())) return blocked('authorization_invalid')
  const verdict = evaluatePublishGates(input.gates)
  if (!verdict.canGoPublic) return blocked('gates_not_passed', { blockingGates: verdict.blocking })

  try {
    await lockChannel(input.accessToken, input.channelId, fetchImpl)
  } catch (err) {
    if (err instanceof ChannelLockError) return blocked('channel_mismatch')
    throw err
  }
  const staged = checkStaged(await readBackVideo(input.accessToken, input.videoId, fetchImpl), input.channelId)
  if (staged) return blocked(staged)

  const authorizedBy = input.authorization?.grantedBy
  if ((input.mode ?? 'dry_run') !== 'execute') {
    return { ...base, status: 'dry_run_ok', noPublish: true, authorizedBy }
  }
  await setPublic(input.accessToken, input.videoId, fetchImpl)
  const after = await readBackVideo(input.accessToken, input.videoId, fetchImpl)
  if (after?.privacyStatus !== 'public') {
    throw new Error('YouTube update returned ok but read-back is not public; check Studio')
  }
  return { ...base, status: 'published', noPublish: false, authorizedBy }
}
