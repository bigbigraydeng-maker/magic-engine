import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadTrackerRoster,
  recentlyTracked,
  parseTrackerDue,
  trackerEventId,
  runOneClientTracker,
  MIN_HOURS_BETWEEN_RUNS,
  AI_VISIBILITY_WEEKLY_JOB,
  type TrackerRunOutcome,
} from '../weekly-fanout'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

type Row = Record<string, unknown>

/**
 * 同 competitors/__tests__/watch.test.ts 的 fakeSupabase 思路（已跑通验证过的做法）：
 * 把 .eq/.in/.contains 当真过滤条件跑，chain 本身可 await。loadTrackerRoster 会连着查
 * 两张表（先 ai_visibility_queries 拿候选 id，再 clients 按候选 id + 状态 + 开关过一遍），
 * 所以这里比 watch.test.ts 多支持一个 `.in()`。
 *
 * fixture 形状只需要覆盖 loadTrackerRoster/recentlyTracked 两个函数体里真实调用到的方法
 * （.from().select().eq()/.in()/.contains()/.gte()/.order()/.limit()）——已穷举这两个函数
 * 的全部调用点；链式调用对不上号会在 await 处直接抛错，不会静默通过，不是靠下面这处类型
 * 断言掩盖形状不对。
 */
function fakeSupabase(tables: Record<string, { data: Row[] | null; error: { message: string } | null }>): {
  client: SupabaseClient
  filtersFor: (table: string) => Array<[string, unknown]>
} {
  const filters: Record<string, Array<[string, unknown]>> = {}
  const client = {
    from(table: string) {
      filters[table] = []
      const result = tables[table] ?? { data: [], error: null }
      const apply = () => {
        if (result.error) return { data: null, error: result.error }
        const rows = (result.data ?? []).filter((r) =>
          filters[table].every(([col, val]) => {
            if (col === 'seo_config' && val && typeof val === 'object') {
              const cfg = r[col] as Record<string, unknown> | undefined
              return cfg !== undefined && Object.entries(val as Record<string, unknown>).every(([k, v]) => cfg[k] === v)
            }
            if (col === '__in__') {
              const [inCol, ids] = val as [string, string[]]
              return ids.includes(r[inCol] as string)
            }
            return r[col] === val
          }),
        )
        return { data: rows, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[table].push([col, val])
          return chain
        },
        in: (col: string, ids: string[]) => {
          filters[table].push(['__in__', [col, ids]])
          return chain
        },
        contains: (col: string, val: unknown) => {
          filters[table].push([col, val])
          return chain
        },
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => resolve(apply()),
      }
      return chain
    },
  }
  return { client: client as unknown as SupabaseClient, filtersFor: (t) => filters[t] ?? [] }
}

describe('loadTrackerRoster — 谁该被扫（灰度闸门）', () => {
  it('🔴 只有显式开了 ai_visibility_inngest_enabled 的活跃客户才进名单', async () => {
    const fake = fakeSupabase({
      ai_visibility_queries: { data: [{ client_id: CTS, enabled: true }, { client_id: OZTOP, enabled: true }], error: null },
      clients: {
        data: [
          { id: CTS, client_status: 'active', seo_config: { ai_visibility_inngest_enabled: true } },
          { id: OZTOP, client_status: 'active', seo_config: { weekly_blog: true } },
        ],
        error: null,
      },
    })
    const r = await loadTrackerRoster(fake.client)
    expect(r.ok && r.entries).toEqual([{ clientId: CTS }])
    expect(fake.filtersFor('clients')).toContainEqual(['client_status', 'active'])
    expect(fake.filtersFor('clients')).toContainEqual(['seo_config', { ai_visibility_inngest_enabled: true }])
  })

  it('🔴 候选名单只来自 ai_visibility_queries.enabled=true——跟旧 Render cron 同一批候选人', async () => {
    const fake = fakeSupabase({
      ai_visibility_queries: { data: [{ client_id: CTS, enabled: true }], error: null },
      clients: {
        data: [{ id: CTS, client_status: 'active', seo_config: { ai_visibility_inngest_enabled: true } }],
        error: null,
      },
    })
    await loadTrackerRoster(fake.client)
    expect(fake.filtersFor('ai_visibility_queries')).toContainEqual(['enabled', true])
  })

  it('没有任何客户配启用问题时，roster 为空，不去查 clients 表', async () => {
    const fake = fakeSupabase({ ai_visibility_queries: { data: [], error: null } })
    const r = await loadTrackerRoster(fake.client)
    expect(r).toEqual({ ok: true, entries: [] })
    expect(fake.filtersFor('clients')).toEqual([])
  })

  it('已流失的客户不许进名单，即使开了开关', async () => {
    const fake = fakeSupabase({
      ai_visibility_queries: { data: [{ client_id: CTS, enabled: true }], error: null },
      clients: {
        data: [{ id: CTS, client_status: 'churned', seo_config: { ai_visibility_inngest_enabled: true } }],
        error: null,
      },
    })
    const r = await loadTrackerRoster(fake.client)
    expect(r.ok && r.entries).toEqual([])
  })

  it('查询失败时返回 ok:false，不假装名单是空的', async () => {
    const fake = fakeSupabase({ ai_visibility_queries: { data: null, error: { message: 'boom' } } })
    const r = await loadTrackerRoster(fake.client)
    expect(r).toEqual({ ok: false, reason: 'boom' })
  })

  it('第二步 clients 查询失败也返回 ok:false', async () => {
    const fake = fakeSupabase({
      ai_visibility_queries: { data: [{ client_id: CTS, enabled: true }], error: null },
      clients: { data: null, error: { message: 'timeout' } },
    })
    const r = await loadTrackerRoster(fake.client)
    expect(r).toEqual({ ok: false, reason: 'timeout' })
  })
})

