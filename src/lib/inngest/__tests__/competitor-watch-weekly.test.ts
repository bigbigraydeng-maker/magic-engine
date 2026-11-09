import { describe, it, expect } from 'vitest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  createCompetitorWatchFanOutFunction,
  createCompetitorWatchRunOneFunction,
  buildWatchEvents,
} from '../functions/competitor-watch-weekly'
import { COMPETITOR_WATCH_DUE_EVENT, COMPETITOR_WATCH_TZ, type WatchRosterEntry } from '@/lib/competitors/watch'

const CTS = 'c0000000-0000-0000-0000-000000000000'

type Fn = ReturnType<typeof createCompetitorWatchFanOutFunction>

// 这份读法(读 opts.triggers/opts.retries/opts.concurrency，以及直接调 fn.fn(...))
// 跟 src/lib/inngest/__tests__/flywheel-seo-weekly.test.ts 里的 optsOf()/fakeStep() 是
// 同一套、已跑通验证过的做法：Inngest SDK 的 createFunction 返回值本来就在 opts 上带这些
// 字段、在闭包上带 fn 方法，这里的类型断言只是把私有实现细节亮出来给测试用，不是拿一个
// 形状对不上的假件去顶替真实类型——两个文件用的是同一个 Inngest 版本、同一个 createFunction。

/** 同 flywheel-seo-weekly.test.ts 的读法：Inngest 函数把触发器和 id 存在 opts 里。 */
function optsOf(fn: Fn | ReturnType<typeof createCompetitorWatchRunOneFunction>) {
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
    expect(ids).toContain(`${CLOUD_FN_PREFIX}competitor-watch-weekly-fanout`)
    expect(ids).toContain(`${CLOUD_FN_PREFIX}competitor-watch-run-one`)
  })

  it('🔴 事件名不许跟本机 factory-worker 撞车——一事件一主', () => {
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(COMPETITOR_WATCH_DUE_EVENT)
  })

  it('🔴 定时器必须带时区——不带的话 Inngest 按 UTC 解释，跑的就不是新西兰周一早上', () => {
    const fanout = cloudFunctions.find((f) => f.id().endsWith('competitor-watch-weekly-fanout'))!
    const cron = optsOf(fanout as unknown as Fn).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${COMPETITOR_WATCH_TZ}`)
  })

  it('干活函数不重试、同客户并发限 1——重试等于重复付款', () => {
    const worker = cloudFunctions.find((f) => f.id().endsWith('competitor-watch-run-one'))!
    const opts = optsOf(worker as unknown as ReturnType<typeof createCompetitorWatchRunOneFunction>)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toEqual({ limit: 1, key: 'event.data.client_id' })
  })
})

describe('buildWatchEvents', () => {
  it('每个名单条目变成一个事件，事件名、client_id、semrush_db 都对得上', () => {
    const entries: WatchRosterEntry[] = [{ clientId: CTS, semrushDb: 'nz' }]
    const events = buildWatchEvents(entries, '2026-W38')
    expect(events).toEqual([
      { id: `competitor-watch-2026-W38-${CTS}`, name: COMPETITOR_WATCH_DUE_EVENT, data: { client_id: CTS, week_key: '2026-W38', semrush_db: 'nz' } },
    ])
  })

  it('🔴 roster 里 semrushDb 是 null 时，事件里也是 null——不许在派单这一步悄悄补成 au', () => {
    const entries: WatchRosterEntry[] = [{ clientId: CTS, semrushDb: null }]
    const events = buildWatchEvents(entries, '2026-W38')
    expect(events[0].data.semrush_db).toBeNull()
  })
})

describe('fan-out 函数行为（依赖注入版，不碰真数据库）', () => {
  it('名单查询失败 → 返回 roster_failed，不发任何事件', async () => {
    const fn = createCompetitorWatchFanOutFunction({
      loadRoster: async () => ({ ok: false, reason: 'db down' }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_failed', clients_dispatched: 0, error: 'db down' })
    expect(harness.sent).toEqual([])
  })

  it('名单为空 → roster_empty，不发任何事件', async () => {
    const fn = createCompetitorWatchFanOutFunction({
      loadRoster: async () => ({ ok: true, entries: [] }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_empty', clients_dispatched: 0 })
    expect(harness.sent).toEqual([])
  })

  it('名单非空 → 每人发一个事件，状态 dispatched', async () => {
    const fn = createCompetitorWatchFanOutFunction({
      loadRoster: async () => ({ ok: true, entries: [{ clientId: CTS, semrushDb: 'nz' }] }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'dispatched', clients_dispatched: 1 })
    expect(harness.sent).toEqual([[{ id: expect.stringContaining(CTS), name: COMPETITOR_WATCH_DUE_EVENT, data: expect.objectContaining({ client_id: CTS }) }]])
  })
})

describe('干活函数行为（依赖注入版）', () => {
  it('非法条子 → invalid_payload，不调用 takeSnapshot', async () => {
    const fn = createCompetitorWatchRunOneFunction({
      takeSnapshot: async () => ({ domainsScanned: 0, keywordsWritten: 0 }),
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
    const fn = createCompetitorWatchRunOneFunction({
      takeSnapshot: async () => ({ domainsScanned: 19, keywordsWritten: 42 }),
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    // 同上方 optsOf() 注释说明的已跑通做法：直接读 Inngest createFunction 返回值的私有 .fn 字段。
    const result = await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, week_key: '2026-W38', semrush_db: 'nz' } },
      step: harness.step,
    })
    expect(result).toMatchObject({ status: 'completed', domains_scanned: 19, keywords_written: 42 })
  })

  it('🔴 事件负载里的 semrush_db 原样传给 takeSnapshot——不许在这一层又丢掉', async () => {
    const seen: Array<string | null> = []
    const fn = createCompetitorWatchRunOneFunction({
      takeSnapshot: async (_clientId, semrushDb) => {
        seen.push(semrushDb)
        return { domainsScanned: 1, keywordsWritten: 1 }
      },
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    // 同上方 optsOf() 注释说明的已跑通做法：直接读 Inngest createFunction 返回值的私有 .fn 字段。
    await (fn as unknown as { fn: (a: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, week_key: '2026-W38', semrush_db: 'nz' } },
      step: harness.step,
    })
    expect(seen).toEqual(['nz'])
  })
})
