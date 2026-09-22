/**
 * Scheduled Daily Plan photo → feed story id → standard measurement event.
 *
 * Why this exists: Graph `/photos` with `published:false + scheduled_publish_time`
 * returns only the photo `id`, and Meta documents `page_story_id` as applying
 * only to *published* photos. The publisher therefore cannot know the feed
 * post id; it emits `daily_plan.post.story_resolve_due` instead, and this
 * workflow finishes the handoff:
 *
 *   isolation  client's registered Page must equal the event's Page (no Graph call otherwise)
 *   wait       sleep until the photo is due to be public (+10 min)
 *   resolve    bounded attempts at +10 min / +1 h / +6 h: read `page_story_id`
 *              with the client's stored Page token
 *   emit       build the standard payload, self-check it against
 *              DailyPlanPostPublishedEventSchema, send with event id =
 *              idempotency key (same id rule as the immediate path → one event
 *              per Post, replays dedupe)
 *
 * The only outcomes that need no human: resolved + emitted; photo gone AND the
 * receipt says this Post was recalled. Every other end state — including a
 * photo that vanished without a recall, and an isolation refusal — writes a
 * *failed* record (`writeMeasurementRecord`), which the daily to-do list reads.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent, type InngestSendResult } from '@/lib/workflows/inngest-event'
import {
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  DAILY_PLAN_POST_STORY_RESOLVE_EVENT,
  DailyPlanPostPublishedEventSchema,
  StoryResolveDueSchema,
  publishedEventFromResolved,
  storyResolveAttempts,
  type StoryResolveDue,
} from '@/lib/campaign/daily-plan-publish'
import {
  writeMeasurementRecord,
  type MeasurementRecord,
  type MeasurementRecordPost,
} from '@/lib/campaign/daily-plan-measurement-record'
import { getStoredPageToken } from '@/lib/meta/token-manager'
import { readPageStoryId } from '@/lib/meta/page-posts'
import { readRegisteredPageId } from './daily-plan-post-measurement'

export const STORY_RESOLVE_FUNCTION_ID = `${CLOUD_FN_PREFIX}daily-plan-post-story-resolve`

export type StoryReadOutcome =
  | { kind: 'resolved'; postId: string }
  | { kind: 'gone' }
  | { kind: 'not_yet'; reason: string }

export type StoryResolveResult =
  | { ok: true; outcome: 'emitted'; post_id: string; attempt: number }
  | { ok: true; outcome: 'photo_gone'; attempt: number }
  | { ok: false; reason: string }

/** Minimal step surface this workflow uses — Inngest's step satisfies it. */
export interface StoryResolveStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleepUntil(id: string, at: Date): Promise<void>
}

export interface StoryResolveDeps {
  supabase: SupabaseClient
  readStory: (due: StoryResolveDue) => Promise<StoryReadOutcome>
  /** Is this Post's idempotency key in the plan receipt's `recalled[]`? Throws on DB error. */
  isRecalled: (due: StoryResolveDue) => Promise<boolean>
  send: (event: { id: string; name: string; data: Record<string, unknown> }) => Promise<InngestSendResult>
  writeRecord: (record: MeasurementRecord) => Promise<void>
}

/** One read with the Page token fetched at execution time (it may have rotated since publish). */
export async function readStoryOnce(due: StoryResolveDue, fetcher: typeof fetch = fetch): Promise<StoryReadOutcome> {
  const token = await getStoredPageToken(due.client_id, due.page_id)
  if (!token) return { kind: 'not_yet', reason: 'token_unavailable' }
  const read = await readPageStoryId({ photoId: due.photo_id, pageId: due.page_id, pageAccessToken: token, fetcher })
  if (read.ok) return { kind: 'resolved', postId: read.postId }
  if (read.reason === 'object_not_found') return { kind: 'gone' }
  return { kind: 'not_yet', reason: read.reason }
}

/**
 * A vanished photo is only a normal end if *we* recalled it. Anything else
 * (deleted by hand in Business Suite, a Graph glitch) must reach a human.
 */
export async function readIsRecalled(supabase: SupabaseClient, due: StoryResolveDue): Promise<boolean> {
  const { data, error } = await supabase
    .from('social_plans')
    .select('plan_data')
    .eq('id', due.plan_id)
    .eq('client_id', due.client_id)
    .maybeSingle()
  if (error) throw new Error(`readIsRecalled: ${error.message}`)
  const recalled = (data as { plan_data?: { publish_meta?: { recalled?: unknown } } } | null)?.plan_data?.publish_meta?.recalled
  if (!Array.isArray(recalled)) return false
  return recalled.some(entry =>
    typeof entry === 'object' && entry !== null && 'idempotency_key' in entry && entry.idempotency_key === due.idempotency_key,
  )
}

function recordPost(due: StoryResolveDue): MeasurementRecordPost {
  return {
    client_id: due.client_id,
    campaign_id: due.campaign_id,
    plan_id: due.plan_id,
    date: due.date,
    idempotency_key: due.idempotency_key,
    photo_id: due.photo_id,
    page_id: due.page_id,
    ...(due.scheduled_publish_time ? { scheduled_publish_time: due.scheduled_publish_time } : {}),
  }
}

