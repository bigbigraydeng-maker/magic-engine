/**
 * Scheduled photo → story id → standard measurement event.
 *
 * The fake Graph follows Meta's Photo reference ("page_story_id: Applies only
 * to published photos"): before the scheduled time it answers `{id}` only;
 * after it, `{id, page_story_id: "<page>_<photo>"}`. The fake step's
 * `sleepUntil` is what moves the clock — so a workflow that reads without
 * waiting sees exactly what production would: no story id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/token-manager', () => ({ getStoredPageToken: vi.fn() }))

import { getStoredPageToken } from '@/lib/meta/token-manager'
import {
  DailyPlanPostPublishedEventSchema,
  STORY_RESOLVE_JOB_NAME,
  measurementSchedule,
  storyResolveAttempts,
  storyResolveEventId,
  type StoryResolveDue,
} from '@/lib/campaign/daily-plan-publish'
import { writeMeasurementRecord, type MeasurementRecord } from '@/lib/campaign/daily-plan-measurement-record'
import {
  STORY_RESOLVE_FUNCTION_ID,
  STORY_RESOLVE_RETRIES,
  createStoryResolveFunction,
  readIsRecalled,
  readStoryOnce,
  recordWorkflowFailure,
  runStoryResolve,
  type StoryResolveDeps,
  type StoryResolveStep,
} from '../daily-plan-post-story-resolve'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'

const mockToken = vi.mocked(getStoredPageToken)

const CLIENT = '00000000-0000-4000-8000-000000000001'
const PAGE = '1616575215312482'
const PHOTO = '1750835520181969'
const KEY = 'fbpost_0123456789abcdef0123456789abcdef'
const SCHEDULED = '2026-09-16T20:00:00.000Z'

function due(over: Partial<StoryResolveDue> = {}): StoryResolveDue {
  return {
    client_id: CLIENT,
    campaign_id: '00000000-0000-4000-8000-000000000002',
    plan_id: '00000000-0000-4000-8000-000000000003',
    plan_revision: '2026-09-15T00:00:00.000Z',
    review_revision: '00000000-0000-4000-8000-000000000004',
    date: '2026-09-17',
    idempotency_key: KEY,
    photo_id: PHOTO,
    page_id: PAGE,
    published_at: '2026-09-15T01:00:00.000Z',
    scheduled_publish_time: SCHEDULED,
    measure_at: measurementSchedule(SCHEDULED),
    ...over,
  }
}

/** Clock that only `sleepUntil` advances. Starts at publish time. */
function fakeStep(opts: { memo?: Map<string, unknown> } = {}) {
  const clock = { now: Date.parse('2026-09-15T01:00:00.000Z') }
  const log: string[] = []
  const memo = opts.memo
  const step: StoryResolveStep = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      log.push(`run:${id}`)
      if (memo?.has(id)) return memo.get(id) as T
      const value = await fn()
      memo?.set(id, value)
      return value
    },
    async sleepUntil(id: string, at: Date) {
      log.push(`sleep:${id}@${at.toISOString()}`)
      clock.now = Math.max(clock.now, at.getTime())
    },
  }
  return { step, clock, log }
}

type GraphMode = 'scheduled_then_public' | 'never_public' | 'deleted' | 'foreign_page'

/** Graph per Meta's Photo reference; `clock` decides whether the photo is public yet. */
function fakeGraph(clock: { now: number }, mode: GraphMode) {
  const urls: string[] = []
  const fetcher: typeof fetch = async (input) => {
    urls.push(String(input))
    if (mode === 'deleted') {
      // Graph's "object does not exist": code 100 + subcode 33.
      return Response.json({ error: { message: 'Object does not exist', code: 100, error_subcode: 33 } }, { status: 400 })
    }
    const isPublic = mode !== 'never_public' && clock.now >= Date.parse(SCHEDULED)
    if (!isPublic) return Response.json({ id: PHOTO })
    const owner = mode === 'foreign_page' ? '999999999999' : PAGE
    return Response.json({ id: PHOTO, page_story_id: `${owner}_${PHOTO}` })
  }
  return { fetcher, urls }
}

