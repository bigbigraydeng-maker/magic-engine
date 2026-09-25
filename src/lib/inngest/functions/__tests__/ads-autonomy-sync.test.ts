/**
 * 自治开关同步 worker 的 Inngest 装配 + 关键路径测试。
 *
 * 测的是**装配 + 关键路径**：假 supabase 按表建模（`ad_strategy_configs` /
 * `ads_autonomy_sync_receipts` / `client_automation_policies` 三张内存表 +
 * `rpc` 假函数），不重跑 SQL 函数 `ads_sync_autonomy_policy` 本身的逻辑
 * （那在 migration 里）。
 *
 * 桥接 unknown：Inngest SDK 的 `createFunction()` 返回类型不对外暴露
 * `.opts` / `.fn` 这两个内部字段的公开类型，但运行时真实存在（同一读法已在
 * knowledge-mining.test.ts / factory-creatomate-render.test.ts 验证过）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createAdsAutonomySyncFunction,
  parseClientId,
  ADS_AUTONOMY_SYNC_FN_ID,
} from '../ads-autonomy-sync'
import { ADS_AUTONOMY_MODE_CHANGED } from '../../ads-events'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'

type Fn = ReturnType<typeof createAdsAutonomySyncFunction>
function optsOf(fn: Fn) {
  return (
    fn as unknown as {
      opts: {
        triggers?: { event?: string }[]
        retries?: number
        concurrency?: { limit: number; key?: string }
        onFailure?: (args: unknown) => Promise<void>
      }
    }
  ).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT = '11111111-2222-4333-8444-555555555555'

interface ConfigRow {
  autonomy_mode: 'observe' | 'bounded_auto'
  updated_at: string
  autonomy_mode_updated_by: string | null
}

interface PriorReceipt {
  action_key: string
  source_updated_at: string
  skipped_reason: string | null
  synced_at: string
}

interface FakeOpts {
  config?: ConfigRow | null
  priorReceipts?: PriorReceipt[]
  policies?: Record<string, string>
  rpcOutcome?: (actionKey: string) => string
  rpcError?: string
}

interface ReceiptRow {
  client_id: string
  action_key: string
  source_updated_at: string
  from_mode: string | null
  to_mode: string | null
  skipped_reason: string | null
}

/**
 * 假 supabase：按表建模，只支持 worker 真实用到的调用链。
 * 任何别的表 / 别的方法一律抛 —— 形状一旦跟生产侧对不上，测试当场红。
 */
function fakeSupabase(opts: FakeOpts) {
  const receipts: ReceiptRow[] = []
  const rpc = vi.fn(async (_name: string, params: Record<string, unknown>) => {
    if (opts.rpcError !== undefined) {
      return { data: null, error: { message: opts.rpcError } }
    }
    const key = String(params.p_action_key)
    return { data: opts.rpcOutcome ? opts.rpcOutcome(key) : 'inserted', error: null }
  })

  function configBuilder() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: opts.config ?? null, error: null }),
    }
    return chain
  }

  function receiptsBuilder() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data: opts.priorReceipts ?? [], error: null }),
      insert: async (row: ReceiptRow) => {
        receipts.push(row)
        return { error: null }
      },
    }
    return chain
  }

  function policiesBuilder() {
    // 🔴 只暴露读路径：worker 绝不许直接写 client_automation_policies。
    //    任何 update / insert / upsert / delete 都会撞上「方法不存在」而炸。
    let actionKey: string | null = null
    const chain = {
      select: () => chain,
      eq: (col: string, value: string) => {
        if (col === 'action_key') actionKey = value
        return chain
      },
      is: () => chain,
      maybeSingle: async () => {
        const mode = actionKey !== null ? opts.policies?.[actionKey] : undefined
        return { data: mode ? { mode } : null, error: null }
      },
    }
    return chain
  }

  const sb = {
    from: (table: string) => {
      if (table === 'ad_strategy_configs') return configBuilder()
      if (table === 'ads_autonomy_sync_receipts') return receiptsBuilder()
      if (table === 'client_automation_policies') return policiesBuilder()
      throw new Error('unexpected table ' + table)
    },
    rpc,
  } as unknown as SupabaseClient

  return { sb, receipts, rpc }
}

