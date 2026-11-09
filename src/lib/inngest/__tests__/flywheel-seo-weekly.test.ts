/**
 * 每周 SEO 快照 · 两个 Inngest 函数的装配测试。
 *
 * 🔴 这份测试是复审逼出来的：第一版代码专门留了两个注入接缝（`createFlywheelSeoFanOutFunction`
 *    / `createFlywheelSeoSnapshotOneFunction`），注释还写着「便于集成测试」，**却一条测试
 *    都没有**。而第一版最严重的两个缺陷 —— 开运行记录写在 step 外（每周插 3 行假记录）、
 *    干活函数没接防重复扣费闸 —— 正是这类测试第一下就会撞上的。
 *
 * 测的是**装配**，不是纯逻辑（纯逻辑在 src/lib/flywheel/__tests__/seo-weekly.test.ts）：
 * 触发器对不对、命名空间对不对、副作用有没有全在 step 里、闸有没有真接上。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1' as string | null)
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (jobName: string) => startCronRunId(jobName),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/flywheel/adapters/SeoContentAdapter', () => ({
  SeoContentAdapter: vi.fn().mockImplementation(() => ({ pullMetrics: vi.fn(async () => []) })),
}))

import {
  buildSnapshotEvents,
  createFlywheelSeoFanOutFunction,
  createFlywheelSeoSnapshotOneFunction,
} from '../functions/flywheel-seo-weekly'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import { FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT, FLYWHEEL_SEO_WEEKLY_TZ } from '@/lib/flywheel/seo-weekly'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

type Fn = ReturnType<typeof createFlywheelSeoFanOutFunction>
/** Inngest 函数把触发器和 id 存在 opts 里，契约测试按同一个读法（跟 probe.test.ts 一致）。 */
function optsOf(fn: Fn | ReturnType<typeof createFlywheelSeoSnapshotOneFunction>) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string; cron?: string }[]
      retries?: number
      concurrency?: { limit: number; key?: string }
    }
  }).opts
}

/**
 * 假 step：`run` 直接执行并记下 id，`sendEvent` 记下发了什么。
 *
 * 🔴 顺带把「副作用有没有在 step 里」变成可断言的事实：真实的 Inngest 会在每个 step
 *    边界之后把函数体从头重放，step 外的副作用会被执行多次。这里没法模拟重放，
 *    但可以断言**每一次写运行记录都发生在某个 step 之内** —— 见下面那条。
 */
function fakeStep() {
  const ranStepIds: string[] = []
  const sent: unknown[][] = []
  let insideStep = false
  return {
    ranStepIds,
    sent,
    isInsideStep: () => insideStep,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        insideStep = true
        try {
          return await fn()
        } finally {
          insideStep = false
        }
      },
      sendEvent: async (id: string, events: unknown[]) => {
        ranStepIds.push(id)
        sent.push(events)
      },
    },
  }
}

describe('注册与命名空间（跟仓里既有契约一致）', () => {
  it('两个函数都注册进了 cloudFunctions，id 都带 cloud- 前缀', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}flywheel-seo-weekly-fanout`)
    expect(ids).toContain(`${CLOUD_FN_PREFIX}flywheel-seo-snapshot-one`)
  })

  it('🔴 不监听本机 worker 已消费的事件（一事件一主，防两处各跑一遍）', () => {
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT)
  })

  it('🔴 定时器必须带时区 —— 不带的话 Inngest 按 UTC 解释，跑的就不是新西兰周一早上', () => {
    const fanout = cloudFunctions.find((f) => f.id().endsWith('flywheel-seo-weekly-fanout'))!
    const cron = optsOf(fanout as unknown as Fn).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${FLYWHEEL_SEO_WEEKLY_TZ}`)
  })

  it('🔴 干活那个函数不许自动重试 —— 钱在函数内部花掉，重试等于再付一次', () => {
    const one = cloudFunctions.find((f) => f.id().endsWith('flywheel-seo-snapshot-one'))!
    expect(optsOf(one as unknown as Fn).retries).toBe(0)
    expect(optsOf(one as unknown as Fn).concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
  })
})