describe('recentlyTracked — 防重复扣费闸', () => {
  it('MIN_HOURS_BETWEEN_RUNS 之内有记录 → 跳过', async () => {
    const fake = fakeSupabase({
      ai_visibility_snapshots: { data: [{ client_id: CTS, created_at: new Date().toISOString() }], error: null },
    })
    const r = await recentlyTracked(fake.client, CTS)
    expect(r).toEqual({ skip: true, reason: 'tracked_recently' })
  })

  it('没有记录 → 不跳过', async () => {
    const fake = fakeSupabase({ ai_visibility_snapshots: { data: [], error: null } })
    const r = await recentlyTracked(fake.client, CTS)
    expect(r).toEqual({ skip: false, reason: null })
  })

  it('🔴 查不出来一律当成追踪过了（fail-closed）——查询失败不能变成多花一次 LLM 的钱', async () => {
    const fake = fakeSupabase({ ai_visibility_snapshots: { data: null, error: { message: 'timeout' } } })
    const r = await recentlyTracked(fake.client, CTS)
    expect(r.skip).toBe(true)
    expect(r.reason).toContain('lookup_failed')
  })

  it('窗口是 156 小时（6.5 天），不是按自然周算的日历边界', () => {
    expect(MIN_HOURS_BETWEEN_RUNS).toBe(156)
  })
})

describe('parseTrackerDue', () => {
  it('合法条子解析成功', () => {
    const r = parseTrackerDue({ client_id: CTS, week_key: '2026-W38' })
    expect(r).toEqual({ ok: true, value: { client_id: CTS, week_key: '2026-W38' } })
  })

  it('client_id 不是 UUID → 拒绝', () => {
    const r = parseTrackerDue({ client_id: 'not-a-uuid', week_key: '2026-W38' })
    expect(r).toEqual({ ok: false, reason: 'invalid_client_id' })
  })

  it('week_key 格式不对 → 拒绝', () => {
    const r = parseTrackerDue({ client_id: CTS, week_key: 'week-38' })
    expect(r).toEqual({ ok: false, reason: 'invalid_week_key' })
  })

  it('不是对象 → 拒绝', () => {
    expect(parseTrackerDue(null)).toEqual({ ok: false, reason: 'payload_not_object' })
  })
})

describe('trackerEventId', () => {
  it('按 client + week 生成稳定 id', () => {
    expect(trackerEventId(CTS, '2026-W38')).toBe(`ai-visibility-tracker-2026-W38-${CTS}`)
  })

  it('带 attempt 时追加后缀', () => {
    expect(trackerEventId(CTS, '2026-W38', 'retry-1')).toBe(`ai-visibility-tracker-2026-W38-${CTS}-retry-1`)
  })
})

