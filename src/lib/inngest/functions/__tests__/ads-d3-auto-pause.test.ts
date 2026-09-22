/**
 * Ads D3 自动暂停 —— 消费者测试。
 *
 * 只建模 `flywheel_actions`（processD3Hit 唯一真的碰数据库的地方）；
 * `loadConfig` / `loadDiagnosisRun` / `isSharedAccount` / `submitCandidate`
 * 全部注入假实现，不碰真 supabase / 真 Kernel。
 *
 * `optsOf`/`handlerOf` 的 `.opts`/`.fn` 桥接写法跟
 * `conversation-health-heartbeat.test.ts` 同一套——那份测试已经实测验证过
 * 在当前 inngest 包版本（3.54.0）下这两个字段运行时真实存在，这里直接复用，
 * 不重新验证一遍；下面 retries/triggers 的用例跑绿即是这句话的实测。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeD3AutoPauseIdempotencyKey,
  processD3Hit,
  createD3AutoPauseFunction,
  ADS_DIAGNOSTICS_COMPLETED_EVENT,
  type D3AutoPauseDeps,
} from '../ads-d3-auto-pause'
import type { AdStrategyConfig } from '@/lib/ads-strategy/config'
import type { Diagnosis } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import type { SubmitAdsAutoPauseResult } from '@/lib/action-submission/ads-auto-pause'

type Row = Record<string, unknown>

/**
 * 只建模 flywheel_actions：insert 记账、select 查是否已记过账。跟
 * `conversation-health-heartbeat.test.ts` 的 `makeFakeAlertsSupabase` 同一
 * 约定——未建模的表直接抛错，不会安静地什么都没发生。
 */
function makeFakeFlywheelSupabase(existingRows: Row[] = []) {
  const inserted: Row[] = []
  const from = (table: string) => {
    if (table !== 'flywheel_actions') throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const eqFilters: Array<[string, unknown]> = []
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      eqFilters.push([col, val])
      return builder
    }
    builder.order = () => builder
    builder.limit = () => builder
    // `payload->>col` 过滤对着假行的 `payload.col` 取值——真实 PostgREST 也是
    // 拿 JSONB 里这个键的文本值比较，这里同样浅层模拟。
    const valueFor = (row: Row, col: string): unknown => {
      const m = /^payload->>(.+)$/.exec(col)
      if (!m) return row[col]
      return (row.payload as Row | undefined)?.[m[1]]
    }
    builder.maybeSingle = async () => {
      const match = existingRows.find((r) => eqFilters.every(([c, v]) => valueFor(r, c) === v))
      return { data: match ?? null, error: null }
    }
    builder.insert = (row: Row) => {
      inserted.push(row)
      return Promise.resolve({ data: null, error: null })
    }
    return builder
  }
  // 只暴露生产代码真的调过的 `.from()`——SupabaseClient 剩下的表面积这里不实现，
  // 用哪个漏建模的方法测试会立刻抛错，不会静默通过。
  return { supabase: { from } as unknown as SupabaseClient, inserted }
}

function makeConfig(overrides: Partial<AdStrategyConfig> = {}): AdStrategyConfig {
  return {
    client_id: 'client-1',
    enabled: true,
    digest_recipients: [],
    autopilot_enabled: true,
    autopilot_dry_run: true,
    ...overrides,
  }
}

function makeD3Diagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    code: 'D3',
    status: 'hit',
    title: '花钱没结果：近 7 天花了 $140，留资 0 个',
    units: [{ level: 'adset', id: 'adset-1', name: 'Reels · 冷流量', adAccountId: '123456' }],
    evidence: { spend: 140, results: 0 },
    sample: [{ label: '留资', value: 0 }],
    reasons: ['花费 ≥ 2× 目标，且单次成本 ≥ 2× 目标'],
    clientVisible: true,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<D3AutoPauseDeps> = {}, existingRows: Row[] = []): D3AutoPauseDeps {
  const { supabase } = makeFakeFlywheelSupabase(existingRows)
  return {
    supabase,
    loadConfig: vi.fn(async () => makeConfig()),
    loadDiagnosisRun: vi.fn(async () => null),
    isSharedAccount: vi.fn(async () => false),
    submitCandidate: vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'pending_approval', runId: 'run-1', authorizationDecisionId: 'dec-1',
    })),
    ...overrides,
  }
}