async function emitResolved(
  due: StoryResolveDue,
  postId: string,
  attempt: number,
  step: StoryResolveStep,
  deps: StoryResolveDeps,
): Promise<StoryResolveResult> {
  const parsed = DailyPlanPostPublishedEventSchema.safeParse(publishedEventFromResolved(due, postId))
  if (!parsed.success) {
    await step.run('record-contract-violation', () =>
      deps.writeRecord({ status: 'failed', outcome: 'event_contract_invalid', reason: 'event_contract_invalid', attempts: attempt, post: recordPost(due) }),
    )
    return { ok: false, reason: 'event_contract_invalid' }
  }
  // Same event id as the immediate-publish path: one published event per Post.
  await step.run('emit-published-event', () =>
    deps.send({ id: due.idempotency_key, name: DAILY_PLAN_POST_PUBLISHED_EVENT, data: parsed.data }),
  )
  return { ok: true, outcome: 'emitted', post_id: postId, attempt }
}

async function handleGone(due: StoryResolveDue, attempt: number, step: StoryResolveStep, deps: StoryResolveDeps): Promise<StoryResolveResult> {
  const recalled = await step.run('check-recalled', () => deps.isRecalled(due))
  if (recalled) {
    await step.run('record-photo-gone', () =>
      deps.writeRecord({ status: 'completed', outcome: 'photo_gone', reason: 'recalled', attempts: attempt, post: recordPost(due) }),
    )
    return { ok: true, outcome: 'photo_gone', attempt }
  }
  await step.run('record-photo-gone-not-recalled', () =>
    deps.writeRecord({ status: 'failed', outcome: 'photo_gone_not_recalled', reason: 'object_not_found', attempts: attempt, post: recordPost(due) }),
  )
  return { ok: false, reason: 'photo_gone_not_recalled' }
}

async function checkIsolation(due: StoryResolveDue, step: StoryResolveStep, deps: StoryResolveDeps): Promise<string | null> {
  const registered = await step.run('isolation-check', () => readRegisteredPageId(deps.supabase, due.client_id))
  const refusal = !registered ? 'client_page_unknown' : registered !== due.page_id ? 'page_mismatch' : null
  if (!refusal) return null
  await step.run('record-isolation-refused', () =>
    deps.writeRecord({ status: 'failed', outcome: 'isolation_refused', reason: refusal, attempts: 0, post: recordPost(due) }),
  )
  return refusal
}

export async function runStoryResolve(
  data: unknown,
  step: StoryResolveStep,
  deps: StoryResolveDeps,
): Promise<StoryResolveResult> {
  const parsed = StoryResolveDueSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid_payload' }
  const due = parsed.data

  const refusal = await checkIsolation(due, step, deps)
  if (refusal) return { ok: false, reason: refusal }

  let lastReason = 'not_attempted'
  const attempts = storyResolveAttempts(due)
  for (const { attempt, at } of attempts) {
    // Never read before the photo is public: Meta has no story id until then.
    await step.sleepUntil(`wait-resolve-${attempt}`, new Date(at))
    const read = await step.run(`read-story-id-${attempt}`, () => deps.readStory(due))
    if (read.kind === 'resolved') return emitResolved(due, read.postId, attempt, step, deps)
    if (read.kind === 'gone') return handleGone(due, attempt, step, deps)
    lastReason = read.reason
  }

  await step.run('record-unresolved', () =>
    deps.writeRecord({ status: 'failed', outcome: 'unresolved', reason: lastReason, attempts: attempts.length, post: recordPost(due) }),
  )
  return { ok: false, reason: 'unresolved' }
}

/** Retries exhausted on a thrown step (e.g. event send kept failing) — still leave a visible record. */
export async function recordWorkflowFailure(originalData: unknown, deps: Pick<StoryResolveDeps, 'writeRecord'>): Promise<void> {
  const parsed = StoryResolveDueSchema.safeParse(originalData)
  if (!parsed.success) return
  await deps.writeRecord({
    status: 'failed',
    outcome: 'workflow_failed',
    reason: 'retries_exhausted',
    attempts: 0,
    post: recordPost(parsed.data),
  })
}

export const STORY_RESOLVE_RETRIES = 3

export function createStoryResolveFunction(deps: StoryResolveDeps) {
  return inngest.createFunction(
    {
      id: STORY_RESOLVE_FUNCTION_ID,
      name: 'Daily Plan Post: resolve scheduled photo story id',
      concurrency: { limit: 4, key: 'event.data.page_id' },
      retries: STORY_RESOLVE_RETRIES,
      onFailure: async ({ event }) => {
        await recordWorkflowFailure((event.data as { event?: { data?: unknown } })?.event?.data, deps)
      },
    },
    { event: DAILY_PLAN_POST_STORY_RESOLVE_EVENT },
    async ({ event, step }) =>
      runStoryResolve(
        event.data,
        {
          // Inngest types a memoized result as Jsonify<T>. Every step result in
          // this workflow is already plain JSON (StoryReadOutcome, string | null,
          // boolean, InngestSendResult, void), so Jsonify<T> and T have the same shape.
          run: (id, fn) => step.run(id, fn) as Promise<Awaited<ReturnType<typeof fn>>>,
          sleepUntil: async (id, at) => { await step.sleepUntil(id, at) },
        },
        deps,
      ),
  )
}

export const dailyPlanPostStoryResolve = createStoryResolveFunction({
  supabase: supabaseAdmin,
  readStory: (due) => readStoryOnce(due),
  isRecalled: (due) => readIsRecalled(supabaseAdmin, due),
  send: (event) => sendInngestEvent(event),
  writeRecord: (record) => writeMeasurementRecord(supabaseAdmin, record),
})
