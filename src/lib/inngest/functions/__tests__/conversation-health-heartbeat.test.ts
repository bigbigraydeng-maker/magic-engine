/**
 * F4 conversation.health.heartbeat（issue #1587）装配 + 关键路径测试。
 *
 * 跟 `conversation-inbound-autoack.test.ts` 同一份读法：`.opts`/`.fn` 不是
 * Inngest SDK 对外暴露的公开类型，但那份测试已经实测验证过这套桥接写法在
 * 当前 inngest 包版本（package.json 锁的 3.54.0）下运行时真实存在——本文件
 * 直接复用同一写法，不重新猜一遍；下面每个 it() 跑绿就是这句话本身的验证。
 *
 * 假 supabase 只实现 `conversation_health_alerts` 这一张表、且只实现
 * `sync-alerts` 步骤真实调用过的方法（select/eq/maybeSingle/delete/upsert/
 * then）——`run-checks` 步骤本身不碰数据库，由注入的假 `runChecks` 直接顶替。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createConversationHealthHeartbeatFunction,
  type ConversationHealthHeartbeatDeps,
} from '../conversation-health-heartbeat'
import type { HealthCheckResult } from '@/lib/messenger-agent/health-heartbeat'
import { CLOUD_FN_PREFIX } from '../../client'

type Fn = ReturnType<typeof createConversationHealthHeartbeatFunction>
// 跟 conversation-inbound-autoack.test.ts 同一套桥接写法，已在该文件里实测
// 跑绿过；这里直接复用，不重新验证一遍。
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: {
      triggers?: { cron?: string }[]
      retries?: number
      concurrency?: { limit?: number }
    }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

/** step.run 假实现——跟 `conversation-inbound-autoack.test.ts` 同一写法。 */
function fakeStep() {
  return {
    run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
  }
}

type Row = Record<string, unknown>

/**
 * 只建模 `conversation_health_alerts`——只实现 `sync-alerts` 步骤真实调用过的
 * 方法。跟 `health-heartbeat.test.ts`/`optout.test.ts` 同一约定，未建模的表
 * 直接抛错；这里连表名都不认第二个，写错表名会立刻在 `npx vitest run` 报错，
 * 不会安静地什么都没发生（下面每个 it() 跑绿即是这句话的实测）。
 */
function makeFakeAlertsSupabase(existingRows: Row[] = []) {
  const deleteCalls: Row[] = []
  const upsertCalls: { row: Row; opts: unknown }[] = []
  const selectCalls: Row[] = []

  const from = (table: string) => {
    if (table !== 'conversation_health_alerts') {
      throw new Error(`fake supabase: 表 '${table}' 没建模`)
    }
    let mode: 'select' | 'delete' | null = null
    const eqFilters: Array<[string, unknown]> = []

    const builder: Record<string, unknown> = {}
    builder.select = () => {
      mode = 'select'
      return builder
    }
    builder.delete = () => {
      mode = 'delete'
      return builder
    }
    builder.eq = (col: string, val: unknown) => {
      eqFilters.push([col, val])
      return builder
    }
    builder.maybeSingle = async () => {
      const key = Object.fromEntries(eqFilters)
      selectCalls.push(key)
      const match = existingRows.find((r) => eqFilters.every(([c, v]) => r[c] === v))
      return { data: match ?? null, error: null }
    }
    builder.upsert = (row: Row, opts: unknown) => {
      upsertCalls.push({ row, opts })
      return Promise.resolve({ data: null, error: null })
    }
    // `.delete().eq().eq().eq()` 是直接 await 的，没有再调 `.maybeSingle()`——
    // 真实 supabase-js 的 filter builder 本身是 thenable，这里同样补一个
    // `.then()` 让它能被直接 await。
    ;(builder as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) => {
      if (mode === 'delete') deleteCalls.push(Object.fromEntries(eqFilters))
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    }
    return builder
  }

  // 只实现生产代码 `conversation-health-heartbeat.ts` 真实调过的这几个方法，
  // `SupabaseClient` 剩下的表面积本函数不会碰——下面每个 it() 跑绿就是这句话
  // 的实测。
  return { supabase: { from } as unknown as SupabaseClient, deleteCalls, upsertCalls, selectCalls }
}