describe('computeD3AutoPauseIdempotencyKey', () => {
  it('确定性：相同输入永远得到同一把键', () => {
    const args = { clientId: 'c1', diagnosisCode: 'D3', entityId: 'adset-1', insightDate: '2026-09-21' }
    expect(computeD3AutoPauseIdempotencyKey(args)).toBe(computeD3AutoPauseIdempotencyKey(args))
  })

  it('任何一个字段变了，键就不一样', () => {
    const base = { clientId: 'c1', diagnosisCode: 'D3', entityId: 'adset-1', insightDate: '2026-09-21' }
    const k0 = computeD3AutoPauseIdempotencyKey(base)
    expect(computeD3AutoPauseIdempotencyKey({ ...base, entityId: 'adset-2' })).not.toBe(k0)
    expect(computeD3AutoPauseIdempotencyKey({ ...base, insightDate: '2026-09-22' })).not.toBe(k0)
    expect(computeD3AutoPauseIdempotencyKey({ ...base, clientId: 'c2' })).not.toBe(k0)
  })
})

describe('processD3Hit', () => {
  const baseArgs = { clientId: 'client-1', insightDate: '2026-09-21', diagnosisRunId: 'narrative-1' }

  it('已经记过账的幂等键 → 跳过，不查共用账户、不提交 Kernel', async () => {
    const key = computeD3AutoPauseIdempotencyKey({
      clientId: 'client-1', diagnosisCode: 'D3', entityId: 'adset-1', insightDate: '2026-09-21',
    })
    const isSharedAccount = vi.fn(async () => false)
    const submitCandidate = vi.fn()
    const deps = makeDeps({ isSharedAccount, submitCandidate }, [
      { id: 'x', client_id: 'client-1', flywheel: 'ads', action_type: 'ads.auto_pause_on_d3', payload: { idempotency_key: key } },
    ])
    const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig() })
    expect(result.outcome).toBe('skipped_already_recorded')
    expect(isSharedAccount).not.toHaveBeenCalled()
    expect(submitCandidate).not.toHaveBeenCalled()
  })

  it('共用账户 → 跳过并记一条 blocked，不提交 Kernel', async () => {
    const submitCandidate = vi.fn()
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, isSharedAccount: vi.fn(async () => true), submitCandidate })
    const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig() })
    expect(result.outcome).toBe('skipped_shared_account')
    expect(submitCandidate).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({ status: 'blocked' })
  })

  it('dry_run=true → 只记一条 dry_run_logged，绝不提交 Kernel', async () => {
    const submitCandidate = vi.fn()
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, submitCandidate })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: true }),
    })
    expect(result.outcome).toBe('dry_run_logged')
    expect(submitCandidate).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({ status: 'dry_run_logged' })
  })

  it('dry_run=false + Kernel 返回 pending_approval → 提交 Kernel 并记 awaiting_approval', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'pending_approval', runId: 'run-42', authorizationDecisionId: 'dec-42',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, submitCandidate })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: false }),
    })
    expect(result.outcome).toBe('awaiting_approval')
    expect(submitCandidate).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({
      status: 'awaiting_approval', action_run_id: 'run-42', authorization_decision_id: 'dec-42',
    })
  })

  it('Kernel idempotent_hit（重放）→ 不重复记账', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'idempotent_hit', runId: 'run-42',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, submitCandidate })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: false }),
    })
    expect(result.outcome).toBe('idempotent_hit')
    expect(inserted).toHaveLength(0)
  })

  it('Kernel 拒绝 → 记 blocked', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: false, reason: 'kernel_denied', runId: 'run-9', humanReason: '这个客户还没配规则',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, submitCandidate })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: false }),
    })
    expect(result.outcome).toBe('kernel_denied')
    expect(inserted[0].payload).toMatchObject({ status: 'blocked' })
  })

  it('flywheel_actions 写入失败必须抛错，不能吞（实测：mock insert 返回 error 时断言抛出）', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
        insert: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
      }),
      // 只建模生产代码真的调过的两个方法（select 链 + insert）——同一约定见文件头注释。
    } as unknown as SupabaseClient
    const deps = makeDeps({ supabase })
    await expect(
      processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: true }) }),
    ).rejects.toThrow(/写 flywheel_actions 失败/)
  })
})

