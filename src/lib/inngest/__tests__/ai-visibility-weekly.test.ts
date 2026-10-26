import { describe, it, expect } from 'vitest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  createAiVisibilityFanOutFunction,
  createAiVisibilityRunOneFunction,
  buildTrackerEvents,
} from '../functions/ai-visibility-weekly'
import { AI_VISIBILITY_TRACKER_DUE_EVENT, AI_VISIBILITY_WEEKLY_TZ, type TrackerRosterEntry, type TrackerRunOutcome } from '@/lib/ai-tracker/weekly-fanout'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

type Fn = ReturnType<typeof createAiVisibilityFanOutFunction>

// 这份读法(读 opts.triggers/opts.retries/opts.concurrency，以及直接调 fn.fn(...))跟
// src/lib/inngest/__tests__/competitor-watch-weekly.test.ts / flywheel-seo-weekly.test.ts
// 里的 optsOf()/fakeStep() 是同一套、已跑通验证过的做法：Inngest SDK 的 createFunction
// 返回值本来就在 opts 上带这些字段、在闭包上带 fn 方法，这里的类型断言只是把私有实现细节
// 亮出来给测试用，不是拿一个形状对不上的假件去顶替真实类型——同一个 Inngest 版本、同一个
// createFunction。
function optsOf(fn: Fn | ReturnType<typeof createAiVisibilityRunOneFunction>) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string; cron?: string }[]
      retries?: number
      concurrency?: { limit: number; key?: string }
    }
  }).opts
}

function fakeStep() {
  const ranStepIds: string[] = []
  const sent: unknown[][] = []
  return {
    ranStepIds,
    sent,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        return await fn()
      },
      sendEvent: async (id: string, events: unknown[]) => {
        ranStepIds.push(id)
        sent.push(events)
      },
    },
  }
}

describe('注册与命名空间', () => {
  it('两个函数都注册进了 cloudFunctions，id 都带 cloud- 前缀', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}ai-visibility-weekly-fanout`)
    expect(ids).toContain(`${CLOUD_FN_PREFIX}ai-visibility-tracker-run-one`)
  })

  it('🔴 事件名不许跟本机 factory-worker 撞车——一事件一主', () => {
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(AI_VISIBILITY_TRACKER_DUE_EVENT)
  })

  it('🔴 定时器必须带时区——不带的话 Inngest 按 UTC 解释，跑的就不是新西兰周一早上', () => {
    const fanout = cloudFunctions.find((f) => f.id().endsWith('ai-visibility-weekly-fanout'))!
    const cron = optsOf(fanout as unknown as Fn).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${AI_VISIBILITY_WEEKLY_TZ}`)
  })

  it('干活函数不重试、同客户并发限 1——重试等于重复付款', () => {
    const worker = cloudFunctions.find((f) => f.id().endsWith('ai-visibility-tracker-run-one'))!
    const opts = optsOf(worker as unknown as ReturnType<typeof createAiVisibilityRunOneFunction>)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toEqual({ limit: 1, key: 'event.data.client_id' })
  })
})

describe('buildTrackerEvents', () => {
  it('每个名单条目变成一个事件，事件名、client_id 都对得上', () => {
    const entries: TrackerRosterEntry[] = [{ clientId: CTS }]
    const events = buildTrackerEvents(entries, '2026-W38')
    expect(events).toEqual([
      { id: `ai-visibility-tracker-2026-W38-${CTS}`, name: AI_VISIBILITY_TRACKER_DUE_EVENT, data: { client_id: CTS, week_key: '2026-W38' } },
    ])
  })
})