/** Fake Supabase by table: `clients` (registered Page) and `social_plans` (receipt `recalled[]`). */
function fakeSupabase(registeredPageId: string | null, recalledKeys: string[] = [], planError: { message: string } | null = null) {
  return {
    from: (table: string) => {
      const data = table === 'clients'
        ? (registeredPageId ? { facebook_page_id: registeredPageId } : null)
        : table === 'social_plans'
          ? { plan_data: { publish_meta: { recalled: recalledKeys.map(k => ({ idempotency_key: k, post_id: PHOTO })) } } }
          : undefined
      if (data === undefined) throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => (table === 'social_plans' && planError ? { data: null, error: planError } : { data, error: null }),
      }
      return chain
    },
  }
}

function harness(
  mode: GraphMode,
  over: { registered?: string | null; memo?: Map<string, unknown>; recalledKeys?: string[] } = {},
) {
  const { step, clock, log } = fakeStep({ memo: over.memo })
  const graph = fakeGraph(clock, mode)
  const records: MeasurementRecord[] = []
  const send = vi.fn(async (_event: { id: string; name: string; data: Record<string, unknown> }) => ({ event_ids: ['evt_1'] }))
  const supabase = fakeSupabase(over.registered === undefined ? PAGE : over.registered, over.recalledKeys ?? [])
  const deps: StoryResolveDeps = {
    supabase: supabase as never,
    readStory: (d) => readStoryOnce(d, graph.fetcher),
    isRecalled: (d) => readIsRecalled(supabase as never, d),
    send,
    writeRecord: async (record) => { records.push(record) },
  }
  return { step, clock, log, graph, records, send, deps }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockToken.mockResolvedValue('page-token')
})

describe('story-resolve — registration', () => {
  it('is a cloud- function registered in cloudFunctions, on an event the local worker does not own', () => {
    expect(STORY_RESOLVE_FUNCTION_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
    expect(cloudFunctions.map(fn => fn.id())).toContain(STORY_RESOLVE_FUNCTION_ID)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes('daily_plan.post.story_resolve_due')).toBe(false)
    expect(STORY_RESOLVE_RETRIES).toBeGreaterThan(0)
  })

  it('🔴 the registered function really carries retries: 3 and an onFailure handler', () => {
    // Read the config Inngest actually stores (not the exported constant), so
    // deleting `retries` or `onFailure` from createFunction turns this red.
    const fn = createStoryResolveFunction(harness('scheduled_then_public').deps)
    const opts = z.object({ retries: z.number(), onFailure: z.function() }).safeParse(Reflect.get(fn, 'opts'))
    expect(opts.success).toBe(true)
    expect(opts.success && opts.data.retries).toBe(3)
  })

  it('🔴 resolve event id includes the photo id: same key + new photo (recall then re-publish) → different id', () => {
    expect(storyResolveEventId(KEY, PHOTO)).toBe(`${KEY}:resolve:${PHOTO}`)
    expect(storyResolveEventId(KEY, PHOTO)).toBe(storyResolveEventId(KEY, PHOTO))
    expect(storyResolveEventId(KEY, '1750835520999999')).not.toBe(storyResolveEventId(KEY, PHOTO))
  })

  it('attempts are bounded: +10 min, +1 h, +6 h after the scheduled time', () => {
    expect(storyResolveAttempts(due()).map(a => a.at)).toEqual([
      '2026-09-16T20:10:00.000Z',
      '2026-09-16T21:00:00.000Z',
      '2026-09-17T02:00:00.000Z',
    ])
  })
})

