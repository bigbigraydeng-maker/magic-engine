/**
 * T16 — two traffic rows, and silent DRAFT / time refusals become an outcome row
 * only when SOCIAL_READBACK_OUTCOME_ENABLED is exactly 'true'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

type Handler = (ctx: { event: { data: unknown }; step: ReturnType<typeof steps> }) => Promise<unknown>
const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../../client', () => ({
  CLOUD_FN_PREFIX: 'cloud-',
  inngest: {
    createFunction: (_config: unknown, _trigger: unknown, handler: Handler) => ({ handler }),
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: mocks.send }))

import { createFactoryReelMeasurementAdapter, rebindFactoryReelAction } from '../factory-reel-measurement-adapter'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const WORK = 'bbbbbbbb-1111-4111-8111-eeeeeeeeeeee'
const PAGE = '11111'
const VIDEO = '22222'
const PUBLISHED_AT = '2026-09-01T00:00:00.000Z'

function published(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    request_id: 'cccccccc-1111-4111-8111-eeeeeeeeeeee',
    work_order_id: WORK,
    client_id: CLIENT,
    platform: 'facebook',
    page_id: PAGE,
    video_id: VIDEO,
    post_id: VIDEO,
    media_type: 'reel',
    published_at: PUBLISHED_AT,
    created_at: PUBLISHED_AT,
    status: 'PUBLISHED',
    no_publish: false,
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    ...over,
  }
}

function traffic(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT,
    payload: {
      platform: 'facebook',
      work_order_id: WORK,
      page_id: PAGE,
      post_id: VIDEO,
      video_id: VIDEO,
      published_at: PUBLISHED_AT,
      video_state: 'PUBLISHED',
      ...over,
    },
  }
}

function steps() {
  const cache = new Map<string, unknown>()
  return {
    run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
      if (cache.has(id)) return cache.get(id)
      const value = await fn()
      cache.set(id, value)
      return value
    }),
  }
}

function database(opts: {
  traffic: Array<{ client_id: string; payload: Record<string, unknown> }>
  pageId?: string | null
  single?: { client_id: string; payload: Record<string, unknown> } | null
}) {
  const inserts: Record<string, unknown>[] = []
  const eqs: Array<[string, unknown]> = []
  const from = (table: string) => {
    if (table === 'cron_run_logs') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
    }
    if (table === 'clients') {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({
        data: opts.pageId ? { facebook_page_id: opts.pageId } : null,
        error: null,
      })
      return chain
    }
    if (table !== 'flywheel_actions') throw new Error(`unexpected table ${table}`)
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, val: unknown) => { eqs.push([col, val]); return chain }
    chain.limit = async () => ({ data: opts.traffic, error: null })
    chain.maybeSingle = async () => {
      if (opts.traffic.length > 1 && opts.single === undefined) {
        return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } }
      }
      return { data: opts.single === undefined ? opts.traffic[0] ?? null : opts.single, error: null }
    }
    chain.insert = () => ({
      select: () => ({ single: async () => ({ data: { id: 'action-1' }, error: null }) }),
    })
    return chain
  }
  return { db: { from } as unknown as SupabaseClient, inserts, eqs }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('rebindFactoryReelAction when the switch is on — T16', () => {
  const claim = {
    clientId: CLIENT,
    workOrderId: WORK,
    pageId: PAGE,
    videoId: VIDEO,
    publishedAt: PUBLISHED_AT,
  }

  it('two traffic rows return multiple_traffic_rows and do not throw', async () => {
    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'true')
    const db = database({ traffic: [traffic(), traffic()] })
    await expect(rebindFactoryReelAction(db.db, claim)).resolves.toEqual({
      ok: false,
      reason: 'multiple_traffic_rows',
    })
    expect(db.eqs).toContainEqual(['client_id', CLIENT])
  })

  it('one published row still rebinds', async () => {
    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'true')
    const db = database({ traffic: [traffic({ permalink: 'https://example.test/reel' })] })
    await expect(rebindFactoryReelAction(db.db, claim)).resolves.toEqual({
      ok: true,
      permalink: 'https://example.test/reel',
    })
  })
})

describe('adapter refusal outcome', () => {
  function handler(db: ReturnType<typeof database>) {
    return createFactoryReelMeasurementAdapter({ supabase: db.db }) as unknown as { handler: Handler }
  }

  it('DRAFT and time mismatch write one outcome row when the switch is exactly true', async () => {
    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'true')
    const draft = database({ traffic: [traffic({ video_state: 'DRAFT' })], pageId: PAGE })
    const draftResult = await handler(draft).handler({ event: { data: published() }, step: steps() })
    expect(draftResult).toMatchObject({ ok: false, reason: 'not_published' })
    expect(draft.inserts).toHaveLength(1)
    expect(draft.inserts[0]).toMatchObject({
      job_name: 'social-readback-outcome',
      status: 'failed',
      summary: {
        outcome: 'reel_rebind_refused:not_published',
        reason: 'not_published',
        subject_kind: 'reel',
        subject_ref: `${PAGE}_${VIDEO}`,
        client_id: CLIENT,
      },
    })
    expect(JSON.stringify(draft.inserts[0])).not.toMatch(/campaign_id|plan_id/)
    expect(mocks.send).not.toHaveBeenCalled()

    const mismatch = database({
      traffic: [traffic({ published_at: '2026-09-02T00:00:00.000Z' })],
      pageId: PAGE,
    })
    const mismatchResult = await handler(mismatch).handler({ event: { data: published() }, step: steps() })
    expect(mismatchResult).toMatchObject({ ok: false, reason: 'published_at_mismatch' })
    expect(mismatch.inserts[0]).toMatchObject({
      summary: { outcome: 'reel_rebind_refused:published_at_mismatch' },
    })
  })

  it('two traffic rows write one outcome and a replay does not insert a second row', async () => {
    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'true')
    const db = database({ traffic: [traffic(), traffic({ video_state: 'DRAFT' })], pageId: PAGE })
    const fn = handler(db)
    const step = steps()
    const ctx = { event: { data: published() }, step }
    await expect(fn.handler(ctx)).resolves.toMatchObject({ ok: false, reason: 'multiple_traffic_rows' })
    await fn.handler(ctx)
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]).toMatchObject({
      summary: { outcome: 'reel_rebind_refused:multiple_traffic_rows' },
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('the switch default and near-misses leave the refusal silent', async () => {
    const db = database({ traffic: [traffic({ video_state: 'DRAFT' })], pageId: PAGE, single: traffic({ video_state: 'DRAFT' }) })
    const result = await handler(db).handler({ event: { data: published() }, step: steps() })
    expect(result).toMatchObject({ ok: false, reason: 'not_published' })
    expect(db.inserts).toHaveLength(0)

    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'TRUE')
    const loud = database({ traffic: [traffic({ video_state: 'DRAFT' })], pageId: PAGE })
    await handler(loud).handler({ event: { data: published() }, step: steps() })
    expect(loud.inserts).toHaveLength(0)
  })

  it('an unknown registered page writes client_page_unknown when the switch is on', async () => {
    vi.stubEnv('SOCIAL_READBACK_OUTCOME_ENABLED', 'true')
    const db = database({ traffic: [], pageId: null })
    const result = await handler(db).handler({ event: { data: published() }, step: steps() })
    expect(result).toMatchObject({ ok: false, reason: 'client_page_unknown' })
    expect(db.inserts[0]).toMatchObject({
      summary: { outcome: 'reel_rebind_refused:client_page_unknown' },
    })
  })
})