describe('createD3AutoPauseFunction —— 装配契约', () => {
  type Fn = ReturnType<typeof createD3AutoPauseFunction>
  // 跟 conversation-health-heartbeat.test.ts 同一套桥接写法，已在该文件里实测
  // 跑绿过；这里直接复用，不重新验证一遍（文件头注释已说明）。
  function optsOf(fn: Fn) {
    return (fn as unknown as {
      opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit?: number; key?: string } }
    }).opts
  }
  function handlerOf(fn: Fn) {
    return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
  }
  function fakeStep() {
    return { run: vi.fn(async (_id: string, run: () => Promise<unknown> | unknown) => run()) }
  }

  it('🔴 retries: 0（pause 不是安全的自动重试对象）', () => {
    const fn = createD3AutoPauseFunction(makeDeps())
    expect(optsOf(fn).retries).toBe(0)
  })

  it('触发事件是 ads.diagnostics.completed_for_client', () => {
    const fn = createD3AutoPauseFunction(makeDeps())
    expect(optsOf(fn).triggers?.[0]?.event).toBe(ADS_DIAGNOSTICS_COMPLETED_EVENT)
  })

  it('event payload 形状不对 → 拒绝，不查库', async () => {
    const loadConfig = vi.fn()
    const fn = createD3AutoPauseFunction(makeDeps({ loadConfig }))
    const result = await handlerOf(fn)({ event: { data: { client_id: 'x' } }, step: fakeStep() })
    expect(result).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(loadConfig).not.toHaveBeenCalled()
  })

  it('autopilot_enabled=false → 跳过，不查诊断结果', async () => {
    const loadDiagnosisRun = vi.fn()
    const fn = createD3AutoPauseFunction(
      makeDeps({ loadConfig: vi.fn(async () => makeConfig({ autopilot_enabled: false })), loadDiagnosisRun }),
    )
    const result = await handlerOf(fn)({
      event: { data: { client_id: 'client-1', insight_date: '2026-09-21', diagnostic_run_id: 'n-1' } },
      step: fakeStep(),
    })
    expect(result).toMatchObject({ ok: true, skipped: 'autopilot_disabled' })
    expect(loadDiagnosisRun).not.toHaveBeenCalled()
  })

  it('只处理 D3 且 status=hit 的诊断，跳过 not_comparable 和别的诊断码', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'pending_approval', runId: 'run-1', authorizationDecisionId: 'dec-1',
    }))
    const fn = createD3AutoPauseFunction(
      makeDeps({
        loadConfig: vi.fn(async () => makeConfig({ autopilot_dry_run: false })),
        loadDiagnosisRun: vi.fn(async () => ({
          clientId: 'client-1', date: '2026-09-21', evaluatedAt: '2026-09-22T00:00:00Z',
          diagnoses: [
            makeD3Diagnosis(),
            makeD3Diagnosis({ status: 'not_comparable', units: [{ level: 'adset', id: 'adset-2', name: null, adAccountId: '123' }] }),
            makeD3Diagnosis({ code: 'D7', units: [{ level: 'account', id: 'acct-1', name: null, adAccountId: '123' }] }),
          ],
          excluded: [],
        })),
        submitCandidate,
      }),
    )
    const result = (await handlerOf(fn)({
      event: { data: { client_id: 'client-1', insight_date: '2026-09-21', diagnostic_run_id: 'n-1' } },
      step: fakeStep(),
    })) as { processed: number }
    expect(result.processed).toBe(1)
    expect(submitCandidate).toHaveBeenCalledTimes(1)
  })
})
