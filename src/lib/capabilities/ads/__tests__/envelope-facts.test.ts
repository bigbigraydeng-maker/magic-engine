/**
 * 信封事实解析器（WP3.1b 本轮改动 + WP2 遗留缺陷 #1994）。
 *
 * ## 🔴 这个文件在本轮之前**一个测试都没有**
 *
 * 它是「这笔钱动不动」的**事实来源** —— Kernel 的 `authorize.ts` 和 `gateway.ts`
 * 都拿它的返回值做判断，读不到事实就一律拒。零覆盖意味着：
 *   · 那两个 #1994 缺陷（`at` 没解构、`limit(4000)` 让冷却闸失效）能躺 6 周没人发现
 *   · 本轮三处改动没有任何东西能证明它们没改坏别的
 *
 * 所以这份用例的重点不是覆盖率，是钉住**四条会让钱失控的性质**：
 *   ① 两层（authorize / pre_provider）事实来源必须不同，否则纵深防御退化成判两遍
 *   ② 冷却期判据不能受账户窗口截断影响（窗口越大越松 = fail-open）
 *   ③ 熔断中必须拒，而且「真熔断」和「查熔断这件事炸了」前缀分得开
 *   ④ 事实底座用**生产真实形状**（CBO 无自有预算 + learning_stage 为 NULL），不是理想值
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdsEnvelopeFactsResolver } from '../envelope-facts'
import type { CapabilityImplementation } from '@/lib/kernel/types'

const CLIENT = 'c-1'
const ACCOUNT = 'act_1'
const ADSET = 'as-1'
const NOW = new Date('2026-09-27T12:00:00Z')

type Row = Record<string, unknown>

/** 🔴 生产真实形状：CBO 广告组没有自己的预算、学习期读不到（CTS/NAL 46/46 就是这样）。 */
function snap(over: Row = {}): Row {
  return {
    level: 'adset',
    entity_id: ADSET,
    adset_id: null,
    campaign_id: 'cmp-1',
    budget_level: null,
    daily_budget_minor: null,
    learning_stage: null,
    ad_studies: null,
    effective_status: 'ACTIVE',
    capture_reason: 'daily',
    captured_at: new Date(NOW.getTime() - 60_000).toISOString(),
    ...over,
  }
}

interface Tables {
  ad_entity_snapshots: Row[]
  ad_strategy_configs: Row | null
  ads_circuit_events: Row[]
  /** 账户级日上限（v2.1 §3.9）。默认空数组 = 客户没在这张表建过行，回落客户级总闸。 */
  client_meta_ad_accounts: Row[]
}

interface Log {
  /** 每次查 ad_entity_snapshots 用过的过滤条件，用例断言判据真下到了查询里。 */
  snapQueries: Array<Record<string, unknown>>
  errors: Partial<Record<keyof Tables, string>>
  /**
   * 🔴 模拟 #1994 缺陷 2 的真实失败：`limit(4000)` 把账户级查询截断了，
   *    目标实体那条 `capture_reason='changed'` 的快照**掉在窗口外**。
   *
   *    开这个开关时：账户级查询（level 传数组）不返回 changed 行，
   *    按实体单独查（level 传字符串 + entity_id）**照常返回**。
   *
   *    这样两条路径会算出**不同**的答案 —— 不这么造，两边答案一样，
   *    「回退到用账户窗口」这个变异就抓不到（我第一版夹具就是这个毛病：
   *    绿得毫无意义）。
   */
  truncateAccountWindow?: boolean
}

