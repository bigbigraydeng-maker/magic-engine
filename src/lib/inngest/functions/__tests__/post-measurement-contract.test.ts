// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { SupabaseClient } from '@supabase/supabase-js'

type Context = { event: { data: unknown }; step: ReturnType<typeof steps> }
type Harness = { handler: (ctx: Context) => Promise<unknown>; config: {
  retries?: number; onFailure: (ctx: { event: { data: unknown } }) => Promise<void>
} }
const mocks = vi.hoisted(() => ({ token: vi.fn(), send: vi.fn() }))
vi.mock('../../client', () => ({ CLOUD_FN_PREFIX: 'cloud-', inngest: {
  createFunction: (config: Harness['config'], _trigger: unknown, handler: Harness['handler']) => ({ config, handler }),
} }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/token-manager', () => ({ getStoredPageToken: mocks.token }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: mocks.send }))

import { createMeasureFunction, MeasureDueSchema } from '../daily-plan-post-measurement'
import { createFactoryReelMeasurementAdapter, reelMeasureAt, REEL_MEASURE_WINDOWS } from '../factory-reel-measurement-adapter'
import {
  PUBLISH_MEASUREMENT_OFFSETS_HOURS,
  PUBLISH_MEASUREMENT_WINDOW_SET,
} from '@/lib/campaign/daily-plan-publish'
import { pickReceipt, type ReceiptRow } from '@/lib/social/post-performance'

const client = 'aaaaaaaa-1111-4111-8111-111111111111'
const work = 'bbbbbbbb-1111-4111-8111-111111111111'
const page = '11111111111'
const video = '22222222222'
const publishedAt = '2026-09-01T00:00:00.000Z'
const key = `factory-reel:${work}:${video}`
const schedule = reelMeasureAt(publishedAt)
const due = (hours = 4) => ({ client_id: client, action_id: 'action-1', idempotency_key: key,
  page_id: page, post_id: `${page}_${video}`, window_hours: hours,
  target_at: schedule.find(w => w.hours === hours)?.at ?? schedule[0].at })
const action = () => ({ client_id: client, action_type: 'social.publish_post', payload: {
  source: 'factory_reel', post_id: `${page}_${video}`, page_id: page,
  idempotency_key: key, published_at: publishedAt, measure_at: schedule,
} })
const published = () => ({ schema_version: 1, request_id: work, work_order_id: work,
  client_id: client, platform: 'facebook', page_id: page, video_id: video, post_id: video,
  media_type: 'reel', published_at: publishedAt, created_at: publishedAt,
  status: 'PUBLISHED', no_publish: false, authorization: 'AUTHORIZED', cost_usd: 0 })

// Exercise real handlers/store/Graph parser, never a real service. Any charge-table/RPC use fails.
function database(row: unknown = action()) {
  const writes: unknown[] = []
  const rpc = vi.fn(async (name: string, args: unknown) => {
    expect(name).toBe('record_post_measurement_snapshot')
    writes.push(args)
    return { data: [{ outcome: 'written' }], error: null }
  })
  const from = vi.fn((table: string) => {
    expect(['flywheel_actions', 'clients']).toContain(table)
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: table === 'clients' ? { facebook_page_id: page } : row, error: null }),
      insert: (data: unknown) => { writes.push(data); return chain },
      single: async () => ({ data: { id: 'action-1' }, error: null }),
    }
    return chain
  })
  return { db: { from, rpc } as unknown as SupabaseClient, writes, rpc, from }
}
function steps() {
  const cache = new Map<string, unknown>()
  return {
    sleepUntil: vi.fn(async () => undefined),
    run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
      if (cache.has(id)) return cache.get(id)
      const value = await fn()
      cache.set(id, value)
      return value
    }),
  }
}
function measurement(row: unknown = action(), body: unknown = { reactions: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } }) {
  const db = database(row)
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body)))
  const fn = createMeasureFunction({ supabase: db.db, fetcher }) as unknown as Harness
  return { ...db, fetcher, fn, step: steps() }
}
beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue('synthetic-token'); mocks.send.mockResolvedValue({ event_ids: ['event-1'] }) })

const canonicalMeasurementWindows = (): Set<number> =>
  new Set<number>(PUBLISH_MEASUREMENT_OFFSETS_HOURS)

function contractReceipt(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    action_id: 'a1',
    window_hours: 4,
    status: 'ok',
    measured_at: '2024-01-01T00:00:00Z',
    values: {},
    missing: {},
    reason: null,
    ...over,
  }
}