describe('fan-out 函数行为（依赖注入版，不碰真数据库）——🔴 只发给开了灰度开关的客户', () => {
  it('名单查询失败 → 返回 roster_failed，不发任何事件', async () => {
    const fn = createAiVisibilityFanOutFunction({
      loadRoster: async () => ({ ok: false, reason: 'db down' }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_failed', clients_dispatched: 0, error: 'db down' })
    expect(harness.sent).toEqual([])
  })

  it('名单为空（没有客户开灰度开关）→ roster_empty，不发任何事件', async () => {
    const fn = createAiVisibilityFanOutFunction({
      loadRoster: async () => ({ ok: true, entries: [] }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_empty', clients_dispatched: 0 })
    expect(harness.sent).toEqual([])
  })

  it('🔴 roster 只含开了开关的那一个客户 → 只给这一个人发条子，不多不少', async () => {
    const fn = createAiVisibilityFanOutFunction({
      loadRoster: async () => ({ ok: true, entries: [{ clientId: CTS }] }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'dispatched', clients_dispatched: 1 })
    expect(harness.sent).toEqual([[{ id: expect.stringContaining(CTS), name: AI_VISIBILITY_TRACKER_DUE_EVENT, data: expect.objectContaining({ client_id: CTS }) }]])
  })

  it('roster 含两个客户 → 两个人各发一条，谁都不漏', async () => {
    const fn = createAiVisibilityFanOutFunction({
      loadRoster: async () => ({ ok: true, entries: [{ clientId: CTS }, { clientId: OZTOP }] }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'dispatched', clients_dispatched: 2 })
    const dispatchedIds = (harness.sent[0] as Array<{ data: { client_id: string } }>).map((e) => e.data.client_id)
    expect(dispatchedIds.sort()).toEqual([CTS, OZTOP].sort())
  })
})

describe('干活函数行为（依赖注入版）', () => {
  const okResult: TrackerRunOutcome = {
    runs_attempted: 2, runs_succeeded: 2, runs_failed: 0, client_brand_mentions: 1, total_cost_usd: 0.02, snapshot_id: 'snap-1',
    snapshot_skipped_reason: null,
  }

  it('非法条子 → invalid_payload，不调用 runTracker', async () => {
    const fn = createAiVisibilityRunOneFunction({
      runTracker: async () => okResult,
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: 'not-a-uuid' } },
      step: harness.step,
    })
    expect(result).toMatchObject({ kind: 'invalid_payload' })
  })

  it('合法条子 → 干活并写回执', async () => {
    const fn = createAiVisibilityRunOneFunction({
      runTracker: async () => okResult,
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, week_key: '2026-W38' } },
      step: harness.step,
    })
    expect(result).toMatchObject({ status: 'completed', client_id: CTS, week_key: '2026-W38', snapshot_id: 'snap-1' })
  })

  it('🔴 一个客户的 runTracker 抛异常，不影响另一个客户各自跑各自的（每单独立调用干活函数）', async () => {
    const fnFailing = createAiVisibilityRunOneFunction({
      runTracker: async () => { throw new Error('provider down') },
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const fnOk = createAiVisibilityRunOneFunction({
      runTracker: async () => okResult,
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harnessA = fakeStep()
    const harnessB = fakeStep()
    const [resultA, resultB] = await Promise.all([
      (fnFailing as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
        event: { data: { client_id: CTS, week_key: '2026-W38' } },
        step: harnessA.step,
      }),
      (fnOk as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
        event: { data: { client_id: OZTOP, week_key: '2026-W38' } },
        step: harnessB.step,
      }),
    ])
    expect(resultA).toMatchObject({ status: 'failed', client_id: CTS, error: 'provider down' })
    expect(resultB).toMatchObject({ status: 'completed', client_id: OZTOP, snapshot_id: 'snap-1' })
  })

  it('🔴 每个客户的回执都单独落一行 cron_run_logs（干活函数每次调用都跑了开跑/收尾两个 step）', async () => {
    const fn = createAiVisibilityRunOneFunction({
      runTracker: async () => okResult,
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, week_key: '2026-W38' } },
      step: harness.step,
    })
    expect(harness.ranStepIds).toContain(`tracker-log-start-2026-W38-${CTS}`)
    expect(harness.ranStepIds).toContain(`tracker-log-finish-2026-W38-${CTS}`)
  })

  it('防重复扣费闸拦下 → skipped 回执，不调用 runTracker', async () => {
    let called = false
    const fn = createAiVisibilityRunOneFunction({
      runTracker: async () => { called = true; return okResult },
      shouldSkip: async () => ({ skip: true, reason: 'tracked_recently' }),
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, week_key: '2026-W38' } },
      step: harness.step,
    })
    expect(called).toBe(false)
    expect(result).toMatchObject({ status: 'skipped' })
  })
})