function makeSb(t: Tables, log: Log): SupabaseClient {
  const sb = {
    from(table: string) {
      if (!(table in t)) throw new Error('unexpected table: ' + table)
      const key = table as keyof Tables
      return {
        select() {
          const f: Record<string, unknown> = {}
          const chain = {
            eq(col: string, val: unknown) { f[col] = val; return chain },
            in(col: string, vals: unknown[]) { f[col] = vals; return chain },
            or(expr: string) { f.__or = expr; return chain },
            order() { return chain },
            limit() { return settle() },
            maybeSingle() { return settle() },
            then<T>(r: (v: ReturnType<typeof settle>) => T) { return Promise.resolve(settle()).then(r) },
          }
          const settle = () => {
            if (key === 'ad_entity_snapshots') log.snapQueries.push({ ...f })
            const err = log.errors[key]
            if (err) return { data: null, error: { message: err } }
            if (key === 'ad_strategy_configs') return { data: t.ad_strategy_configs, error: null }
            if (key === 'client_meta_ad_accounts') {
              // 真过滤 client_id —— 判据要在「这个账户有没有自己的行」和
              // 「客户绑了几个账户」之间分清楚，无条件返回会把两者混在一起。
              let rows = t.client_meta_ad_accounts
              if (typeof f.client_id === 'string') rows = rows.filter((r) => r.client_id === f.client_id)
              return { data: rows, error: null }
            }
            if (key === 'ads_circuit_events') {
              let rows = t.ads_circuit_events
              for (const [c, v] of Object.entries(f)) {
                if (c === '__or' || c === 'trip_event_id') continue
                rows = rows.filter((r) => r[c] === v)
              }
              if (typeof f.__or === 'string') {
                rows = rows.filter((r) =>
                  (f.__or as string).split(',').some((part) => {
                    const [col, op, ...rest] = part.split('.')
                    const raw = rest.join('.')
                    if (op === 'eq') return String(r[col]) === raw
                    if (op === 'gt') return String(r[col]) > raw
                    throw new Error('假件没实现的算子: ' + part)
                  }),
                )
              }
              if (Array.isArray(f.trip_event_id)) {
                rows = rows.filter((r) => (f.trip_event_id as unknown[]).includes(r.trip_event_id))
              }
              return { data: rows, error: null }
            }
            // ad_entity_snapshots：真过滤 level / entity_id / capture_reason
            let rows = t.ad_entity_snapshots
            // 账户级查询（level 传数组）+ 开了截断开关 → 丢掉 changed 行，模拟窗口截断
            if (log.truncateAccountWindow && Array.isArray(f.level)) {
              rows = rows.filter((r) => r.capture_reason !== 'changed')
            }
            if (typeof f.capture_reason === 'string') rows = rows.filter((r) => r.capture_reason === f.capture_reason)
            if (typeof f.level === 'string') rows = rows.filter((r) => r.level === f.level)
            if (Array.isArray(f.level)) rows = rows.filter((r) => (f.level as unknown[]).includes(r.level))
            if (typeof f.entity_id === 'string') rows = rows.filter((r) => r.entity_id === f.entity_id)
            return { data: rows, error: null }
          }
          return chain
        },
      }
    },
  }
  return sb as unknown as SupabaseClient
}

const withRollback: Readonly<Record<string, CapabilityImplementation>> = {
  'ads.pause_unit': { actionKey: 'ads.pause_unit', version: 1, steps: {}, rollback: async () => ({ ok: true, rollbackKind: 'noop', detail: {} }) } as unknown as CapabilityImplementation,
}

function resolve(t: Partial<Tables>, log: Log, at: 'authorize' | 'pre_provider' = 'authorize') {
  const tables: Tables = {
    ad_entity_snapshots: [],
    ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
    ads_circuit_events: [],
    // 默认空数组：客户没在这张表建过行 → 回落客户级总闸（跟这个函数改动前的行为一致，
    // 已有用例不用逐个加账户级配置才能继续通过）。
    client_meta_ad_accounts: [],
    ...t,
  }
  const resolver = createAdsEnvelopeFactsResolver({
    sb: makeSb(tables, log),
    capabilities: withRollback,
    now: () => NOW,
  })
  return resolver({
    clientId: CLIENT,
    actionKey: 'ads.pause_unit',
    input: { ad_account_id: ACCOUNT, adset_id: ADSET, cycle_date: '2026-09-27' },
    at,
    runId: 'run-1',
  })
}

const log = (): Log => ({ snapQueries: [], errors: {} })

describe('信封事实 · 生产真实形状能读出来', () => {
  it('CBO 广告组（无自有预算）+ 学习期 NULL → 事实读出来了，beforeCents 为 null（由信封那层决定拒不拒）', async () => {
    const r = await resolve({ ad_entity_snapshots: [snap()] }, log())
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.beforeCents).toBeNull()
    expect(r.facts.learningStage).toBeNull()
    expect(r.facts.hasRollbackHandler).toBe(true)
  })
})

