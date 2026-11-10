/**
 * Story DM window handler. Fake database, no Meta, no real sleep.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoryDmWindow, runStoryDmWindow, STORY_DM_WINDOW_ID } from '../story-dm-window'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import { STORY_DM_WINDOW_EVENT } from '@/lib/social/verify/story-dm-read'
import { SOCIAL_VERIFICATION_VERDICTS_ENV } from '@/lib/social/verification-verdicts'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const ACTION = '33333333-3333-4333-8333-333333333333'
const SENT = '2026-11-02T07:00:00.000Z'
const READ_AT = '2026-11-02T20:10:00.000Z'

interface Insert {
  table: string
  row: Record<string, unknown>
}

function eventData(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT,
    action_id: ACTION,
    item_id: ITEM,
    sent_at: SENT,
    channel: 'facebook_story',
    ...over,
  }
}

function db(opts: {
  role?: string | null
  channel?: 'facebook_story' | 'instagram_story'
  calendar?: unknown
  syncStartedAt?: string | null
  threads?: Array<Record<string, unknown>>
  threadError?: { message: string } | null
} = {}) {
  const inserts: Insert[] = []
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters[key] = value
        return api
      },
      gte: () => api,
      lt: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        if (table === 'story_items') {
          return {
            data: {
              item_id: ITEM,
              client_id: CLIENT,
              channel: opts.channel ?? 'facebook_story',
              status: 'SENT',
              sent_at: SENT,
              role: opts.role === undefined ? 'invite' : opts.role,
            },
            error: null,
          }
        }
        if (table === 'clients') {
          return { data: { publishing_calendar_config: opts.calendar ?? null }, error: null }
        }
        if (table === 'flywheel_actions') {
          return {
            data: {
              id: ACTION,
              client_id: CLIENT,
              action_type: 'social.publish_story',
              payload: { item_id: ITEM, source: 'story_lite' },
            },
            error: null,
          }
        }
        return { data: null, error: null }
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        const done = { error: null, data: { id: 'row-1' } }
        return { select: () => ({ single: async () => done }), then: (resolve: (v: unknown) => unknown) => Promise.resolve(done).then(resolve) }
      },
      then: (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) => {
        if (table === 'cron_run_logs') {
          const started = opts.syncStartedAt === undefined ? '2026-11-02T19:00:00.000Z' : opts.syncStartedAt
          return Promise.resolve(resolve({ data: started ? [{ started_at: started }] : [], error: null }))
        }
        if (table === 'conversations') {
          if (opts.threadError) return Promise.resolve(resolve({ data: null, error: opts.threadError }))
          return Promise.resolve(resolve({
            data: opts.threads ?? [
              { created_at: '2026-11-02T08:00:00.000Z', entry_referral: null },
              { created_at: '2026-11-02T09:00:00.000Z', entry_referral: { ad_id: 'ad-1' } },
            ],
            error: null,
          }))
        }
        return Promise.resolve(resolve({ data: [], error: null }))
      },
    }
    return api
  }
  return { supabase: { from } as never, inserts }
}

function stepOf() {
  const slept: Date[] = []
  const step = {
    run: async <T>(_id: string, fn: () => Promise<T> | T) => fn(),
    sleepUntil: async (_id: string, at: Date) => {
      slept.push(at)
    },
  }
  return { step, slept }
}

afterEach(() => {
  delete process.env[SOCIAL_VERIFICATION_VERDICTS_ENV]
})

describe('story DM window function', () => {
  it('is registered on the cloud app and does not call Meta', () => {
    expect(STORY_DM_WINDOW_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
    expect(cloudFunctions.some((fn) => fn.id() === STORY_DM_WINDOW_ID)).toBe(true)
    const fn = cloudFunctions.find((entry) => entry.id() === STORY_DM_WINDOW_ID) as unknown as {
      opts: { triggers?: { event?: string }[] }
    }
    expect(fn.opts.triggers?.[0]?.event).toBe(STORY_DM_WINDOW_EVENT)
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(STORY_DM_WINDOW_EVENT)
    const src = [
      'src/lib/inngest/functions/story-dm-window.ts',
      'src/lib/social/verify/story-dm-window.ts',
      'src/lib/social/verify/story-dm-read.ts',
    ].map((name) => readFileSync(resolve(name), 'utf8')).join('\n')
    expect(src).not.toContain('graph.facebook.com')
  })

  it('switch off returns before any step', async () => {
    const store = db()
    const { step } = stepOf()
    const result = await runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => false,
      event: { id: 'evt-1', data: eventData() },
      step,
    })
    expect(result).toEqual({ skipped: 'dm_window_disabled' })
    expect(store.inserts).toHaveLength(0)
  })

  it('counts one thread, drops the ad thread, and sleeps until window end plus 70 minutes', async () => {
    process.env[SOCIAL_VERIFICATION_VERDICTS_ENV] = 'true'
    const store = db()
    const { step, slept } = stepOf()
    const result = await runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => true,
      event: { id: 'evt-story-1', data: eventData() },
      step,
    })
    expect(slept.map((at) => at.toISOString())).toEqual([READ_AT])
    expect(result).toMatchObject({ ok: true, verdict: 'counted', observed: 1, write: 'inserted' })
    const verdict = store.inserts.find((row) => row.table === 'social_verification_verdicts')
    expect(verdict?.row).toMatchObject({
      record_type: 'story_dm_count',
      verdict: 'counted',
      observed_value: 1,
      reason: null,
      window_hours: 12,
      content_action_id: ACTION,
      client_id: CLIENT,
    })
    expect(verdict?.row).not.toHaveProperty('measure_at')
  })

  it('an Instagram invite story is not_readable and is not counted as zero', async () => {
    process.env[SOCIAL_VERIFICATION_VERDICTS_ENV] = 'true'
    const store = db({ channel: 'instagram_story' })
    const { step, slept } = stepOf()
    const result = await runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => true,
      event: { id: 'evt-story-ig', data: eventData({ channel: 'instagram_story' }) },
      step,
    })
    expect(slept).toHaveLength(0)
    expect(result).toMatchObject({ verdict: 'not_readable', observed: null })
    expect(store.inserts[0]?.row).toMatchObject({
      platform: 'instagram',
      verdict: 'not_readable',
      observed_value: null,
      reason: 'instagram_dm_not_stored',
    })
  })

  it('a story that is not the invite slot does not sleep or write', async () => {
    const store = db({ role: 'inspiration' })
    const { step, slept } = stepOf()
    const result = await runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => true,
      event: { id: 'evt-story-1', data: eventData() },
      step,
    })
    expect(result).toEqual({ skipped: 'not_invite_slot' })
    expect(slept).toHaveLength(0)
    expect(store.inserts).toHaveLength(0)
  })

  it('T13b a sync that starts before the window end writes not_readable and not zero', async () => {
    process.env[SOCIAL_VERIFICATION_VERDICTS_ENV] = 'true'
    const store = db({ syncStartedAt: '2026-11-02T18:00:00.000Z' })
    const { step } = stepOf()
    const result = await runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => true,
      event: { id: 'evt-story-1', data: eventData() },
      step,
    })
    expect(result).toMatchObject({ verdict: 'not_readable', observed: null })
    expect(store.inserts[0]?.row).toMatchObject({
      verdict: 'not_readable',
      observed_value: null,
      reason: 'sync_not_caught_up',
    })
  })

  it('a thread query error throws and does not insert a zero', async () => {
    process.env[SOCIAL_VERIFICATION_VERDICTS_ENV] = 'true'
    const store = db({ threadError: { message: 'db down' } })
    const { step } = stepOf()
    await expect(runStoryDmWindow({
      supabase: store.supabase,
      enabled: () => true,
      event: { id: 'evt-story-1', data: eventData() },
      step,
    })).rejects.toThrow(/thread query failed/)
    expect(store.inserts.filter((row) => row.table === 'social_verification_verdicts')).toHaveLength(0)
  })

  it('retries exhausted write not_readable, not zero', async () => {
    process.env[SOCIAL_VERIFICATION_VERDICTS_ENV] = 'true'
    const store = db()
    const fn = createStoryDmWindow({ supabase: store.supabase, enabled: () => true })
    const onFailure = (fn as unknown as {
      opts: { onFailure: (ctx: { event: { data: unknown } }) => Promise<void> }
    }).opts.onFailure
    await onFailure({
      event: { data: { event: { id: 'evt-story-1', data: eventData() } } },
    })
    expect(store.inserts[0]?.row).toMatchObject({
      verdict: 'not_readable',
      observed_value: null,
      reason: 'retries_exhausted',
    })
  })
})