describe('T15 measurement window set contract (W1/W3/W4/W5/W6)', () => {
  it('W1/W6 exported set matches canonical [4, 72]', () => {
    expect(PUBLISH_MEASUREMENT_WINDOW_SET).toEqual(canonicalMeasurementWindows())
  })

  it('W5 REEL_MEASURE_WINDOWS matches W1', () => {
    expect(new Set<number>(REEL_MEASURE_WINDOWS)).toEqual(canonicalMeasurementWindows())
  })

  it('W3 MeasureDueSchema only accepts W1 windows', () => {
    for (const hours of PUBLISH_MEASUREMENT_OFFSETS_HOURS) {
      expect(MeasureDueSchema.safeParse({ ...due(), window_hours: hours }).success).toBe(true)
    }
    expect(MeasureDueSchema.safeParse({ ...due(), window_hours: 48 }).success).toBe(false)
    // Mutation: if W3 allowed 48, this assertion would fail while W1 still says [4, 72].
  })

  it('W4 hasFixedMeasurementWindows rejects a [4, 48] schedule (must stay [4, 72])', async () => {
    const anchor = publishedAt
    const badWindows = [
      { hours: 4, at: new Date(Date.parse(anchor) + 4 * 3600_000).toISOString() },
      { hours: 48, at: new Date(Date.parse(anchor) + 48 * 3600_000).toISOString() },
    ]
    const row = action()
    row.payload.measure_at = badWindows as typeof schedule
    const t = measurement(row)
    await expect(t.fn.handler({ event: { data: due() }, step: t.step })).resolves.toMatchObject({
      reason: 'measurement_window_mismatch',
    })
  })

  it('W6 pickReceipt uses W1 whitelist (72 beats 168; 4-only; 168-only → null)', () => {
    const ok72 = contractReceipt({ window_hours: 72, status: 'ok' })
    const ok168 = contractReceipt({ window_hours: 168, status: 'ok' })
    expect(pickReceipt([ok72, ok168])).toBe(ok72)
    const ok4 = contractReceipt({ window_hours: 4, status: 'ok' })
    expect(pickReceipt([ok4])).toBe(ok4)
    expect(pickReceipt([ok168])).toBeNull()
  })
})

describe('non-billable fixed measurement contract', () => {
  it.each([0, 1, 24, 48, 73, 4.5])('rejects window %s before token/Graph/storage', async hours => {
    const t = measurement()
    expect(await t.fn.handler({ event: { data: due(hours) }, step: t.step })).toMatchObject({ ok: false })
    expect(t.from).not.toHaveBeenCalled(); expect(t.fetcher).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled(); expect(t.rpc).not.toHaveBeenCalled()
  })
  it('accepts legacy omission and explicit non_billable, never billable', () => {
    expect(MeasureDueSchema.safeParse(due()).success).toBe(true)
    expect(MeasureDueSchema.safeParse({ ...due(), billing_mode: 'non_billable' }).success).toBe(true)
    expect(MeasureDueSchema.safeParse({ ...due(), billing_mode: 'billable' }).success).toBe(false)
  })
  it.each([4, 72])('runs window %s without any billing/usage write; same-run retry reuses Graph read', async hours => {
    const t = measurement()
    const ctx = { event: { data: due(hours) }, step: t.step }
    expect(await t.fn.handler(ctx)).toMatchObject({ ok: true, status: 'partial' })
    await t.fn.handler(ctx)
    expect(t.fetcher).toHaveBeenCalledTimes(1); expect(t.rpc).toHaveBeenCalledTimes(1)
    expect(t.fetcher.mock.calls[0]).toHaveLength(1) // existing Graph GET, no publish operation
    expect(t.writes).toHaveLength(1)
    expect(t.writes[0]).toMatchObject({ p_window_hours: hours, p_values: { likes: 1, comments: 0 } })
    expect(t.fn.config.retries).toBe(3) // bounded retries, not a recurring poller
  })
  it.each(['factory_reel_publish', 'ads.launch', null])('rejects non-measurement action type %s', async action_type => {
    const t = measurement({ ...action(), action_type })
    expect(await t.fn.handler({ event: { data: due() }, step: t.step })).toMatchObject({ reason: 'invalid_publish_action' })
    expect(t.step.sleepUntil).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled(); expect(t.fetcher).not.toHaveBeenCalled(); expect(t.rpc).not.toHaveBeenCalled()
    await t.fn.config.onFailure({ event: { data: { event: { data: due() } } } })
    expect(t.rpc).not.toHaveBeenCalled()
  })
  it.each([
    [schedule[0]], [schedule[0], schedule[0]], [...schedule, { hours: 24, at: schedule[0].at }],
    [schedule[0], { hours: 72, at: schedule[0].at }],
  ])('rejects an altered stored window list: %j', async (...windows) => {
    const row = action(); row.payload.measure_at = windows as typeof schedule
    const t = measurement(row)
    expect(await t.fn.handler({ event: { data: due() }, step: t.step })).toMatchObject({ reason: 'measurement_window_mismatch' })
    expect(mocks.token).not.toHaveBeenCalled(); expect(t.rpc).not.toHaveBeenCalled()
  })
  it('rejects a forged target, including in onFailure', async () => {
    const t = measurement(); const data = { ...due(), target_at: publishedAt }
    expect(await t.fn.handler({ event: { data }, step: t.step })).toMatchObject({ reason: 'measurement_window_mismatch' })
    await t.fn.config.onFailure({ event: { data: { event: { data } } } })
    expect(t.step.sleepUntil).not.toHaveBeenCalled(); expect(t.fetcher).not.toHaveBeenCalled(); expect(t.rpc).not.toHaveBeenCalled()
  })
  it('preserves scheduled Daily Plan anchors and equivalent ISO formatting', async () => {
    const row = action()
    const scheduled = '2026-09-02T00:00:00.000Z'
    const t = measurement({ ...row, payload: { ...row.payload, source: 'daily_plan', scheduled_publish_time: scheduled, measure_at: reelMeasureAt(scheduled) } })
    expect(await t.fn.handler({ event: { data: { ...due(), target_at: '2026-09-02T04:00:00Z' } }, step: t.step })).toMatchObject({ ok: true })
  })
  it('no token/permanent/transient failure paths only write existing measurement receipts', async () => {
    mocks.token.mockResolvedValueOnce(null)
    const noToken = measurement()
    expect(await noToken.fn.handler({ event: { data: due() }, step: noToken.step })).toMatchObject({ reason: 'token_unavailable' })
    expect(noToken.fetcher).not.toHaveBeenCalled()
    const permanent = measurement(action(), { error: { code: 200 } })
    expect(await permanent.fn.handler({ event: { data: due() }, step: permanent.step })).toMatchObject({ reason: 'permission_denied' })
    const transient = measurement(action(), { error: { code: 4 } })
    await expect(transient.fn.handler({ event: { data: due() }, step: transient.step })).rejects.toThrow('transient:')
    await transient.fn.config.onFailure({ event: { data: { event: { data: due() } } } })
    expect(transient.writes[0]).toMatchObject({ p_reason: 'retries_exhausted' })
  })
})