describe('story-resolve — resolved', () => {
  it('🔴 waits until the photo is public, then emits a published event that passes the consumer schema', async () => {
    const h = harness('scheduled_then_public')

    const result = await runStoryResolve(due(), h.step, h.deps)

    expect(result).toEqual({ ok: true, outcome: 'emitted', post_id: `${PAGE}_${PHOTO}`, attempt: 1 })
    // The first Graph read happens only after sleeping past the scheduled time.
    const sleepIndex = h.log.indexOf('sleep:wait-resolve-1@2026-09-16T20:10:00.000Z')
    expect(sleepIndex).toBeGreaterThanOrEqual(0)
    expect(h.log.indexOf('run:read-story-id-1')).toBeGreaterThan(sleepIndex)
    expect(h.graph.urls).toEqual([`https://graph.facebook.com/v20.0/${PHOTO}?fields=page_story_id&access_token=page-token`])
    expect(mockToken).toHaveBeenCalledWith(CLIENT, PAGE)

    expect(h.send).toHaveBeenCalledTimes(1)
    const event = h.send.mock.calls[0][0]
    expect(event.name).toBe('daily_plan.post.published')
    expect(event.id).toBe(KEY)
    const parsed = DailyPlanPostPublishedEventSchema.safeParse(event.data)
    expect(parsed.success).toBe(true)
    expect(event.data).toMatchObject({
      post_id: `${PAGE}_${PHOTO}`,
      page_id: PAGE,
      permalink: `https://www.facebook.com/${PAGE}_${PHOTO}`,
      scheduled_publish_time: SCHEDULED,
      measure_at: measurementSchedule(SCHEDULED),
      idempotency_key: KEY,
    })
    expect(h.records).toEqual([])
  })

  it('🔴 replay: a memoized re-run sends once; a duplicate delivery reuses the same event id', async () => {
    const memo = new Map<string, unknown>()
    const first = harness('scheduled_then_public', { memo })
    await runStoryResolve(due(), first.step, first.deps)
    // Inngest replays the function body with step results memoized.
    const replayStep = fakeStep({ memo }).step
    await runStoryResolve(due(), replayStep, first.deps)
    expect(first.send).toHaveBeenCalledTimes(1)

    // A second delivery of the same event (new run) must carry the identical id so Inngest dedupes.
    const second = harness('scheduled_then_public')
    await runStoryResolve(due(), second.step, second.deps)
    expect(second.send.mock.calls[0][0].id).toBe(first.send.mock.calls[0][0].id)
    expect(second.send.mock.calls[0][0].id).toBe(KEY)
  })
})

