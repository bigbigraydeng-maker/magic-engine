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
  verifyAdsetOwnership,
  createD3AutoPauseFunction,
  ADS_DIAGNOSTICS_COMPLETED_EVENT,
  type D3AutoPauseDeps,
  type AdsetOwnershipCheck,
} from '../ads-d3-auto-pause'
import type { AdStrategyConfig, LoadedAdStrategyConfig } from '@/lib/ads-strategy/config'
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
    daily_budget_cap_cents: null,
    autonomy_mode: 'observe',
    creative_pool: [],
    autopilot_enabled: true,
    autopilot_dry_run: true,
    ...overrides,
  }
}

function loaded(config: AdStrategyConfig): LoadedAdStrategyConfig {
  return { config, source: 'row' }
}

/** 读失败时 config.ts 真实返回的形状：默认值（autopilot 关、dry_run 开）+ fallback + 原始报错。 */
function readFailed(error = 'column "autopilot_enabled" does not exist'): LoadedAdStrategyConfig {
  return {
    config: makeConfig({ autopilot_enabled: false, autopilot_dry_run: true }),
    source: 'fallback',
    error,
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
    loadConfig: vi.fn(async () => loaded(makeConfig())),
    loadDiagnosisRun: vi.fn(async () => null),
    isSharedAccount: vi.fn(async () => false),
    verifyAdsetOwnership: vi.fn(async (): Promise<AdsetOwnershipCheck> => ({ owned: true, adsChecked: 2, clientPageId: 'page-own' })),
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
    const dryOffConfig = makeConfig({ autopilot_dry_run: false })
    const deps = makeDeps({ supabase, submitCandidate, loadConfig: vi.fn(async () => loaded(dryOffConfig)) })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: dryOffConfig,
    })
    expect(result.outcome).toBe('awaiting_approval')
    expect(submitCandidate).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({
      status: 'awaiting_approval', action_run_id: 'run-42', authorization_decision_id: 'dec-42',
    })
    // 🔴 待办里要看得懂：这条回执必须带一句人话，不能只有状态码
    expect(String((inserted[0].payload as Row).reason)).toContain('等你批准')
  })

  it('Kernel idempotent_hit（重放）→ 不重复记账', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'idempotent_hit', runId: 'run-42',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const dryOffConfig = makeConfig({ autopilot_dry_run: false })
    const deps = makeDeps({ supabase, submitCandidate, loadConfig: vi.fn(async () => loaded(dryOffConfig)) })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: dryOffConfig,
    })
    expect(result.outcome).toBe('idempotent_hit')
    expect(inserted).toHaveLength(0)
  })

  it('Kernel 拒绝 → 记 blocked', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: false, reason: 'kernel_denied', runId: 'run-9', humanReason: '这个客户还没配规则',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const dryOffConfig = makeConfig({ autopilot_dry_run: false })
    const deps = makeDeps({ supabase, submitCandidate, loadConfig: vi.fn(async () => loaded(dryOffConfig)) })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: dryOffConfig,
    })
    expect(result.outcome).toBe('kernel_denied')
    expect(inserted[0].payload).toMatchObject({ status: 'blocked' })
  })

  it('单条处理时开关读失败 → 记 failed（系统没法核实）并带原始报错，不提交 Kernel，也不记成 dry_run_logged', async () => {
    const submitCandidate = vi.fn()
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const deps = makeDeps({ supabase, submitCandidate, loadConfig: vi.fn(async () => readFailed('boom')) })
    const result = await processD3Hit(deps, {
      ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: false }),
    })
    expect(result.outcome).toBe('skipped_config_read_failed')
    expect(submitCandidate).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({ status: 'failed', config_read_error: 'boom' })
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

