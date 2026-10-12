/**
 * Story auto-publish — real service dependencies (slice 2b).
 *
 * The one place that wires the services to the database, the event bus and the
 * administrator list. Kept separate from the services so every rule stays
 * testable offline. Nothing here publishes anything.
 */
import { randomUUID } from 'node:crypto'

import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

import { checkMediaFile } from './file-check'
import type { StoryServicePorts } from './service-ports'
import { SupabaseStoryStore } from './supabase-store'

/**
 * Gate timing defaults (design §4.2 / §4.4): a slot is sent at most 20 minutes late and
 * not earlier than 5 minutes before; stale claims turn into "unknown outcome" after 10 minutes.
 */
export const DEFAULT_STORY_GATE_CONFIG: StoryServicePorts['config'] = {
  maxLateMinutes: 20,
  earlyMinutes: 5,
  staleClaimMinutes: 10,
  stalePublishingMinutes: 10,
  maxWebsiteAgeDays: 7,
  maxRetries: 3,
}

/** The only host story media may be downloaded from: our own public storage (empty = deny everything). */
function mediaHosts(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return []
  try {
    return [new URL(raw).hostname]
  } catch {
    return []
  }
}

/** Build the real ports. Called inside request handlers (never at module load). */
export function createStoryServicePorts(): StoryServicePorts {
  return {
    store: new SupabaseStoryStore(supabaseAdmin),
    adminEmails: { has: (email: string) => isGlobalAdminEmail(email) },
    checkFile: (item) => checkMediaFile(item, { allowedHosts: mediaHosts() }),
    // The live price check against the official website is not built yet. Failing closed means
    // an item that shows a price cannot be authorised until it exists (items without a price are unaffected).
    checkPrice: async () => 'ERROR',
    sendEvent: async (event) => {
      await sendInngestEvent(event)
    },
    newId: () => randomUUID(),
    config: DEFAULT_STORY_GATE_CONFIG,
  }
}