describe('Reel fan-out trusts the stored publication, not the event assertion', () => {
  const factoryRow = (video_state: unknown = 'PUBLISHED') => ({ client_id: client, payload: {
    platform: 'facebook', work_order_id: work, page_id: page, post_id: video, video_id: video,
    published_at: publishedAt, video_state,
  } })
  it.each(['DRAFT', undefined, 'UNKNOWN'])('stored state %s cannot create measurement work', async state => {
    const db = database(factoryRow(state === undefined ? null : state))
    const fn = createFactoryReelMeasurementAdapter({ supabase: db.db }) as unknown as Harness
    expect(await fn.handler({ event: { data: published() }, step: steps() })).toMatchObject({ reason: 'not_published' })
    expect(db.writes).toHaveLength(0); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('emits exactly two stable window identities; replay cannot mint a new schedule', async () => {
    const db = database(factoryRow())
    const fn = createFactoryReelMeasurementAdapter({ supabase: db.db }) as unknown as Harness
    const ctx = { event: { data: published() }, step: steps() }
    await fn.handler(ctx); await fn.handler(ctx)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls.map(([e]) => [e.id, e.data.window_hours, e.data.target_at])).toEqual(
      schedule.map(w => [`${key}:measurement:${w.hours}`, w.hours, w.at]),
    )
    expect(db.writes).toHaveLength(1)
  })
})

it('non-billable measurement modules cannot acquire a charging/provider wrapper dependency', () => {
  const allowed = new Set(['zod', 'node:crypto', '@supabase/supabase-js', '../client',
    '@/lib/supabase', '@/lib/workflows/inngest-event', '@/lib/campaign/daily-plan-publish',
    '@/lib/meta/token-manager', '@/lib/meta/post-engagement', '@/lib/social/post-measurement-store',
    '@/lib/factory/publish/reel-published-event', './daily-plan-post-measurement',
    // Outcome rows only. No Graph, billing, or publish call.
    '@/lib/social/readback-outcome-record',
    // 9-23 统一 Graph 版本常量时引入：meta/graph-base.ts 只有 Graph 基础地址常量和分页读取工具，自己没有任何 import
    //（下面把它也加进被检查文件，保证它将来不会悄悄引入计费/provider 包装依赖），不属于「计费或 provider 包装」。
    './graph-base'])
  for (const file of ['inngest/functions/daily-plan-post-measurement.ts',
    'inngest/functions/factory-reel-measurement-adapter.ts', 'social/post-measurement-store.ts', 'meta/post-engagement.ts',
    'meta/graph-base.ts']) {
    const source = ts.createSourceFile(file, readFileSync(resolve('src/lib', file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          expect(allowed.has(node.moduleSpecifier.text), `${file}: unexpected runtime dependency ${node.moduleSpecifier.text}`).toBe(true)
        }
      }
      if (ts.isCallExpression(node)) {
        expect(node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require', `${file}: dynamic dependency bypass`).toBe(false)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
})