describe('runOneClientTracker — 干活函数（依赖注入版，不碰真 provider）', () => {
  const due = { client_id: CTS, week_key: '2026-W38' }
  const neverSkip = async () => ({ skip: false, reason: null })

  it('防重复扣费闸拦下 → skipped，一次 runTracker 都不调', async () => {
    let called = false
    const fakeRunTracker = async (): Promise<TrackerRunOutcome> => {
      called = true
      return { runs_attempted: 1, runs_succeeded: 1, runs_failed: 0, client_brand_mentions: 1, total_cost_usd: 0.01, snapshot_id: 's1', snapshot_skipped_reason: null }
    }
    const receipt = await runOneClientTracker(due, fakeRunTracker, async () => ({ skip: true, reason: 'tracked_recently' }))
    expect(called).toBe(false)
    expect(receipt).toMatchObject({ status: 'skipped', client_id: CTS, week_key: '2026-W38', error: 'tracked_recently' })
  })

  it('🔴 CTS 平行对比：新 worker 原样转述 runTracker 的判断结果，逐字段实测——入参是 { client_id }，出参没有一处重新计算', async () => {
    let capturedInput: { client_id: string } | null = null
    const fakeResult: TrackerRunOutcome = {
      runs_attempted: 36,
      runs_succeeded: 34,
      runs_failed: 2,
      client_brand_mentions: 11,
      total_cost_usd: 0.842,
      snapshot_id: 'snap-abc',
      snapshot_skipped_reason: null,
    }
    const fakeRunTracker = async (input: { client_id: string }): Promise<TrackerRunOutcome> => {
      capturedInput = input
      return fakeResult
    }
    const receipt = await runOneClientTracker(due, fakeRunTracker, neverSkip)
    // 旧 Render cron（ai-tracker-weekly/route.ts）调用的是 runTracker({ client_id: clientId })——
    // 跟这里实测到的入参逐字段相同，是同一个判断函数、同一份入参，不是重新实现了一份判断逻辑。
    expect(capturedInput).toEqual({ client_id: CTS })
    expect(receipt.status).toBe('completed')
    expect(receipt.runs_attempted).toBe(fakeResult.runs_attempted)
    expect(receipt.runs_succeeded).toBe(fakeResult.runs_succeeded)
    expect(receipt.runs_failed).toBe(fakeResult.runs_failed)
    expect(receipt.client_brand_mentions).toBe(fakeResult.client_brand_mentions)
    expect(receipt.total_cost_usd).toBe(fakeResult.total_cost_usd)
    expect(receipt.snapshot_id).toBe(fakeResult.snapshot_id)
    expect(receipt.error).toBeNull()
  })

  it('runTracker 跑完但一次都没成功 → no_data，不算 completed', async () => {
    const fakeResult: TrackerRunOutcome = {
      runs_attempted: 4, runs_succeeded: 0, runs_failed: 4, client_brand_mentions: 0, total_cost_usd: 0, snapshot_id: null,
      snapshot_skipped_reason: null,
    }
    const receipt = await runOneClientTracker(due, async () => fakeResult, neverSkip)
    expect(receipt.status).toBe('no_data')
    expect(receipt.error).toBe('no_successful_runs')
  })

  it('🔴 引擎答了但一个数字都没落库 → no_data，且回执带上真因（不许写成 completed）', async () => {
    // 解析全挂时 runs_succeeded 照样大于 0（引擎确实答了），但没有快照。
    // 只看 runs_succeeded 会把它写成 completed / error:null，真因死在日志里。
    const fakeResult: TrackerRunOutcome = {
      runs_attempted: 18,
      runs_succeeded: 18,
      runs_failed: 0,
      client_brand_mentions: 0,
      total_cost_usd: 0.4,
      snapshot_id: null,
      snapshot_skipped_reason: '本周 18 条探测记录没有一条完成（18 次结果解析失败），提及率算不出来',
    }
    const receipt = await runOneClientTracker(due, async () => fakeResult, neverSkip)
    expect(receipt.status).toBe('no_data')
    expect(receipt.error).toBe(fakeResult.snapshot_skipped_reason)
    expect(receipt.snapshot_id).toBeNull()
  })

  it('🔴 runTracker 抛异常（比如这个客户没有已启用的问题）→ failed 回执，不往外抛', async () => {
    const receipt = await runOneClientTracker(
      due,
      async () => { throw new Error('No enabled queries found for client') },
      neverSkip,
    )
    expect(receipt).toMatchObject({ status: 'failed', client_id: CTS, error: 'No enabled queries found for client' })
  })

  it('🔴 一个客户失败不影响另一个客户——各自独立返回回执，互不牵连（实测并发跑两个客户）', async () => {
    const dueB = { client_id: OZTOP, week_key: '2026-W38' }
    const runTracker = async (input: { client_id: string }): Promise<TrackerRunOutcome> => {
      if (input.client_id === CTS) throw new Error('provider timeout')
      return { runs_attempted: 2, runs_succeeded: 2, runs_failed: 0, client_brand_mentions: 1, total_cost_usd: 0.02, snapshot_id: 'snap-b', snapshot_skipped_reason: null }
    }
    const [receiptA, receiptB] = await Promise.all([
      runOneClientTracker(due, runTracker, neverSkip),
      runOneClientTracker(dueB, runTracker, neverSkip),
    ])
    expect(receiptA.status).toBe('failed')
    expect(receiptB.status).toBe('completed')
    expect(receiptB.snapshot_id).toBe('snap-b')
  })

  it('job 名跟旧 Render cron 的 ai-tracker-weekly 不同名——两条链路覆盖范围不同，不能混进同一份健康检查', () => {
    expect(AI_VISIBILITY_WEEKLY_JOB).toBe('ai-visibility-tracker-weekly')
    expect(AI_VISIBILITY_WEEKLY_JOB).not.toBe('ai-tracker-weekly')
  })
})
