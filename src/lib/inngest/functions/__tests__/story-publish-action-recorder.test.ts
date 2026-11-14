/**
 * T11 / T11b. The live-send filter runs before any step and before any query.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStoryPublishActionRecorder, STORY_PUBLISH_ACTION_RECORDER_ID } from '../story-publish-action-recorder'
import type { PublishDispatchReceipt } from '@/lib/social/publish-gate/receipt'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import { LITE_EVENTS } from '@/lib/social/story-lite/types'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const PACK = '33333333-3333-4333-8333-333333333333'
const PAGE = '12345'

type Insert = { table: string; row: Record<string, unknown> }

function handlerOf(fn: ReturnType<typeof createStoryPublishActionRecorder>) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

function liveEvent(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT,
    pack_id: PACK,
    item_id: ITEM,
    channel: 'facebook_story',
    status: 'SENT',
    mode: 'LIVE',
    provider_receipt: 'story-receipt-1',
    ...over,
  }
}

function db(opts: {
  item?: Record<string, unknown> | null
  pageId?: string | null
} = {}) {
  const inserts: Insert[] = []
  const from = vi.fn((table: string) => {
    const api = {
      select: () => api,
      eq: () => api,
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        const done = { error: null, data: { id: 'action-1' } }
        return {
          select: () => ({ single: async () => done }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        }
      },
      maybeSingle: async () => {
        if (table === 'story_items') return { data: opts.item === undefined ? sentItem() : opts.item, error: null }
        if (table === 'clients') return { data: { facebook_page_id: opts.pageId === undefined ? PAGE : opts.pageId }, error: null }
        return { data: null, error: null }
      },
    }
    return api
  })
  return { supabase: { from } as never, from, inserts }
}

function sentItem(over: Record<string, unknown> = {}) {
  return {
    item_id: ITEM,
    pack_id: PACK,
    client_id: CLIENT,
    channel: 'facebook_story',
    account_id: PAGE,
    status: 'SENT',
    provider_receipt: 'story-receipt-1',
    sent_at: '2026-11-02T07:00:00.000Z',
    ...over,
  }
}

function run(data: unknown, store = db(), opts: { enabled?: boolean; clientLive?: boolean } = {}) {
  const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
  const receipts: PublishDispatchReceipt[] = []
  const fn = createStoryPublishActionRecorder({
    supabase: store.supabase,
    enabled: () => opts.enabled ?? true,
    clientLive: async () => opts.clientLive ?? true,
    recordDryRun: async (receipt) => { receipts.push(receipt) },
  })
  return { step, store, receipts, done: handlerOf(fn)({ event: { data }, step }) }
}

describe('story publish action recorder', () => {
  it('is registered on the cloud app and does not call a Meta write', () => {
    expect(STORY_PUBLISH_ACTION_RECORDER_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
    expect(cloudFunctions.some((fn) => fn.id() === STORY_PUBLISH_ACTION_RECORDER_ID)).toBe(true)
    const triggers = (cloudFunctions.find((fn) => fn.id() === STORY_PUBLISH_ACTION_RECORDER_ID) as unknown as {
      opts: { triggers?: { event?: string }[] }
    }).opts.triggers ?? []
    expect(triggers[0]?.event).toBe(LITE_EVENTS.itemAttempted)
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(LITE_EVENTS.itemAttempted)
    const src = [
      'src/lib/inngest/functions/story-publish-action-recorder.ts',
      'src/lib/inngest/functions/story-publish-action-reconcile.ts',
      'src/lib/social/story-publish-action.ts',
      'src/lib/social/publish-gate/receipt.ts',
      'src/lib/social/publish-gate/read-live.ts',
    ].map((name) => readFileSync(resolve(name), 'utf8')).join('\n')
    expect(src).not.toContain('graph.facebook.com')
  })

  it('master switch off: a live send records post id and time and writes no action', async () => {
    const { store, receipts, done } = run(liveEvent(), db(), { enabled: false })
    await expect(done).resolves.toMatchObject({ ok: true, mode: 'dry_run', recorded: true })
    expect(receipts).toEqual([expect.objectContaining({
      kind: 'story_register',
      mode: 'dry_run',
      postId: 'story-receipt-1',
      publishedAt: '2026-11-02T07:00:00.000Z',
      calledPublishApi: false,
      reason: 'master_switch_off',
    })])
    expect(store.inserts.filter((row) => row.table === 'flywheel_actions')).toHaveLength(0)
  })

  it('client switch off: the master switch alone does not write an action', async () => {
    const { store, receipts, done } = run(liveEvent(), db(), { enabled: true, clientLive: false })
    await expect(done).resolves.toMatchObject({ mode: 'dry_run', recorded: true })
    expect(receipts[0]).toMatchObject({ reason: 'client_switch_off', calledPublishApi: false, postId: 'story-receipt-1' })
    expect(store.inserts.filter((row) => row.table === 'flywheel_actions')).toHaveLength(0)
  })

  it('a live send that does not match leaves a failed receipt when the switch is off', async () => {
    const { store, receipts, done } = run(liveEvent(), db({ item: sentItem({ status: 'FAILED' }) }), { enabled: false })
    await expect(done).resolves.toMatchObject({ ok: false, reason: 'status_not_sent', recorded: true })
    expect(receipts[0]).toMatchObject({ mode: 'failed', calledPublishApi: false, reason: 'status_not_sent' })
    expect(store.inserts.filter((row) => row.table === 'flywheel_actions')).toHaveLength(0)
    expect(store.inserts.filter((row) => row.table === 'cron_run_logs')).toHaveLength(0)
  })

  it('a missing receipt writer is not a silent skip', async () => {
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionRecorder({ supabase: db().supabase, enabled: () => false })
    await expect(handlerOf(fn)({ event: { data: liveEvent() }, step })).rejects.toThrow('receipt writer missing')
  })

  it('T11b dry run, blocked, and retry do not query and do not step', async () => {
    for (const data of [
      liveEvent({ mode: 'DRY_RUN' }),
      liveEvent({ status: 'BLOCKED', mode: 'LIVE' }),
      liveEvent({ status: 'RETRY_LATER', mode: 'LIVE' }),
    ]) {
      const { step, store, done } = run(data)
      await expect(done).resolves.toEqual({ skipped: 'not_live_sent' })
      expect(step.run).not.toHaveBeenCalled()
      expect(store.from).not.toHaveBeenCalled()
    }
  })

  it('T11 a mismatched receipt, status, or page writes an outcome and no action row', async () => {
    const cases = [
      { item: sentItem({ provider_receipt: 'other' }), pageId: PAGE, reason: 'receipt_mismatch' },
      { item: sentItem({ status: 'FAILED' }), pageId: PAGE, reason: 'status_not_sent' },
      { item: sentItem(), pageId: '99999', reason: 'page_mismatch' },
    ]
    for (const one of cases) {
      const { store, done } = run(liveEvent(), db(one))
      await expect(done).resolves.toMatchObject({ ok: false, reason: one.reason })
      expect(store.inserts.filter((row) => row.table === 'flywheel_actions')).toHaveLength(0)
      const outcomes = store.inserts.filter((row) => row.table === 'cron_run_logs')
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].row.summary).toMatchObject({
        subject_kind: 'story',
        subject_ref: ITEM,
        outcome: `story_register_refused:${one.reason}`,
      })
      expect(outcomes[0].row.summary).not.toHaveProperty('campaign_id')
    }
  })

  it('a matching live send writes one story action and no outcome', async () => {
    const { store, done } = run(liveEvent())
    await expect(done).resolves.toMatchObject({ ok: true, created: true })
    const actions = store.inserts.filter((row) => row.table === 'flywheel_actions')
    expect(actions).toHaveLength(1)
    expect(actions[0].row.expected_metric).toBeNull()
    expect(actions[0].row.payload).not.toHaveProperty('measure_at')
    expect(store.inserts.filter((row) => row.table === 'cron_run_logs')).toHaveLength(0)
  })

  it('schedules a DM window only when the verdict switch is on, and still omits measure_at', async () => {
    const scheduled: Array<Record<string, unknown>> = []
    const store = db()
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionRecorder({
      supabase: store.supabase,
      enabled: () => true,
      clientLive: async () => true,
      dmWindowEnabled: () => true,
      scheduleDmWindow: async (input) => {
        scheduled.push(input as unknown as Record<string, unknown>)
      },
    })
    await expect(handlerOf(fn)({ event: { data: liveEvent() }, step })).resolves.toMatchObject({ ok: true, created: true })
    expect(scheduled).toEqual([{
      client_id: CLIENT,
      action_id: 'action-1',
      item_id: ITEM,
      sent_at: '2026-11-02T07:00:00.000Z',
      channel: 'facebook_story',
    }])
    expect(step.run.mock.calls.map((call) => call[0])).toContain('schedule-dm-window')
    const off = run(liveEvent())
    await off.done
    expect(off.step.run.mock.calls.map((call) => call[0])).not.toContain('schedule-dm-window')
  })
})