async function run(sb: SupabaseClient, data: unknown = { client_id: CLIENT }) {
  const fn = createAdsAutonomySyncFunction({ getSupabase: () => sb })
  return handlerOf(fn)({
    event: { id: 'evt-1', data },
    step: { run: (_id: string, cb: () => unknown) => cb() },
  })
}

async function runOnFailure(sb: SupabaseClient, data: unknown) {
  const fn = createAdsAutonomySyncFunction({ getSupabase: () => sb })
  const onFailure = optsOf(fn).onFailure
  if (!onFailure) throw new Error('onFailure not configured')
  await onFailure({ event: { data: { event: { data } } }, error: new Error('boom') })
}

describe('ads-autonomy-sync Inngest assembly', () => {
  it('注册在 cloudFunctions 里，id 带 cloud- 前缀', () => {
    const registered = cloudFunctions.find((fn) => fn.id() === ADS_AUTONOMY_SYNC_FN_ID)
    expect(registered).toBeDefined()
    expect(ADS_AUTONOMY_SYNC_FN_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('不监听 worker-owned 事件（one-event-one-owner 契约）', () => {
    const fn = createAdsAutonomySyncFunction({ getSupabase: () => fakeSupabase({}).sb })
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect(triggerEvent).toBe(ADS_AUTONOMY_MODE_CHANGED)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('按客户并发限 1，且配了重试', () => {
    const fn = createAdsAutonomySyncFunction({ getSupabase: () => fakeSupabase({}).sb })
    const opts = optsOf(fn)
    expect(opts.concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
    expect(opts.retries).toBeGreaterThan(0)
  })
})

describe('parseClientId', () => {
  it('接受合法 UUID', () => {
    expect(parseClientId({ client_id: CLIENT })).toBe(CLIENT)
  })

  it.each([
    ['非法 UUID', { client_id: 'nope' }],
    ['缺字段', {}],
    ['null', null],
    ['字符串', 'str'],
  ])('拒绝：%s', (_label, payload) => {
    expect(parseClientId(payload)).toBeNull()
  })
})

describe('ads-autonomy-sync handler', () => {
  it('payload 非法 → invalid_payload，不调 rpc、不写回执', async () => {
    const { sb, receipts, rpc } = fakeSupabase({})
    const result = await run(sb, { client_id: 'nope' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_payload' })
    expect(rpc).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(0)
  })

  it('没有配置行 → no_config，不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({ config: null })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: false, reason: 'no_config' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('🔴 正常路径 bounded_auto：每个键写一次 auto_approve + 一行回执', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const { sb, receipts, rpc } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: 'pm@example.test',
      },
      rpcOutcome: () => 'inserted',
    })
    const result = (await run(sb)) as {
      ok: true
      applied: number
      skipped: number
    }
    const keys = listAdsActionKeys()
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(keys.length)
    expect(result.skipped).toBe(0)

    expect(rpc).toHaveBeenCalledTimes(keys.length)
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('ads_sync_autonomy_policy')
      const params = call[1] as Record<string, unknown>
      expect(params.p_mode).toBe('auto_approve')
      expect(params.p_client_id).toBe(CLIENT)
      expect(params.p_updated_by).toBe(`autonomy-sync:pm@example.test:${updatedAt}`)
    }

    expect(receipts).toHaveLength(keys.length)
    for (const row of receipts) {
      expect(row.client_id).toBe(CLIENT)
      expect(row.to_mode).toBe('auto_approve')
      expect(row.from_mode).toBeNull()
      expect(row.skipped_reason).toBeNull()
      expect(row.source_updated_at).toBe(updatedAt)
    }
  })

  it('observe → require_approval，回执记下 from_mode', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const policies: Record<string, string> = {}
    for (const key of listAdsActionKeys()) policies[key] = 'auto_approve'
    const { sb, receipts, rpc } = fakeSupabase({
      config: {
        autonomy_mode: 'observe',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      policies,
      rpcOutcome: () => 'updated',
    })
    await run(sb)
    for (const call of rpc.mock.calls) {
      const params = call[1] as Record<string, unknown>
      expect(params.p_mode).toBe('require_approval')
    }
    for (const row of receipts) {
      expect(row.from_mode).toBe('auto_approve')
      expect(row.to_mode).toBe('require_approval')
    }
  })

  it('🔴 幂等：同一个 updated_at 已经同步过 → 全部跳过，不调 rpc、不写回执', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const priorReceipts: PriorReceipt[] = listAdsActionKeys().map((key) => ({
      action_key: key,
      source_updated_at: updatedAt,
      skipped_reason: null,
      synced_at: updatedAt,
    }))
    const { sb, receipts, rpc } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      priorReceipts,
    })
    const result = (await run(sb)) as { applied: number; skipped: number }
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(listAdsActionKeys().length)
    expect(rpc).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(0)
  })

  it('🔴 sync_failed 回执不算「已同步」—— 一次失败不能把键永久锁死', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const { sb, rpc } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      priorReceipts: [
        {
          action_key: '*',
          source_updated_at: updatedAt,
          skipped_reason: 'sync_failed:boom',
          synced_at: updatedAt,
        },
        {
          action_key: 'ads.pause_unit',
          source_updated_at: updatedAt,
          skipped_reason: 'sync_failed:boom',
          synced_at: updatedAt,
        },
      ],
      rpcOutcome: () => 'inserted',
    })
    await run(sb)
    const calledKeys = rpc.mock.calls.map((c) => (c[1] as Record<string, unknown>).p_action_key)
    expect(calledKeys).toContain('ads.pause_unit')
  })

  it('🔴 locked_by_deny：deny 不被覆盖，回执记 skipped_reason', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const { sb, receipts } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      policies: { 'ads.pause_unit': 'deny' },
      rpcOutcome: (key) => (key === 'ads.pause_unit' ? 'locked_by_deny' : 'inserted'),
    })
    const result = (await run(sb)) as {
      applied: number
      results: { key: string; outcome: string }[]
    }
    const pauseReceipt = receipts.find((r) => r.action_key === 'ads.pause_unit')
    expect(pauseReceipt?.skipped_reason).toBe('locked_by_deny')
    expect(pauseReceipt?.from_mode).toBe('deny')
    expect(result.results.find((r) => r.key === 'ads.pause_unit')?.outcome).toBe('locked_by_deny')
    expect(result.applied).toBe(listAdsActionKeys().length - 1)
  })

  it('unchanged：回执记 skipped_reason，applied 为 0', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const { sb, receipts } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      rpcOutcome: () => 'unchanged',
    })
    const result = (await run(sb)) as { ok: boolean; applied: number }
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(0)
    for (const row of receipts) {
      expect(row.skipped_reason).toBe('unchanged')
    }
  })

  it('rpc 报错 → 抛出 handler，且该键不写回执', async () => {
    const updatedAt = '2026-09-25T10:00:00+00:00'
    const { sb, receipts } = fakeSupabase({
      config: {
        autonomy_mode: 'bounded_auto',
        updated_at: updatedAt,
        autonomy_mode_updated_by: null,
      },
      rpcError: 'function ads_sync_autonomy_policy does not exist',
    })
    await expect(run(sb)).rejects.toThrow(/ads_sync_autonomy_policy/)
    expect(receipts).toHaveLength(0)
  })
})

describe('ads-autonomy-sync onFailure', () => {
  it('写一行 sync_failed 回执', async () => {
    const { sb, receipts } = fakeSupabase({})
    await runOnFailure(sb, { client_id: CLIENT })
    expect(receipts).toHaveLength(1)
    const row = receipts[0]
    expect(row.client_id).toBe(CLIENT)
    expect(row.action_key).toBe('*')
    expect(row.skipped_reason?.startsWith('sync_failed:boom')).toBe(true)
    expect(row.to_mode).toBeNull()
  })

  it('嵌套 client_id 非法 → 什么都不写', async () => {
    const { sb, receipts } = fakeSupabase({})
    await runOnFailure(sb, { client_id: 'nope' })
    expect(receipts).toHaveLength(0)
  })
})
