/**
 * Listen for story.item.attempted and register a live send.
 *
 * The first lines are pure: the switch and the live-send filter both return
 * before any step.run and before any database call. A rehearsal, a block, or
 * a retry does not touch the database.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { readRegisteredPageId } from './daily-plan-post-measurement'
import { LITE_EVENTS } from '@/lib/social/story-lite/types'
import { supabaseAdmin } from '@/lib/supabase'
import {
  isLiveSentStoryAttempt,
  loadStoryItemForRegistration,
  parseLiveSentStoryAttempt,
  recordStoryPublishAction,
  storyActionInputFromRow,
  storyPublishRegisterEnabled,
  storyRegistrationRefusal,
  writeStoryRegisterRefusal,
  type LiveSentStoryAttempt,
} from '@/lib/social/story-publish-action'

export const STORY_PUBLISH_ACTION_RECORDER_ID = `${CLOUD_FN_PREFIX}story-publish-action-recorder`

export function createStoryPublishActionRecorder(deps: {
  supabase: SupabaseClient
  enabled?: () => boolean
}) {
  return inngest.createFunction(
    {
      id: STORY_PUBLISH_ACTION_RECORDER_ID,
      name: 'Story: register publish action',
      retries: 2,
      concurrency: { limit: 4, key: 'event.data.client_id' },
    },
    { event: LITE_EVENTS.itemAttempted },
    async ({ event, step }) => {
      const data: unknown = event.data
      if (!(deps.enabled ?? storyPublishRegisterEnabled)()) return { skipped: 'register_disabled' }
      if (!isLiveSentStoryAttempt(data)) return { skipped: 'not_live_sent' }
      const attempt = parseLiveSentStoryAttempt(data)
      if (!attempt) return { skipped: 'invalid_event' }
      const item = await step.run('load-story-item', () => loadStoryItemForRegistration(deps.supabase, attempt.itemId))
      const pageId = await step.run('isolation-check', () => readRegisteredPageId(deps.supabase, attempt.clientId))
      const ready = readyStoryInput(attempt, item, pageId)
      if (!ready.ok) {
        const reason = ready.reason
        return step.run('record-readback-refusal', () => recordRefusal(deps.supabase, attempt, reason))
      }
      const registration = await step.run('register-publish-action', () => recordStoryPublishAction(deps.supabase, ready.input))
      if (registration.ok) return { ok: true as const, actionId: registration.actionId, created: registration.created }
      const field = `${registration.reason}:${registration.field}`
      return step.run('record-register-refusal', () => recordRefusal(deps.supabase, attempt, field))
    },
  )
}

export const storyPublishActionRecorder = createStoryPublishActionRecorder({
  supabase: supabaseAdmin,
  enabled: () => storyPublishRegisterEnabled(),
})

function readyStoryInput(
  attempt: LiveSentStoryAttempt,
  item: Awaited<ReturnType<typeof loadStoryItemForRegistration>>,
  pageId: string | null,
) {
  const refusal = storyRegistrationRefusal(attempt, item, pageId)
  if (refusal || !item) return { ok: false as const, reason: refusal ?? 'item_not_found' }
  const input = storyActionInputFromRow(item)
  if (!input) return { ok: false as const, reason: 'sent_at_missing' }
  return { ok: true as const, input }
}

async function recordRefusal(supabase: SupabaseClient, attempt: LiveSentStoryAttempt, reason: string) {
  await writeStoryRegisterRefusal(supabase, { clientId: attempt.clientId, itemId: attempt.itemId, reason })
  return { ok: false as const, reason }
}