describe('🔴 #1994 缺陷 1 · 两层的事实来源必须不同', () => {
  const daily = snap({ capture_reason: 'daily', daily_budget_minor: 9_999 })
  const kernelPre = snap({ capture_reason: 'kernel_pre', daily_budget_minor: 1_111 })

  it('at=authorize → 用最新快照（不限 capture_reason）', async () => {
    const l = log()
    await resolve({ ad_entity_snapshots: [daily, kernelPre] }, l, 'authorize')
    expect(l.snapQueries[0].capture_reason, 'authorize 层不该限定 capture_reason').toBeUndefined()
  })

  it('🔴 at=pre_provider → 只读 capture_reason=kernel_pre 那一份', async () => {
    const l = log()
    const r = await resolve({ ad_entity_snapshots: [daily, kernelPre] }, l, 'pre_provider')
    expect(l.snapQueries[0].capture_reason).toBe('kernel_pre')
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    // 读到的是碰 Meta 之前那一份，不是 daily 那份
    expect(r.facts.beforeCents).toBe(1_111)
  })

  it('🔴 at=pre_provider 但没有 kernel_pre 快照 → fail closed，不许退回用最新快照凑合', async () => {
    const r = await resolve({ ad_entity_snapshots: [daily] }, log(), 'pre_provider')
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable).toContain('kernel_pre')
    expect(r.unavailable.startsWith('facts:')).toBe(true)
  })
})

describe('🔴 #1994 缺陷 2 · 冷却期判据不受账户窗口影响', () => {
  it('冷却期用的是单独一次按实体查的结果，且带了 level + entity_id 两个过滤', async () => {
    const l = log()
    await resolve({ ad_entity_snapshots: [snap()] }, l)
    // 第一段查账户（level 是数组），第二段查这一个实体（level 是字符串 + entity_id）
    expect(l.snapQueries).toHaveLength(2)
    expect(Array.isArray(l.snapQueries[0].level)).toBe(true)
    expect(l.snapQueries[1].level).toBe('adset')
    expect(l.snapQueries[1].entity_id).toBe(ADSET)
  })

  it('🔴 changed 快照掉在账户窗口外时，冷却小时数仍然算得出来（回退到用账户窗口必红）', async () => {
    // 这一条才是 #1994 缺陷 2 的回归测试：账户级查询看不到 changed 行，
    // 只有按实体单独查才看得到。如果实现回退成用账户窗口里的 subjectRows，
    // `hoursSinceLastRealChange` 会看到「有快照但没有一条 changed」→ 返回
    // MAX_SAFE_INTEGER（= 从没变过）→ 72 小时冷却闸直接失效（fail-open）。
    const l = log()
    l.truncateAccountWindow = true
    const changed = snap({
      capture_reason: 'changed',
      captured_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })
    const r = await resolve({ ad_entity_snapshots: [snap(), changed] }, l)
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(
      r.facts.hoursSinceLastChange,
      '冷却期必须由「按实体单独查」那一次算出来；' +
        '等于 MAX_SAFE_INTEGER 说明实现又回到了用被截断的账户窗口',
    ).toBeCloseTo(1, 1)
    expect(r.facts.hoursSinceLastChange).not.toBe(Number.MAX_SAFE_INTEGER)
  })

  it('实体有 changed 快照 → 冷却小时数算出来（不是 MAX_SAFE_INTEGER）', async () => {
    const changed = snap({ capture_reason: 'changed', captured_at: new Date(NOW.getTime() - 3_600_000).toISOString() })
    const r = await resolve({ ad_entity_snapshots: [snap(), changed] }, log())
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.hoursSinceLastChange).toBeCloseTo(1, 1)
  })
})

