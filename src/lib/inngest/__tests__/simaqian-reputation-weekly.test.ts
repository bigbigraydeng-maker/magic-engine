import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import {
  createSimaqianReputationWeeklyFunction,
  SIMAQIAN_CRON,
  SIMAQIAN_TZ,
  type SimaqianRoster,
} from '../functions/simaqian-reputation-weekly'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (j: string) => startCronRunId(j),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat: vi.fn(), MODEL_HAIKU: 'haiku-test' }))

// 🔴 finish 是模块级 mock，不清的话「roster 失败」那条留下的第一次调用（没有 summary）
//    会被后面的用例当成自己的第一次调用读——第一版就红在这里（夹具错，代码对）。
beforeEach(() => {
  finish.mockClear()
  startCronRunId.mockClear()
})

const CTS = '00000000-0000-4000-8000-000000000001'

type Fn = ReturnType<typeof createSimaqianReputationWeeklyFunction>

/** 同 competitor-watch-weekly.test.ts 的读法：Inngest 函数把触发器和 id 存在 opts 里。 */
function optsOf(fn: Fn) {
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
  return {
    ranStepIds,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        return await fn()
      },
      sendEvent: async (id: string, _events: unknown[]) => {
        ranStepIds.push(id)
      },
    },
  }
}

/** 一个可链式调用、可 await 的假查询：select/eq/order/limit 返回自身，then 解析 { data, error }。 */
function fakeQuery(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return chain
}

/** 按表名分发的假 SupabaseClient；每张表可注入 error。 */
function fakeSupabase(tables: {
  clients?: { data: unknown; error?: { message: string } | null }
  review_items?: { data: unknown; error?: { message: string } | null }
}): SupabaseClient {
  const client = {
    from: (table: string) => {
      const spec = tables[table as keyof typeof tables]
      if (!spec) return fakeQuery({ data: [], error: null })
      return fakeQuery({ data: spec.data, error: spec.error ?? null })
    },
  }
  return client as unknown as SupabaseClient
}

function fakeLlm() {
  return vi.fn(async () => ({
    text: 'Thanks Sam, we appreciate it.',
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0.002,
    stop_reason: 'end_turn',
  }))
}

const roster: SimaqianRoster[] = [{ id: CTS, name: 'CTS Coffee' }]

const twoReviews = [
  { review_uid: 'r1', author: 'Sam', rating: 5, text: 'Great coffee and lovely staff, will be back soon for sure.', review_date: '2026-09-20' },
  { review_uid: 'r2', author: 'Alex', rating: 2, text: 'Waited a long time for a flat white this morning.', review_date: '2026-09-19' },
]

describe('注册与命名空间', () => {
  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}simaqian-reputation-weekly`)
  })

  it('定时器带时区、周四 09:00，retries 0，并发限 1', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('simaqian-reputation-weekly'))!
    const opts = optsOf(fn as unknown as Fn)
    expect(opts.triggers?.[0]?.cron).toBe(`TZ=${SIMAQIAN_TZ} ${SIMAQIAN_CRON}`)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toEqual({ limit: 1 })
  })

  it('🔴 定时器落在周四——不是周五(5)也不是周六(6)', () => {
    const dow = SIMAQIAN_CRON.split(' ')[4]
    expect(dow).toBe('4')
    expect(dow).not.toBe('5')
    expect(dow).not.toBe('6')
  })
})

describe('周巡行为（依赖注入版，不碰真数据库）', () => {
  it('名单读失败 → roster_failed，finish 记 failed 1，llm 不调用', async () => {
    const llm = fakeLlm()
    const fn = createSimaqianReputationWeeklyFunction({
      supabase: fakeSupabase({ clients: { data: null, error: { message: 'db down' } } }),
      llm,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_failed', clients: [], error: 'db down' })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, error: 'db down' }))
    expect(llm).not.toHaveBeenCalled()
  })

  it('名单为空 → roster_empty，finish processed 0', async () => {
    const llm = fakeLlm()
    const fn = createSimaqianReputationWeeklyFunction({
      supabase: fakeSupabase({ clients: { data: [] } }),
      llm,
    })
    const harness = fakeStep()
    const result = await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(result).toMatchObject({ status: 'roster_empty', clients: [] })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 0 }))
    expect(llm).not.toHaveBeenCalled()
  })

  it('一个客户两条新评价 → completed，起草成功，finish summary 带 no_publish 与 clients', async () => {
    const llm = fakeLlm()
    const fn = createSimaqianReputationWeeklyFunction({
      supabase: fakeSupabase({ clients: { data: roster }, review_items: { data: twoReviews } }),
      llm,
    })
    const harness = fakeStep()
    const result = (await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })) as {
      status: string
      clients: { status: string }[]
    }
    expect(result.status).toBe('completed')
    expect(result.clients).toHaveLength(1)
    expect(result.clients[0].status).toBe('drafted')
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: 1,
        summary: expect.objectContaining({ no_publish: true, clients: expect.any(Array) }),
      }),
    )
    const summary = finish.mock.calls[0][0].summary as { clients: unknown[] }
    expect(summary.clients).toHaveLength(1)
  })

  it('🔴 评价读失败 → read_failed，finish failed 1，llm 不调用（读不到 = 不判）', async () => {
    const llm = fakeLlm()
    const fn = createSimaqianReputationWeeklyFunction({
      supabase: fakeSupabase({ clients: { data: roster }, review_items: { data: null, error: { message: 'reviews down' } } }),
      llm,
    })
    const harness = fakeStep()
    const result = (await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })) as {
      clients: { status: string }[]
    }
    expect(result.clients[0].status).toBe('read_failed')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
    expect(llm).not.toHaveBeenCalled()
  })

  it('🔴 每一处副作用都在 step 里——log-start 与 log-finish 都进过 ranStepIds', async () => {
    const llm = fakeLlm()
    const fn = createSimaqianReputationWeeklyFunction({
      supabase: fakeSupabase({ clients: { data: roster }, review_items: { data: twoReviews } }),
      llm,
    })
    const harness = fakeStep()
    await (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({ step: harness.step })
    expect(harness.ranStepIds).toContain('log-start')
    expect(harness.ranStepIds).toContain('log-finish')
    expect(harness.ranStepIds).toContain(`patrol-${CTS}`)
  })
})
