/**
 * Backfill Story publish-action rows. Default off.
 *
 * The publish sweep must not call this. It runs only when an event arrives
 * AND SOCIAL_STORY_PUBLISH_RECONCILE_ENABLED is exactly "true". While the
 * switch is off the handler returns before any step and before any query,
 * so a stray event does not write. This function never calls a Meta write.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { readRegisteredPageId } from './daily-plan-post-measurement'
import { supabaseAdmin } from '@/lib/supabase'
import { listUnregisteredSentStories } from '@/lib/social/story-publish-reconcile'
import {
  STORY_PUBLISH_RECONCILE_EVENT,
  recordStoryPublishAction,
  storyActionInputFromRow,
  storyPublishReconcileEnabled,
  writeStoryRegisterRefusal,
  type StoryItemRegistrationRow,
} from '@/lib/social/story-publish-action'

export const STORY_PUBLISH_ACTION_RECONCILE_ID = `${CLOUD_FN_PREFIX}social-story-action-reconcile`

export function createStoryPublishActionReconcile(deps: {
  supabase: SupabaseClient
  enabled?: () => boolean
  now?: () => Date
}) {
  return inngest.createFunction(
    {
      id: STORY_PUBLISH_ACTION_RECONCILE_ID,
      name: 'Story: reconcile missing publish actions',
      retries: 2,
      concurrency: { limit: 1 },
    },
    { event: STORY_PUBLISH_RECONCILE_EVENT },
    async ({ step }) => {
      if (!(deps.enabled ?? storyPublishReconcileEnabled)()) return { skipped: 'reconcile_disabled' }
      const now = deps.now?.() ?? new Date()
      const rows = await step.run('list-unregistered', () => listUnregisteredSentStories(deps.supabase, now))
      let registered = 0
      let refused = 0
      for (const row of rows) {
        const outcome = await step.run(`register-${row.item_id}`, () => settleUnregisteredStory(deps.supabase, row))
        if (outcome === 'registered') registered += 1
        else refused += 1
      }
      return { ok: true as const, considered: rows.length, registered, refused }
    },
  )
}

export const storyPublishActionReconcile = createStoryPublishActionReconcile({
  supabase: supabaseAdmin,
  enabled: () => storyPublishReconcileEnabled(),
})

async function settleUnregisteredStory(
  supabase: SupabaseClient,
  row: StoryItemRegistrationRow,
): Promise<'registered' | 'refused'> {
  const input = storyActionInputFromRow(row)
  const pageId = await readRegisteredPageId(supabase, row.client_id)
  if (!input || pageId !== row.account_id) {
    await writeStoryRegisterRefusal(supabase, {
      clientId: row.client_id,
      itemId: row.item_id,
      reason: pageId === row.account_id ? 'sent_at_missing' : 'page_mismatch',
    })
    return 'refused'
  }
  const registration = await recordStoryPublishAction(supabase, input)
  if (registration.ok) return 'registered'
  await writeStoryRegisterRefusal(supabase, {
    clientId: row.client_id,
    itemId: row.item_id,
    reason: `${registration.reason}:${registration.field}`,
  })
  return 'refused'
}
