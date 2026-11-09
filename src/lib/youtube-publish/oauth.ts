/**
 * YouTube publishing OAuth: shared constants and the channel-locked persist step.
 * The expected channel id is client configuration supplied by the caller.
 */

import { confirmSocialConnectionWrite, upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { ChannelLockError, YOUTUBE_PUBLISH_SCOPES, lockChannel } from './client'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Separate from the retired root-path cookie; browsers may still send both during migration.
export const YOUTUBE_STATE_COOKIE = 'youtube_oauth_state_v2'
export const YOUTUBE_STATE_TTL_SECS = 600
export const YOUTUBE_STATE_PATH = '/api/auth/google/youtube'

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

export interface YoutubeState {
  clientId: string
  userId: string
  targetChannelId: string | null
  nonce: string
}

export function buildYoutubeState(input: Omit<YoutubeState, 'nonce'>, secret: string): string {
  if (!UUID.test(input.clientId) || !UUID.test(input.userId) ||
    (input.targetChannelId !== null && !isValidChannelId(input.targetChannelId))) {
    throw new Error('Invalid YouTube connection context')
  }
  const payload = Buffer.from(JSON.stringify({ ...input, purpose: 'youtube_publishing_v1',
    nonce: randomBytes(24).toString('hex'), exp: Date.now() + YOUTUBE_STATE_TTL_SECS * 1000 })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

export function verifyYoutubeState(state: string, secret: string): YoutubeState | null {
  try {
    if (state.length > 2048) return null
    const parts = state.split('.')
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
    const expected = createHmac('sha256', secret).update(parts[0]).digest('base64url')
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1]))) return null
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (!data || data.purpose !== 'youtube_publishing_v1' || !UUID.test(data.clientId) ||
      !UUID.test(data.userId) || (data.targetChannelId !== null && !isValidChannelId(data.targetChannelId)) ||
      !/^[a-f\d]{48}$/.test(data.nonce) || !Number.isSafeInteger(data.exp) ||
      data.exp <= Date.now() || data.exp > Date.now() + YOUTUBE_STATE_TTL_SECS * 1000) return null
    return { clientId: data.clientId, userId: data.userId, targetChannelId: data.targetChannelId, nonce: data.nonce }
  } catch { return null }
}

export function isValidChannelId(value: string | null | undefined): value is string {
  return typeof value === 'string' && CHANNEL_ID_PATTERN.test(value)
}

export interface YoutubePersistInput {
  clientId: string
  expectedChannelId: string
  accessToken: string
  refreshToken: string
  tokenExpiry: Date
  scope: string
  /** Recheck actor, state and target after the provider call and immediately before the grant write. */
  beforeWrite?: () => Promise<boolean>
}

export type YoutubePersistResult =
  | { ok: true; channelTitle: string }
  | { ok: false; reason: 'channel_mismatch' | 'channel_lookup_failed' | 'scope_missing' | 'context_changed' | 'save_unverified' }

/** Stores the connection only if the authorised account manages the expected channel. */
export async function persistYoutubeConnection(
  input: YoutubePersistInput,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubePersistResult> {
  // Google lets the user untick individual permissions on the consent page.
  const granted = new Set(input.scope.split(/\s+/))
  if (!YOUTUBE_PUBLISH_SCOPES.every((s) => granted.has(s))) {
    return { ok: false, reason: 'scope_missing' }
  }
  let channel
  try {
    channel = await lockChannel(input.accessToken, input.expectedChannelId, fetchImpl)
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof ChannelLockError ? 'channel_mismatch' : 'channel_lookup_failed',
    }
  }
  if (input.beforeWrite && !(await input.beforeWrite())) return { ok: false, reason: 'context_changed' }
  if (!Number.isFinite(input.tokenExpiry.getTime()) || input.tokenExpiry.getTime() <= Date.now()) {
    return { ok: false, reason: 'context_changed' }
  }
  const verifiedAt = new Date()
  await upsertConnection({
    clientId: input.clientId,
    provider: PLATFORM_PROVIDERS.GOOGLE_YOUTUBE,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiry: input.tokenExpiry,
    accountId: channel.id,
    displayName: channel.title || channel.id,
    scopes: input.scope.split(/\s+/).filter(Boolean),
    lastSyncedAt: verifiedAt,
  })
  if (!(await confirmSocialConnectionWrite({ clientId: input.clientId,
    provider: PLATFORM_PROVIDERS.GOOGLE_YOUTUBE, accountId: channel.id,
    requiredScopes: YOUTUBE_PUBLISH_SCOPES, tokenExpiry: input.tokenExpiry, verifiedAt }))) {
    return { ok: false, reason: 'save_unverified' }
  }
  return { ok: true, channelTitle: channel.title }
}