describe('🔴 熔断中必须拒，且两种原因前缀分得开', () => {
  const trip = {
    id: 't1', client_id: CLIENT, ad_account_id: ACCOUNT, kind: 'trip',
    trip_event_id: null, reason: 'circuit:spend_spike', sticky: false,
    created_at: new Date(NOW.getTime() - 60_000).toISOString(), seq: 1,
  }

  it('有未解的 trip → unavailable，理由带 circuit: 前缀', async () => {
    const r = await resolve({ ad_entity_snapshots: [snap()], ads_circuit_events: [trip] }, log())
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('circuit:')).toBe(true)
    expect(r.unavailable).toContain('熔断中')
  })

  it('sticky trip → 理由里说明必须人工解除', async () => {
    const r = await resolve(
      { ad_entity_snapshots: [snap()], ads_circuit_events: [{ ...trip, sticky: true }] },
      log(),
    )
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable).toContain('人工解除')
  })

  it('trip 已被 release → 不拒，事实正常读出来', async () => {
    const release = {
      id: 'r1', client_id: CLIENT, ad_account_id: ACCOUNT, kind: 'release',
      trip_event_id: 't1', reason: '解除', sticky: false,
      created_at: NOW.toISOString(), seq: 2,
    }
    const r = await resolve({ ad_entity_snapshots: [snap()], ads_circuit_events: [trip, release] }, log())
    expect('facts' in r).toBe(true)
  })

  it('🔴 熔断查询自身报错 → 也拒，但前缀是 facts: 不是 circuit:（是我们的 bug，不是客户熔断）', async () => {
    const l = log()
    l.errors.ads_circuit_events = 'boom'
    const r = await resolve({ ad_entity_snapshots: [snap()] }, l)
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('facts:')).toBe(true)
    expect(r.unavailable.startsWith('circuit:')).toBe(false)
    expect(r.unavailable).toContain('boom')
  })
})

describe('机器可读前缀 · 每种 unavailable 都带前缀', () => {
  it('读不到快照 → facts:', async () => {
    const l = log()
    l.errors.ad_entity_snapshots = 'db down'
    const r = await resolve({}, l)
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('facts:')).toBe(true)
  })

  it('快照里查不到这个实体 → facts:', async () => {
    const r = await resolve({ ad_entity_snapshots: [snap({ entity_id: 'other' })] }, log())
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('facts:')).toBe(true)
  })
})

describe('日上限改按账户取（v2.1 §3.9，本轮交付）', () => {
  it('这个账户自己配了上限 → 用账户级的值，不用客户总闸', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 999_999 },
        client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 5_000 }],
      },
      log(),
    )
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.dailyCapCents).toBe(5_000)
  })

  it('客户只绑了这一个账户、这个账户没配自己的上限 → 回落客户总闸', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 8_000 },
        client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: null }],
      },
      log(),
    )
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.dailyCapCents).toBe(8_000)
  })

  it('客户在 client_meta_ad_accounts 里压根没有行（老单账户客户）→ 回落客户总闸', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 8_000 },
        client_meta_ad_accounts: [],
      },
      log(),
    )
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.dailyCapCents).toBe(8_000)
  })

  it('🔴 客户绑了 ≥2 个账户、这个账户没配自己的上限 → 拒，不回落客户总闸', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 8_000 },
        client_meta_ad_accounts: [
          { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: null },
          { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 3_000 },
        ],
      },
      log(),
    )
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable).toBe('facts:账户级日上限未配置')
  })

  it('客户绑了 ≥2 个账户、这个账户**配了**自己的上限 → 正常放行，不因为「多账户」被误拒', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 8_000 },
        client_meta_ad_accounts: [
          { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 4_000 },
          { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 3_000 },
        ],
      },
      log(),
    )
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.dailyCapCents).toBe(4_000)
  })

  it('🔴 混进别的客户账户的行，不算进「这个客户绑了几个账户」', async () => {
    const r = await resolve(
      {
        ad_entity_snapshots: [snap()],
        ad_strategy_configs: { daily_budget_cap_cents: 8_000 },
        client_meta_ad_accounts: [
          { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: null },
          { client_id: 'other-client', ad_account_id: 'act_9', daily_budget_cap_cents: 1_000 },
        ],
      },
      log(),
    )
    // 只有 1 个属于本客户的行 → 回落总闸，不因为混进来的另一客户的行被当成「多账户」误拒
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.dailyCapCents).toBe(8_000)
  })

  it('查账户级上限失败 → 拒，且前缀是 facts:', async () => {
    const l = log()
    l.errors.client_meta_ad_accounts = 'boom'
    const r = await resolve({ ad_entity_snapshots: [snap()] }, l)
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('facts:')).toBe(true)
  })
})
