/**
 * YouTube publishing OAuth: shared constants and the channel-locked persist step.
 * The expected channel id is client configuration supplied by the caller.
 */

import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { ChannelLockError, YOUTUBE_PUBLISH_SCOPES, lockChannel } from './client'

export const YOUTUBE_STATE_COOKIE = 'youtube_oauth_state'
export const YOUTUBE_STATE_TTL_SECS = 600

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/

export function isValidChannelId(value: string | null | undefined): value is string {
  return typeof value === 'string' && CHANNEL_ID_PATTERN.test(value)
}

export interface YoutubePersistInput {
  clientId: string
  expectedChannelId: string
  accessToken: string
  refreshToken: string
  expiresInSec: number
  scope: string
}

export type YoutubePersistResult =
  | { ok: true; channelTitle: string }
  | { ok: false; reason: 'channel_mismatch' | 'channel_lookup_failed' | 'scope_missing' }

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
  await upsertConnection({
    clientId: input.clientId,
    provider: PLATFORM_PROVIDERS.GOOGLE_YOUTUBE,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiry: new Date(Date.now() + input.expiresInSec * 1000),
    accountId: channel.id,
    displayName: channel.title || channel.id,
    scopes: input.scope.split(/\s+/).filter(Boolean),
    lastSyncedAt: new Date(),
  })
  return { ok: true, channelTitle: channel.title }
}
