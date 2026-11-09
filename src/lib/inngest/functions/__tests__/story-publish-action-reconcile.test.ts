/**
 * T12b. Backfill is off unless the switch is exactly true, and one run
 * registers at most 50 stories. It never publishes.
 */
import { describe, expect, it, vi } from 'vitest'
import { createStoryPublishActionReconcile, STORY_PUBLISH_ACTION_RECONCILE_ID } from '../story-publish-action-reconcile'
import { listUnregisteredSentStories } from '@/lib/social/story-publish-reconcile'
import { storyPublishIdempotencyKey } from '@/lib/social/story-publish-action'
import { cloudFunctions } from '../index'
import { WORKER_OWNED_EVENTS } from '../../client'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const PAGE = '12345'
const NOW = new Date('2026-11-02T07:33:00.000Z')

function itemId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`
}

function row(index: number, sentAt = '2026-11-02T07:00:00.000Z') {
  return {
    item_id: itemId(index),
    pack_id: '33333333-3333-4333-8333-333333333333',
    client_id: CLIENT,
    channel: 'facebook_story',
    account_id: PAGE,
    status: 'SENT',
    provider_receipt: `receipt-${index}`,
    sent_at: sentAt,
  }
}

function handlerOf(fn: ReturnType<typeof createStoryPublishActionReconcile>) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

function storyDb(items: ReturnType<typeof row>[], registered: string[] = []) {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const pageSizes: number[] = []
  let sawSince = false
  const supabase = {
    from(table: string) {
      const state = {
        start: 0,
        end: null as number | null,
        ranged: false,
        since: null as string | null,
        limit: null as number | null,
        afterSent: null as string | null,
        afterId: null as string | null,
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: (_col: string, value: string) => {
          state.since = value
          sawSince = true
          return builder
        },
        order: () => builder,
        in: () => builder,
        or: (expr: string) => {
          state.afterId = expr.match(/item_id\.gt\."([0-9a-f-]+)"/i)?.[1] ?? null
          state.afterSent = expr.match(/sent_at\.gt\."([^"]+)"/)?.[1] ?? null
          return builder
        },
        limit: (n: number) => {
          if (table === 'story_items') pageSizes.push(n)
          state.limit = n
          return builder
        },
        range: (start: number, end: number) => {
          state.ranged = true
          state.start = start
          state.end = end
          return builder
        },
        insert: (body: Record<string, unknown>) => {
          inserts.push({ table, row: body })
          return {
            select: () => ({ single: async () => ({ data: { id: `action-${inserts.length}` }, error: null }) }),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          }
        },
        maybeSingle: async () => ({ data: table === 'clients' ? { facebook_page_id: PAGE } : null, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          if (table === 'flywheel_actions') {
            const data = registered.map((key) => ({ client_id: CLIENT, payload: { idempotency_key: key } }))
            const page = state.ranged && state.end !== null ? data.slice(state.start, state.end + 1) : data
            return Promise.resolve({ data: page, error: null }).then(resolve)
          }
          let eligible = state.since ? items.filter((item) => item.sent_at >= state.since!) : items.slice()
          eligible.sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.item_id.localeCompare(b.item_id))
          if (state.afterSent && state.afterId) {
            const afterSent = state.afterSent
            const afterId = state.afterId
            eligible = eligible.filter((item) => item.sent_at > afterSent || (item.sent_at === afterSent && item.item_id > afterId))
          }
          const page = state.limit !== null ? eligible.slice(0, state.limit) : eligible
          return Promise.resolve({ data: page, error: null }).then(resolve)
        },
      }
      return builder
    },
  }
  return { supabase: supabase as never, inserts, pageSizes, sawSince: () => sawSince }
}

describe('story publish reconcile', () => {
  it('is an event function, not a second publisher', () => {
    const fn = cloudFunctions.find((entry) => entry.id() === STORY_PUBLISH_ACTION_RECONCILE_ID)
    expect(fn).toBeTruthy()
    const trigger = (fn as unknown as { opts: { triggers?: { event?: string; cron?: string }[]; concurrency?: { limit?: number } } }).opts
    expect(trigger.triggers?.[0]?.event).toBe('social/story.publish_actions.reconcile_due')
    expect(trigger.triggers?.[0]?.cron).toBeUndefined()
    expect(trigger.concurrency?.limit).toBe(1)
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain('social/story.publish_actions.reconcile_due')
  })

  it('switch off: no query and no step, even if an event arrives', async () => {
    const store = storyDb([row(1)])
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionReconcile({ supabase: store.supabase, enabled: () => false, now: () => NOW })
    await expect(handlerOf(fn)({ step })).resolves.toEqual({ skipped: 'reconcile_disabled' })
    expect(step.run).not.toHaveBeenCalled()
    expect(store.inserts).toHaveLength(0)
  })

  it('T12b one run registers at most 50 missing stories', async () => {
    const items = Array.from({ length: 60 }, (_, index) => row(index))
    const listed = await listUnregisteredSentStories(storyDb(items).supabase, NOW)
    expect(listed).toHaveLength(50)

    const store = storyDb(items)
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionReconcile({ supabase: store.supabase, enabled: () => true, now: () => NOW })
    await expect(handlerOf(fn)({ step })).resolves.toMatchObject({ considered: 50, registered: 50, refused: 0 })
    expect(store.inserts.filter((row) => row.table === 'flywheel_actions')).toHaveLength(50)
    expect(store.pageSizes.every((width) => width === 50)).toBe(true)
    expect(store.pageSizes.length).toBeGreaterThan(0)
  })

  it('a gap after the first 1000 registered stories is still registered', async () => {
    const items = Array.from({ length: 1001 }, (_, index) => row(index))
    const registered = items.slice(0, 1000).map((item) => storyPublishIdempotencyKey(item.item_id))
    const listed = await listUnregisteredSentStories(storyDb(items, registered).supabase, NOW)
    expect(listed.map((item) => item.item_id)).toEqual([itemId(1000)])

    const store = storyDb(items, registered)
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionReconcile({ supabase: store.supabase, enabled: () => true, now: () => NOW })
    await expect(handlerOf(fn)({ step })).resolves.toMatchObject({ considered: 1, registered: 1, refused: 0 })
    const writes = store.inserts.filter((entry) => entry.table === 'flywheel_actions')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.row.payload).toMatchObject({ item_id: itemId(1000) })
  })

  it('already-registered rows do not crowd out a later missing story', async () => {
    const items = Array.from({ length: 51 }, (_, index) => row(index))
    const registered = items.slice(0, 50).map((item) => storyPublishIdempotencyKey(item.item_id))
    const listed = await listUnregisteredSentStories(storyDb(items, registered).supabase, NOW)
    expect(listed.map((item) => item.item_id)).toEqual([itemId(50)])
  })

  it('drops stories sent more than seven days ago', async () => {
    const old = row(1, '2026-10-01T00:00:00.000Z')
    const recent = row(2, '2026-11-01T00:00:00.000Z')
    const store = storyDb([old, recent])
    const listed = await listUnregisteredSentStories(store.supabase, NOW)
    expect(store.sawSince()).toBe(true)
    expect(listed.map((item) => item.item_id)).toEqual([itemId(2)])
  })

  it('a page that does not match the registered page is refused and not inserted', async () => {
    const mismatched = { ...row(1), account_id: '99999' }
    const store = storyDb([mismatched])
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) }
    const fn = createStoryPublishActionReconcile({ supabase: store.supabase, enabled: () => true, now: () => NOW })
    await expect(handlerOf(fn)({ step })).resolves.toMatchObject({ registered: 0, refused: 1 })
    expect(store.inserts.filter((entry) => entry.table === 'flywheel_actions')).toHaveLength(0)
    expect(store.inserts.filter((entry) => entry.table === 'cron_run_logs')).toHaveLength(1)
  })
})