describe('processD3Hit —— 归属闸（第二道防线，2026-09-27）', () => {
  const baseArgs = { clientId: 'client-1', insightDate: '2026-09-21', diagnosisRunId: 'narrative-1' }

  it('🔴 广告组挂别的主页 → 记 blocked，dry-run 也不记「会提交」，绝不提交 Kernel', async () => {
    const submitCandidate = vi.fn()
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const verifyAdsetOwnership = vi.fn(async (): Promise<AdsetOwnershipCheck> => ({ owned: false, verdict: 'other_page', detail: '挂在别的主页' }))
    const deps = makeDeps({ supabase, submitCandidate, verifyAdsetOwnership })
    const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig({ autopilot_dry_run: true }) })
    expect(result.outcome).toBe('skipped_not_client_owned')
    expect(verifyAdsetOwnership).toHaveBeenCalledWith('client-1', '123456', 'adset-1')
    expect(submitCandidate).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({ status: 'blocked', ownership_verdict: 'other_page' })
  })

  it('dry_run=false 也一样拦：Kernel 一次都不调', async () => {
    const submitCandidate = vi.fn()
    const dryOffConfig = makeConfig({ autopilot_dry_run: false })
    const deps = makeDeps({
      submitCandidate, loadConfig: vi.fn(async () => loaded(dryOffConfig)),
      verifyAdsetOwnership: vi.fn(async (): Promise<AdsetOwnershipCheck> => ({ owned: false, verdict: 'client_page_unknown', detail: '没登记主页' })),
    })
    const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: dryOffConfig })
    expect(result.outcome).toBe('skipped_not_client_owned')
    expect(submitCandidate).not.toHaveBeenCalled()
  })

  it('系统没法核实（读失败 / 快照没抓全）→ 记 failed，不记 blocked', async () => {
    for (const verdict of ['read_failed', 'capture_stale'] as const) {
      const { supabase, inserted } = makeFakeFlywheelSupabase()
      const deps = makeDeps({ supabase, verifyAdsetOwnership: vi.fn(async (): Promise<AdsetOwnershipCheck> => ({ owned: false, verdict, detail: 'x' })) })
      const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig() })
      expect(result.outcome).toBe('skipped_not_client_owned')
      expect(inserted[0].payload).toMatchObject({ status: 'failed', ownership_verdict: verdict })
    }
  })

  it('核实通过 → 归属依据写进记账和 Kernel 证据（批准的人看得见）', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'pending_approval', runId: 'run-1', authorizationDecisionId: 'dec-1',
    }))
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const dryOffConfig = makeConfig({ autopilot_dry_run: false })
    const deps = makeDeps({ supabase, submitCandidate, loadConfig: vi.fn(async () => loaded(dryOffConfig)) })
    await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: dryOffConfig })
    const own = { verdict: 'own', ads_checked: 2, client_page_id: 'page-own' }
    expect(inserted[0].payload).toMatchObject({ ownership: own })
    expect(submitCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ evidence: expect.objectContaining({ ownership: own }) }))
  })

  it('同一天已记过拦截 → 当天不重判（偏保守，补登主页后第二天才会重新判）', async () => {
    const key = computeD3AutoPauseIdempotencyKey({ clientId: 'client-1', diagnosisCode: 'D3', entityId: 'adset-1', insightDate: '2026-09-21' })
    const verifyAdsetOwnership = vi.fn()
    const deps = makeDeps({ verifyAdsetOwnership }, [
      { id: 'x', client_id: 'client-1', flywheel: 'ads', action_type: 'ads.auto_pause_on_d3', payload: { idempotency_key: key, status: 'blocked' } },
    ])
    const result = await processD3Hit(deps, { ...baseArgs, diagnosis: makeD3Diagnosis(), config: makeConfig() })
    expect(result.outcome).toBe('skipped_already_recorded')
    expect(verifyAdsetOwnership).not.toHaveBeenCalled()
  })
})