describe('story-resolve — not resolved', () => {
  it('🔴 never public: bounded retries, then a failed record the to-do list can read; no event', async () => {
    const h = harness('never_public')

    const result = await runStoryResolve(due(), h.step, h.deps)

    expect(result).toEqual({ ok: false, reason: 'unresolved' })
    expect(h.graph.urls).toHaveLength(3)
    expect(h.log.filter(l => l.startsWith('sleep:'))).toEqual([
      'sleep:wait-resolve-1@2026-09-16T20:10:00.000Z',
      'sleep:wait-resolve-2@2026-09-16T21:00:00.000Z',
      'sleep:wait-resolve-3@2026-09-17T02:00:00.000Z',
    ])
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records).toEqual([{
      status: 'failed',
      outcome: 'unresolved',
      reason: 'no_page_story_id',
      attempts: 3,
      post: {
        client_id: CLIENT,
        campaign_id: '00000000-0000-4000-8000-000000000002',
        plan_id: '00000000-0000-4000-8000-000000000003',
        date: '2026-09-17',
        idempotency_key: KEY,
        photo_id: PHOTO,
        page_id: PAGE,
        scheduled_publish_time: SCHEDULED,
      },
    }])
  })

  it('🔴 story id on another Page is refused, never emitted', async () => {
    const h = harness('foreign_page')
    await runStoryResolve(due(), h.step, h.deps)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records[0]).toMatchObject({ status: 'failed', outcome: 'unresolved', reason: 'page_prefix_mismatch' })
  })

  it('🔴 photo gone and this Post is in the receipt\'s recalled[]: completed, no measurement event', async () => {
    const h = harness('deleted', { recalledKeys: [KEY] })
    const result = await runStoryResolve(due(), h.step, h.deps)
    expect(result).toEqual({ ok: true, outcome: 'photo_gone', attempt: 1 })
    expect(h.graph.urls).toHaveLength(1)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records).toEqual([expect.objectContaining({ status: 'completed', outcome: 'photo_gone', reason: 'recalled' })])
  })

  it('🔴 photo gone but NOT recalled by us (deleted by hand / Graph glitch): failed record for a human, no event', async () => {
    const h = harness('deleted', { recalledKeys: ['fbpost_some_other_post'] })
    const result = await runStoryResolve(due(), h.step, h.deps)
    expect(result).toEqual({ ok: false, reason: 'photo_gone_not_recalled' })
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records).toEqual([expect.objectContaining({ status: 'failed', outcome: 'photo_gone_not_recalled' })])
  })

  it('recall check hits a DB error → throws so the step retries (never guesses "recalled")', async () => {
    const supabase = fakeSupabase(PAGE, [KEY], { message: 'db timeout' })
    await expect(readIsRecalled(supabase as never, due())).rejects.toThrow(/db timeout/)
  })

  it('no stored Page token: keeps retrying, then records token_unavailable', async () => {
    mockToken.mockResolvedValue(null)
    const h = harness('scheduled_then_public')
    await runStoryResolve(due(), h.step, h.deps)
    expect(h.graph.urls).toHaveLength(0)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records[0]).toMatchObject({ status: 'failed', reason: 'token_unavailable', attempts: 3 })
  })

  it('🔴 client registered on a different Page: no Graph call, no event, no token lookup', async () => {
    const h = harness('scheduled_then_public', { registered: '999999999999' })
    const result = await runStoryResolve(due(), h.step, h.deps)
    expect(result).toEqual({ ok: false, reason: 'page_mismatch' })
    expect(mockToken).not.toHaveBeenCalled()
    expect(h.graph.urls).toHaveLength(0)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.records).toEqual([expect.objectContaining({ status: 'failed', outcome: 'isolation_refused', reason: 'page_mismatch' })])
  })

  it('client has no registered Page: refused with a failed record', async () => {
    const h = harness('scheduled_then_public', { registered: null })
    const result = await runStoryResolve(due(), h.step, h.deps)
    expect(result).toEqual({ ok: false, reason: 'client_page_unknown' })
    expect(h.records).toEqual([expect.objectContaining({ status: 'failed', outcome: 'isolation_refused', reason: 'client_page_unknown' })])
  })

  it('invalid payload: nothing runs', async () => {
    const h = harness('scheduled_then_public')
    const result = await runStoryResolve({ ...due(), photo_id: 'abc' }, h.step, h.deps)
    expect(result).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(h.log).toEqual([])
  })

  it('retries exhausted on a thrown step → onFailure still leaves a failed record', async () => {
    const records: MeasurementRecord[] = []
    await recordWorkflowFailure(due(), { writeRecord: async (r) => { records.push(r) } })
    expect(records).toEqual([expect.objectContaining({ status: 'failed', outcome: 'workflow_failed', reason: 'retries_exhausted' })])
  })
})

describe('story-resolve — outcome record storage', () => {
  it('writes one cron_run_logs row with the fields the to-do list reads, and throws when the write fails', async () => {
    const inserted: Record<string, unknown>[] = []
    let error: { message: string } | null = null
    const supabase = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          expect(table).toBe('cron_run_logs')
          inserted.push(row)
          return { error }
        },
      }),
    }
    const record: MeasurementRecord = {
      status: 'failed', outcome: 'unresolved', reason: 'no_page_story_id', attempts: 3,
      post: { client_id: CLIENT, campaign_id: 'c', plan_id: 'p', date: '2026-09-17', idempotency_key: KEY, photo_id: PHOTO, page_id: PAGE },
    }
    await writeMeasurementRecord(supabase as never, record)
    expect(inserted[0]).toMatchObject({
      job_name: STORY_RESOLVE_JOB_NAME,
      status: 'failed',
      processed: 1,
      failed_count: 1,
      summary: { outcome: 'unresolved', reason: 'no_page_story_id', client_id: CLIENT, idempotency_key: KEY, photo_id: PHOTO },
    })

    error = { message: 'db down' }
    await expect(writeMeasurementRecord(supabase as never, record)).rejects.toThrow(/db down/)
  })
})