function result(overrides: Partial<HealthCheckResult> = {}): HealthCheckResult {
  return {
    clientId: 'client-a',
    channel: 'whatsapp',
    checkType: 'webhook_silent',
    healthy: false,
    detail: '过去24小时只收到0条客户消息',
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ConversationHealthHeartbeatDeps> = {}): ConversationHealthHeartbeatDeps {
  const { supabase } = makeFakeAlertsSupabase()
  return {
    runChecks: vi.fn(async () => [result()]),
    supabase,
    ...overrides,
  }
}

describe('装配契约', () => {
  it('函数 id 带 CLOUD_FN_PREFIX，cron 每 6 小时一次，retries=1，并发上限 1', () => {
    const fn = createConversationHealthHeartbeatFunction(makeDeps())
    expect(fn.id()).toBe(`${CLOUD_FN_PREFIX}conversation-health-heartbeat`)
    const opts = optsOf(fn)
    expect(opts.triggers?.[0]?.cron).toBe('0 */6 * * *')
    expect(opts.retries).toBe(1)
    expect(opts.concurrency?.limit).toBe(1)
  })
})

describe('关键路径：两个 step 都被调用，且各自产生正确的副作用', () => {
  it('两个 step 都被调用：run-checks 拿到检查结果，sync-alerts 消费它', async () => {
    const runChecks = vi.fn(async () => [result({ healthy: true })])
    const { supabase } = makeFakeAlertsSupabase()
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    await handlerOf(fn)({ step })

    expect(step.run).toHaveBeenCalledTimes(2)
    expect(step.run.mock.calls[0][0]).toBe('run-checks')
    expect(step.run.mock.calls[1][0]).toBe('sync-alerts')
    expect(runChecks).toHaveBeenCalledTimes(1)
    expect(runChecks).toHaveBeenCalledWith(supabase, expect.any(Date))
  })

  it('healthy:false 的结果 → 调用了 upsert（不是 delete）', async () => {
    const { supabase, upsertCalls, deleteCalls } = makeFakeAlertsSupabase()
    const runChecks = vi.fn(async () => [
      result({ clientId: 'client-a', channel: 'whatsapp', checkType: 'optout_write_failed', healthy: false, detail: '有 1 次写入失败' }),
    ])
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    await handlerOf(fn)({ step })

    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].row).toMatchObject({
      client_id: 'client-a',
      channel: 'whatsapp',
      check_type: 'optout_write_failed',
      detail: '有 1 次写入失败',
    })
    expect(upsertCalls[0].opts).toEqual({ onConflict: 'client_id,channel,check_type' })
    expect(deleteCalls).toHaveLength(0)
  })

  it('healthy:true 的结果 → 调用了 delete（不是 upsert）——告警自愈', async () => {
    const { supabase, upsertCalls, deleteCalls } = makeFakeAlertsSupabase()
    const runChecks = vi.fn(async () => [
      result({ clientId: 'client-b', channel: 'messenger', checkType: 'webhook_silent', healthy: true }),
    ])
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    await handlerOf(fn)({ step })

    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0]).toMatchObject({
      client_id: 'client-b',
      channel: 'messenger',
      check_type: 'webhook_silent',
    })
    expect(upsertCalls).toHaveLength(0)
  })

  it('已有告警行的 first_detected_at 不被覆盖——upsert 时沿用原值，不是这一轮的「现在」', async () => {
    const existing = [
      {
        client_id: 'client-a',
        channel: 'whatsapp',
        check_type: 'verifier_error_rate_high',
        first_detected_at: '2026-09-10T00:00:00.000Z',
      },
    ]
    const { supabase, upsertCalls } = makeFakeAlertsSupabase(existing)
    const runChecks = vi.fn(async () => [
      result({
        clientId: 'client-a',
        channel: 'whatsapp',
        checkType: 'verifier_error_rate_high',
        healthy: false,
        detail: '验证器出错 5 次',
      }),
    ])
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    await handlerOf(fn)({ step })

    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].row.first_detected_at).toBe('2026-09-10T00:00:00.000Z')
    // last_detected_at/updated_at 应该是这一轮的新值，不是旧的那个时间。
    expect(upsertCalls[0].row.last_detected_at).not.toBe('2026-09-10T00:00:00.000Z')
  })

  it('新出现的告警（之前没有行）→ first_detected_at 就是这一轮的「现在」', async () => {
    const { supabase, upsertCalls } = makeFakeAlertsSupabase([]) // 没有任何已有行
    const runChecks = vi.fn(async () => [result({ healthy: false })])
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    await handlerOf(fn)({ step })

    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].row.first_detected_at).toBe(upsertCalls[0].row.last_detected_at)
  })

  it('返回的回执统计 healthy/unhealthy 数量', async () => {
    const { supabase } = makeFakeAlertsSupabase()
    const runChecks = vi.fn(async () => [
      result({ checkType: 'webhook_silent', healthy: false }),
      result({ checkType: 'verifier_block_rate_high', healthy: true }),
      result({ checkType: 'verifier_error_rate_high', healthy: true }),
    ])
    const fn = createConversationHealthHeartbeatFunction({ runChecks, supabase })
    const step = fakeStep()

    const receipt = (await handlerOf(fn)({ step })) as {
      total_checks: number
      unhealthy_count: number
      healthy_count: number
      no_publish: true
    }

    expect(receipt).toEqual({ total_checks: 3, unhealthy_count: 1, healthy_count: 2, no_publish: true })
  })
})