describe('verifyAdsetOwnership —— 回库核实', () => {
  const NOW = new Date('2026-09-27T00:00:00Z')
  interface Tables {
    page?: string | null
    capture?: { complete: boolean; captured_at: string } | null
    ads?: Array<{ entity_id: string; creative_page_id: string | null; capture_reason: string }>
    fail?: 'clients' | 'ad_snapshot_captures' | 'ad_entity_snapshots'
  }
  /** 按表建模：clients / ad_snapshot_captures / ad_entity_snapshots，其余表抛错。 */
  function fake(t: Tables): SupabaseClient {
    const from = (table: string) => {
      const err = t.fail === table ? { message: `${table} down` } : null
      const b: Record<string, unknown> = {}
      let from0 = 0
      let to0 = Infinity
      for (const m of ['select', 'eq', 'gte', 'order', 'limit']) b[m] = () => b
      b.range = (a: number, z: number) => { from0 = a; to0 = z; return b }
      if (table === 'clients') b.maybeSingle = async () => ({ data: err ? null : { facebook_page_id: t.page ?? null }, error: err })
      else if (table === 'ad_snapshot_captures') b.maybeSingle = async () => ({ data: err ? null : t.capture ?? null, error: err })
      else if (table === 'ad_entity_snapshots') b.then = (res: (v: unknown) => unknown) => res({ data: err ? null : (t.ads ?? []).slice(from0, to0 + 1), error: err })
      else throw new Error(`fake supabase: 表 '${table}' 没建模`)
      return b
    }
    return { from } as unknown as SupabaseClient
  }
  const fresh = { complete: true, captured_at: '2026-09-26T21:00:00Z' }
  const verify = (t: Tables) => verifyAdsetOwnership(fake(t), 'client-1', 'act_1', 'adset-1', NOW)

  it('名下广告每一行都挂客户主页 → owned，带广告条数', async () => {
    const r = await verify({ page: '99999999', capture: fresh, ads: [
      { entity_id: 'a1', creative_page_id: '99999999', capture_reason: 'daily' },
      { entity_id: 'a1', creative_page_id: '99999999', capture_reason: 'changed' },
      { entity_id: 'a2', creative_page_id: '99999999', capture_reason: 'daily' },
    ] })
    expect(r).toEqual({ owned: true, adsChecked: 2, clientPageId: '99999999' })
  })

  it('🔴 广告换过主页（旧行挂别家）→ mixed_pages，不放行', async () => {
    const r = await verify({ page: '99999999', capture: fresh, ads: [
      { entity_id: 'a1', creative_page_id: '99999999', capture_reason: 'changed' },
      { entity_id: 'a1', creative_page_id: '11111111', capture_reason: 'daily' },
    ] })
    expect(r).toMatchObject({ owned: false, verdict: 'mixed_pages' })
  })

  it('全挂别家 → other_page；一条广告都没有 → page_unknown；「消失」行不算数', async () => {
    expect(await verify({ page: '99999999', capture: fresh, ads: [{ entity_id: 'a1', creative_page_id: '11111111', capture_reason: 'daily' }] }))
      .toMatchObject({ owned: false, verdict: 'other_page' })
    expect(await verify({ page: '99999999', capture: fresh, ads: [{ entity_id: 'a1', creative_page_id: '99999999', capture_reason: 'disappeared' }] }))
      .toMatchObject({ owned: false, verdict: 'page_unknown' })
  })

  it('客户没登记主页 → client_page_unknown', async () => {
    expect(await verify({ page: null, capture: fresh })).toMatchObject({ owned: false, verdict: 'client_page_unknown' })
  })

  it('广告层快照最近一轮没抓全 / 超过 24 小时 / 找不到 → capture_stale（看不到新加进组的别家广告）', async () => {
    const ads = [{ entity_id: 'a1', creative_page_id: '99999999', capture_reason: 'daily' }]
    expect(await verify({ page: '99999999', capture: { complete: false, captured_at: '2026-09-26T21:00:00Z' }, ads })).toMatchObject({ verdict: 'capture_stale' })
    expect(await verify({ page: '99999999', capture: { complete: true, captured_at: '2026-09-25T00:00:00Z' }, ads })).toMatchObject({ verdict: 'capture_stale' })
    expect(await verify({ page: '99999999', capture: null, ads })).toMatchObject({ verdict: 'capture_stale' })
  })

  it('大广告组分页读完：第二页里的别家主页行照样判出来（不因为读满一页就放行或永远判不了）', async () => {
    const own = Array.from({ length: 1500 }, (_, i) => ({ entity_id: `a${i % 30}`, creative_page_id: '99999999', capture_reason: 'daily' }))
    expect(await verify({ page: '99999999', capture: fresh, ads: own })).toMatchObject({ owned: true, adsChecked: 30 })
    const olderOther = [...own, { entity_id: 'a0', creative_page_id: '11111111', capture_reason: 'daily' }]
    expect(await verify({ page: '99999999', capture: fresh, ads: olderOther })).toMatchObject({ owned: false, verdict: 'mixed_pages' })
  })

  it('🔴 读满 10 页（可能截断、更老的别家行没读到）→ read_failed，不放行（魏征第二轮）', async () => {
    const ads = Array.from({ length: 10_000 }, (_, i) => ({ entity_id: `a${i % 3}`, creative_page_id: '99999999', capture_reason: 'daily' }))
    expect(await verify({ page: '99999999', capture: fresh, ads })).toMatchObject({ owned: false, verdict: 'read_failed', detail: expect.stringContaining('可能没读全') })
    expect(await verify({ page: '99999999', capture: fresh, ads: ads.slice(1) })).toMatchObject({ owned: true })
  })

  it('任何一张表读失败 → read_failed', async () => {
    for (const fail of ['clients', 'ad_snapshot_captures', 'ad_entity_snapshots'] as const) {
      expect(await verify({ page: '99999999', capture: fresh, ads: [], fail })).toMatchObject({ owned: false, verdict: 'read_failed' })
    }
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
      makeDeps({ loadConfig: vi.fn(async () => loaded(makeConfig({ autopilot_enabled: false }))), loadDiagnosisRun }),
    )
    const result = await handlerOf(fn)({
      event: { data: { client_id: 'client-1', insight_date: '2026-09-21', diagnostic_run_id: 'n-1' } },
      step: fakeStep(),
    })
    expect(result).toMatchObject({ ok: true, skipped: 'autopilot_disabled' })
    expect(loadDiagnosisRun).not.toHaveBeenCalled()
  })

  it('开关读失败 → 单独报 config_read_failed（带原始报错），不混进 autopilot_disabled、不查诊断结果', async () => {
    const loadDiagnosisRun = vi.fn()
    const { supabase, inserted } = makeFakeFlywheelSupabase()
    const fn = createD3AutoPauseFunction(makeDeps({ supabase, loadConfig: vi.fn(async () => readFailed()), loadDiagnosisRun }))
    const result = await handlerOf(fn)({
      event: { data: { client_id: 'client-1', insight_date: '2026-09-21', diagnostic_run_id: 'n-1' } },
      step: fakeStep(),
    })
    expect(result).toEqual({
      ok: false,
      reason: 'config_read_failed',
      error: 'column "autopilot_enabled" does not exist',
      processed: 0,
    })
    expect(loadDiagnosisRun).not.toHaveBeenCalled()
    // 不能只留日志：记一条今日待办捞得到的回执
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ client_id: 'client-1', action_type: 'ads.auto_pause_on_d3' })
    expect(inserted[0].payload).toMatchObject({
      status: 'failed', insight_date: '2026-09-21', config_read_error: 'column "autopilot_enabled" does not exist',
    })
  })

  it('只处理 D3 且 status=hit 的诊断，跳过 not_comparable 和别的诊断码', async () => {
    const submitCandidate = vi.fn(async (): Promise<SubmitAdsAutoPauseResult> => ({
      ok: true, outcome: 'pending_approval', runId: 'run-1', authorizationDecisionId: 'dec-1',
    }))
    const fn = createD3AutoPauseFunction(
      makeDeps({
        loadConfig: vi.fn(async () => loaded(makeConfig({ autopilot_dry_run: false }))),
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