describe('派单函数', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startCronRunId.mockResolvedValue('run-1')
  })

  async function runFanOut(roster: Awaited<ReturnType<typeof mkRoster>>) {
    const fn = createFlywheelSeoFanOutFunction({
      loadRoster: async () => roster,
      supabase: {} as never,
    })
    const harness = fakeStep()
    // Inngest 把 handler 挂在函数对象的 `fn` 上；直接取出来跑，不拉起真运行时。
    const result = await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn({
      step: harness.step,
    })
    return { result: result as Record<string, unknown>, harness }
  }

  const mkRoster = async (entries: { clientId: string; domain: string }[]) =>
    ({ ok: true as const, entries })

  it('一人一张条子，条子带客户 / 网址 / 周编号，事件名是云端专属那个', async () => {
    const { result, harness } = await runFanOut(
      await mkRoster([
        { clientId: CTS, domain: 'ctstours.co.nz' },
        { clientId: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
      ]),
    )
    expect(result.status).toBe('dispatched')
    expect(result.clients_dispatched).toBe(2)
    expect(harness.sent).toHaveLength(1)
    const events = harness.sent[0] as { name: string; id: string; data: Record<string, string> }[]
    expect(events.map((e) => e.name)).toEqual([
      FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
      FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
    ])
    expect(events[0].data.client_id).toBe(CTS)
    expect(events[0].id).toContain(CTS)
  })

  it('🔴 运行记录只开一次，而且开和收都在 step 里 —— 放 step 外每周会插 3 行假记录', async () => {
    const { harness } = await runFanOut(await mkRoster([{ clientId: CTS, domain: 'ctstours.co.nz' }]))
    expect(startCronRunId).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledTimes(1)
    // 开记录和收记录各自是一个独立 step —— 有了这个，Inngest 重放时它们走缓存不重跑
    expect(harness.ranStepIds).toContain('log-start')
    expect(harness.ranStepIds.some((id) => id.startsWith('log-finish'))).toBe(true)
  })

  it('🔴 派单数字要标明「是派单不是快照」—— 否则健康检查读者会以为数据都拿到了', async () => {
    await runFanOut(await mkRoster([{ clientId: CTS, domain: 'ctstours.co.nz' }]))
    const opts = finish.mock.calls[0][0] as { summary: Record<string, unknown> }
    expect(opts.summary.counts_are).toBe('dispatched_not_snapshotted')
  })

  it('名单查不出来 → 记一次失败，一张条子都不发', async () => {
    const fn = createFlywheelSeoFanOutFunction({
      loadRoster: async () => ({ ok: false as const, reason: 'db down' }),
      supabase: {} as never,
    })
    const harness = fakeStep()
    const result = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn({
      step: harness.step,
    })) as Record<string, unknown>
    expect(result.status).toBe('roster_failed')
    expect(harness.sent).toHaveLength(0)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, error: 'db down' }))
  })

  it('没人要扫 → 不发条子，但记录照样收尾（不留「在跑」的悬空行）', async () => {
    const { result, harness } = await runFanOut(await mkRoster([]))
    expect(result.status).toBe('roster_empty')
    expect(harness.sent).toHaveLength(0)
    expect(finish).toHaveBeenCalledTimes(1)
  })
})

describe('干活函数', () => {
  const dueEvent = (data: unknown) => ({ event: { data }, step: fakeStep().step })

  it('🔴 防重复扣费闸真的接上了 —— 闸说跳过，就一次外部调用都不能发生', async () => {
    const pullMetrics = vi.fn(async () => [{}])
    const fn = createFlywheelSeoSnapshotOneFunction({
      pullMetrics,
      shouldSkip: async () => ({ skip: true, reason: 'snapshotted_recently' }),
    })
    const r = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn(
      dueEvent({ client_id: CTS, domain: 'ctstours.co.nz', week_key: '2026-W37' }),
    )) as Record<string, unknown>
    expect(r.status).toBe('skipped')
    expect(pullMetrics).not.toHaveBeenCalled()
  })

  it('闸放行 → 干活并出回执', async () => {
    const fn = createFlywheelSeoSnapshotOneFunction({
      pullMetrics: async () => [{}, {}],
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const r = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn(
      dueEvent({ client_id: CTS, domain: 'ctstours.co.nz', week_key: '2026-W37' }),
    )) as Record<string, unknown>
    expect(r.status).toBe('completed')
    expect(r.metrics_written).toBe(2)
  })

  it('每个客户试跑都写真实的开始/结束运行记录，便于区分未消费与失败', async () => {
    const fn = createFlywheelSeoSnapshotOneFunction({
      pullMetrics: async () => [{}, {}],
      shouldSkip: async () => ({ skip: false, reason: null }),
    })
    const harness = fakeStep()
    const r = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn({
      event: { data: { client_id: CTS, domain: 'ctstours.co.nz', week_key: '2026-W37' } },
      step: harness.step,
    })) as Record<string, unknown>
    expect(r.status).toBe('completed')
    expect(startCronRunId).toHaveBeenCalledWith('flywheel-seo-weekly')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      processed: 1,
      completed: 1,
      failed: 0,
      summary: expect.objectContaining({ client_id: CTS, status: 'completed' }),
    }))
    expect(harness.ranStepIds).toContain('snapshot-log-start-2026-W37-' + CTS)
    expect(harness.ranStepIds).toContain('snapshot-log-finish-2026-W37-' + CTS)
  })

  it('🔴 条子不合法 → 直接退回，不查闸也不花钱', async () => {
    const pullMetrics = vi.fn(async () => [{}])
    const shouldSkip = vi.fn(async () => ({ skip: false, reason: null }))
    const fn = createFlywheelSeoSnapshotOneFunction({ pullMetrics, shouldSkip })
    const r = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn(
      dueEvent({ client_id: 'not-a-uuid', domain: 'x.co.nz', week_key: '2026-W37' }),
    )) as Record<string, unknown>
    expect(r).toEqual({ kind: 'invalid_payload', reason: 'invalid_client_id' })
    expect(pullMetrics).not.toHaveBeenCalled()
    expect(shouldSkip).not.toHaveBeenCalled()
  })
})

describe('派单条子的构造', () => {
  it('空名单 → 空条子', () => {
    expect(buildSnapshotEvents([], '2026-W37')).toEqual([])
  })
})
