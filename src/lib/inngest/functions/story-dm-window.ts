/**
 * After a Story is registered, wait until the invite-DM window has closed
 * and one messenger sync has had time to land, then write story_dm_count.
 *
 * Off unless SOCIAL_VERIFICATION_VERDICTS_ENABLED is exactly "true".
 * The first lines return before any step and before any query.
 * This function does not call Meta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { supabaseAdmin } from '@/lib/supabase'
import { socialVerificationVerdictsEnabled } from '@/lib/social/verification-verdicts'
import { writeReadbackOutcome } from '@/lib/social/readback-outcome-record'
import {
  STORY_DM_WINDOW_EVENT,
  loadStoryDmContext,
  parseStoryDmEvent,
  readStoryDmCount,
  storyDmWindowEventId,
  writeStoryDmBlock,
  writeStoryDmVerdict,
  type StoryDmEventData,
  type StoryDmLoad,
} from '@/lib/social/verify/story-dm-read'
import type { StoryDmCount } from '@/lib/social/verify/story-dm-window'

export type { StoryDmEventData }

export const STORY_DM_WINDOW_ID = `${CLOUD_FN_PREFIX}story-dm-window`

export function storyDmWindowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return socialVerificationVerdictsEnabled(env)
}

export async function scheduleStoryDmWindow(input: StoryDmEventData): Promise<void> {
  const data: Record<string, unknown> = {
    client_id: input.client_id,
    action_id: input.action_id,
    item_id: input.item_id,
    sent_at: input.sent_at,
    channel: input.channel,
  }
  await sendInngestEvent({ id: storyDmWindowEventId(input.action_id), name: STORY_DM_WINDOW_EVENT, data })
}

interface DmStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleepUntil(id: string, at: Date): Promise<void>
}

export function createStoryDmWindow(deps: {
  supabase: SupabaseClient
  enabled?: () => boolean
}) {
  return inngest.createFunction(
    {
      id: STORY_DM_WINDOW_ID,
      name: 'Story: count invite direct messages',
      retries: 3,
      concurrency: { limit: 4, key: 'event.data.client_id' },
      onFailure: async ({ event }) => {
        await writeStoryDmRetryFailure(deps.supabase, event)
      },
    },
    { event: STORY_DM_WINDOW_EVENT },
    async ({ event, step }) => runStoryDmWindow({
      supabase: deps.supabase,
      enabled: deps.enabled,
      event: { id: event.id, data: event.data },
      step: {
        // Inngest memoizes step results as Jsonify<T>. These steps return plain JSON.
        run: (id, fn) => step.run(id, fn) as Promise<Awaited<ReturnType<typeof fn>>>,
        sleepUntil: async (id, at) => { await step.sleepUntil(id, at) },
      },
    }),
  )
}

export const storyDmWindow = createStoryDmWindow({ supabase: supabaseAdmin })

export async function runStoryDmWindow(args: {
  supabase: SupabaseClient
  enabled?: () => boolean
  event: { id?: string; data: unknown }
  step: DmStep
}): Promise<unknown> {
  if (!(args.enabled ?? storyDmWindowEnabled)()) return { skipped: 'dm_window_disabled' }
  const parsed = parseStoryDmEvent(args.event.data)
  if (!parsed) return { skipped: 'invalid_event' }
  const loaded = await args.step.run('load-story-dm-context', () => loadStoryDmContext(args.supabase, parsed))
  if (!loaded.ok) return finishBlocked(args.supabase, args.step, loaded)
  if (loaded.immediateUnread) {
    return writeCount(args, loaded, { verdict: 'not_readable', observedValue: null, reason: loaded.immediateUnread })
  }
  await args.step.sleepUntil('wait-dm-sync', new Date(loaded.readAt))
  const count = await args.step.run('count-story-dms', () => readStoryDmCount(args.supabase, loaded))
  return writeCount(args, loaded, count)
}

async function writeCount(
  args: { supabase: SupabaseClient; event: { id?: string }; step: DmStep },
  loaded: Extract<StoryDmLoad, { ok: true }>,
  count: StoryDmCount,
): Promise<unknown> {
  const eventId = args.event.id ?? ''
  const write = await args.step.run('write-story-dm-verdict', () =>
    writeStoryDmVerdict(args.supabase, { eventId, ctx: loaded, count }),
  )
  return { ok: true as const, verdict: count.verdict, observed: count.observedValue, write: write.status }
}

async function finishBlocked(supabase: SupabaseClient, step: DmStep, loaded: StoryDmLoad): Promise<unknown> {
  if (loaded.ok) return { skipped: 'ready' }
  if (!('outcome' in loaded)) return { skipped: loaded.skipped }
  await step.run('record-dm-block', () => writeStoryDmBlock(supabase, loaded))
  return { ok: false as const, reason: loaded.reason }
}

async function writeStoryDmRetryFailure(supabase: SupabaseClient, failureEvent: { data?: unknown }): Promise<void> {
  const original = originalTrigger(failureEvent.data)
  const parsed = original ? parseStoryDmEvent(original.data) : null
  if (!parsed) return
  try {
    const loaded = await loadStoryDmContext(supabase, parsed)
    if (!loaded.ok) {
      if ('outcome' in loaded) await writeStoryDmBlock(supabase, loaded)
      return
    }
    if (!original?.id) return
    await writeStoryDmVerdict(supabase, {
      eventId: original.id,
      ctx: loaded,
      count: { verdict: 'not_readable', observedValue: null, reason: 'retries_exhausted' },
    })
  } catch {
    await writeReadbackOutcome(supabase, {
      clientId: parsed.client_id,
      subjectKind: 'story',
      subjectRef: parsed.item_id,
      outcome: 'story_dm_retries_exhausted',
      reason: 'retries_exhausted',
    }).catch(() => undefined)
  }
}

function originalTrigger(data: unknown): { id?: string; data: unknown } | null {
  if (!data || typeof data !== 'object') return null
  const event = (data as { event?: unknown }).event
  if (!event || typeof event !== 'object') return null
  const row = event as { id?: unknown; data?: unknown }
  return { id: typeof row.id === 'string' ? row.id : undefined, data: row.data }
}
