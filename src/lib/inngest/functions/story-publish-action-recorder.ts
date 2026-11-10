/**
 * Listen for story.item.attempted and register a live send.
 *
 * A rehearsal, a block, or a retry returns before any step and any database call.
 * A live send whose register switch is off still writes a dry-run receipt
 * (post id and time) and does not insert a published action.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { readRegisteredPageId } from './daily-plan-post-measurement'
import { LITE_EVENTS } from '@/lib/social/story-lite/types'
import { supabaseAdmin } from '@/lib/supabase'
import { readPublishLive } from '@/lib/social/publish-gate/read-live'
import {
  writePublishDispatchReceipt,
  type PublishDispatchReceipt,
} from '@/lib/social/publish-gate/receipt'
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
  type StoryPublishActionInput,
} from '@/lib/social/story-publish-action'

export const STORY_PUBLISH_ACTION_RECORDER_ID = `${CLOUD_FN_PREFIX}story-publish-action-recorder`

export function createStoryPublishActionRecorder(deps: {
  supabase: SupabaseClient
  enabled?: () => boolean
  /** Omitted means off. Both this and the master env must be on to write the action. */
  clientLive?: (clientId: string) => Promise<boolean>
  recordDryRun?: (receipt: PublishDispatchReceipt) => Promise<void>
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
      if (!isLiveSentStoryAttempt(data)) return { skipped: 'not_live_sent' }
      const attempt = parseLiveSentStoryAttempt(data)
      if (!attempt) return { skipped: 'invalid_event' }
      const master = (deps.enabled ?? storyPublishRegisterEnabled)()
      const clientOn = master
        ? await step.run('client-switch', () => (deps.clientLive ?? (async () => false))(attempt.clientId))
        : false
      const item = await step.run('load-story-item', () => loadStoryItemForRegistration(deps.supabase, attempt.itemId))
      const pageId = await step.run('isolation-check', () => readRegisteredPageId(deps.supabase, attempt.clientId))
      const ready = readyStoryInput(attempt, item, pageId)
      const live = master && clientOn
      if (!ready.ok) return refuse(deps, step, attempt, ready.reason, live)
      if (!live) {
        const reason = master ? 'client_switch_off' : 'master_switch_off'
        return step.run('record-dry-run', () => recordDry(deps, attempt, 'dry_run', ready.input, reason))
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
  clientLive: (clientId) => readPublishLive(supabaseAdmin, clientId, 'story_register'),
  recordDryRun: (receipt) => writePublishDispatchReceipt(supabaseAdmin, receipt),
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

type RecorderDeps = Parameters<typeof createStoryPublishActionRecorder>[0]
type StepLike = { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> }

function refuse(
  deps: RecorderDeps,
  step: StepLike,
  attempt: LiveSentStoryAttempt,
  reason: string,
  live: boolean,
) {
  if (!live) return step.run('record-dry-run-refusal', () => recordDry(deps, attempt, 'failed', null, reason))
  return step.run('record-readback-refusal', () => recordRefusal(deps.supabase, attempt, reason))
}

async function recordDry(
  deps: RecorderDeps,
  attempt: LiveSentStoryAttempt,
  mode: 'dry_run' | 'failed',
  input: StoryPublishActionInput | null,
  reason: string,
) {
  if (!deps.recordDryRun) throw new Error('story register: receipt writer missing')
  await deps.recordDryRun({
    clientId: attempt.clientId,
    kind: 'story_register',
    subjectRef: attempt.itemId,
    mode,
    postId: input?.providerReceipt ?? attempt.providerReceipt,
    publishedAt: input?.publishedAt ?? null,
    calledPublishApi: false,
    reason,
  })
  if (mode === 'failed') return { ok: false as const, reason, recorded: true as const }
  return { ok: true as const, mode: 'dry_run' as const, recorded: true as const }
}
