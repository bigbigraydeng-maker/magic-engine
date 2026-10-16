/**
 * Story "lite" — real dependencies for the services and the sweep.
 *
 * The one place that wires the pure logic to the database, the event bus, the administrator list and
 * Facebook. Built inside request / function handlers (never at module load). Nothing here decides
 * anything: every rule lives in service.ts and sender.ts.
 */
import { randomUUID } from 'node:crypto'

import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { publishPagePhotoStory, publishPageVideoStory } from '@/lib/meta/page-stories'
import { checkMediaFile } from '@/lib/social/story-publish/file-check'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

import { DEFAULT_SWEEP_CONFIG, readLiteSwitches, type SenderDeps } from './sender'
import type { LiteServicePorts } from './service'
import { SupabaseLiteStore } from './supabase-store'
import { checkVideoFile } from './video-check'
import type { LiteFileCheck, LiteItem } from './types'

/** The only host story media may be downloaded from: our own public storage (empty list = deny everything). */
function mediaHosts(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return []
  try {
    return [new URL(raw).hostname]
  } catch {
    return []
  }
}

function checkFile(item: LiteItem): Promise<LiteFileCheck> {
  const allowedHosts = mediaHosts()
  return item.media_kind === 'video' ? checkVideoFile(item, { allowedHosts }) : checkMediaFile(item, { allowedHosts })
}

/** Dependencies of the authorise / revoke / preview services. */
export function createLiteServicePorts(): LiteServicePorts {
  return {
    store: new SupabaseLiteStore(supabaseAdmin),
    adminEmails: { has: (email: string) => isGlobalAdminEmail(email) },
    checkFile,
    sendEvent: async (event) => {
      await sendInngestEvent(event)
    },
  }
}

/**
 * The Page token for (client, page): the stored connection first, then the hand-configured user token
 * exchanged for a Page token — the same order the daily-plan publisher uses.
 */
async function getPageToken(clientId: string, pageId: string): Promise<string | null> {
  const stored = await getStoredPageToken(clientId, pageId)
  if (stored) return stored
  const userToken = await getMetaTokenForClient(clientId)
  return userToken ? getPageAccessToken(userToken, pageId) : null
}

/** Dependencies of one sweep (every ten minutes). Rehearsal unless both live switches are set. */
export function buildSenderDeps(now: Date, env: NodeJS.ProcessEnv = process.env): SenderDeps {
  return {
    now,
    store: new SupabaseLiteStore(supabaseAdmin),
    switches: readLiteSwitches({
      STORY_AUTO_PUBLISH_LIVE: env.STORY_AUTO_PUBLISH_LIVE,
      STORY_AUTO_PUBLISH_CLIENTS: env.STORY_AUTO_PUBLISH_CLIENTS,
    }),
    config: DEFAULT_SWEEP_CONFIG,
    checkFile,
    getPageToken,
    publish: async ({ item, pageToken }) => {
      const base = { pageId: item.account_id, pageAccessToken: pageToken, timeoutMs: 45_000 }
      const result =
        item.media_kind === 'video'
          ? await publishPageVideoStory({ ...base, videoUrl: item.media_url })
          : await publishPagePhotoStory({ ...base, imageUrl: item.media_url })
      return { postId: result.postId }
    },
    emit: async (event) => {
      await sendInngestEvent(event)
    },
  }
}

/** A fresh id for packs created by an ingest script. */
export function newPackId(): string {
  return randomUUID()
}
