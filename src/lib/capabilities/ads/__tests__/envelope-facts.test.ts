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
import { createAdsEnvelopeFactsResolver, hoursSinceOwnLastAction } from '../envelope-facts'
import type { CapabilityImplementation } from '@/lib/kernel/types'

const CLIENT = 'c-1'
const ACCOUNT = 'act_1'
const ADSET = 'as-1'
const NOW = new Date('2026-09-27T12:00:00Z')

type Row = Record<string, unknown>

/** 🔴 生产真实形状：CBO 广告组没有自己的预算、学习期读不到（CTS/NAL 46/46 就是这样）。 */
function snap(over: Row = {}): Row {
  return {
    id: `${String(over.ad_account_id ?? ACCOUNT)}:${String(over.level ?? 'adset')}:${String(over.entity_id ?? ADSET)}`,
    level: 'adset',
    ad_account_id: ACCOUNT,
    shared_account: false,
    entity_id: ADSET,
    adset_id: null,
    campaign_id: 'cmp-1',
    budget_level: null,
    daily_budget_minor: null,
    currency: 'NZD',
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
  ad_snapshot_captures: Row[]
  clients: Row | null
  /** 内核自己的执行记录（`hoursSinceOwnLastAction` 读这张表）。默认空数组 = 从没动过。 */
  action_runs: Row[]
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
            gte(col: string, val: unknown) { f[`gte:${col}`] = val; return chain },
            like(col: string, pattern: string) { f[`like:${col}`] = pattern; return chain },
            not(col: string, op: string, val: unknown) { f[`not:${col}`] = op; f[`notval:${col}`] = val; return chain },
            or(expr: string) { f.__or = expr; return chain },
            order(col: string, opts?: { ascending?: boolean }) {
              const orders = (f.__orders as Array<{ col: string; ascending?: boolean }> | undefined) ?? []
              f.__orders = [...orders, { col, ascending: opts?.ascending }]
              return chain
            },
            range(start: number, end: number) { f.__range = { start, end }; return settle() },
            limit(count: number) { f.__limit = count; return settle() },
            maybeSingle() { return settle() },
            then<T>(r: (v: ReturnType<typeof settle>) => T) { return Promise.resolve(settle()).then(r) },
          }
          const settle = () => {
            if (key === 'ad_entity_snapshots') log.snapQueries.push({ ...f })
            const err = log.errors[key]
            if (err) return { data: null, error: { message: err } }
            if (key === 'ad_strategy_configs') return { data: t.ad_strategy_configs, error: null }
            if (key === 'clients') return { data: t.clients, error: null }
            if (key === 'action_runs') {
              let rows = t.action_runs
              if (typeof f.client_id === 'string') rows = rows.filter((r) => r.client_id === f.client_id)
              if (Array.isArray(f.status)) rows = rows.filter((r) => (f.status as unknown[]).includes(r.status))
              if (typeof f['like:action_key'] === 'string') {
                const prefix = (f['like:action_key'] as string).replace(/%$/, '')
                rows = rows.filter((r) => String(r.action_key).startsWith(prefix))
              }
              if (f['not:finished_at'] === 'is') rows = rows.filter((r) => r.finished_at !== null && r.finished_at !== undefined)
              // 真实查询按实体在服务端筛（`input->>adset_id.eq.X,input->>campaign_id.eq.X`），
              // 替身必须照着筛 —— 不筛的话「没有记录命中」这类用例会永远绿（假测试）。
              if (typeof f.__or === 'string') {
                const wanted = (f.__or as string).split(',').map((clause) => {
                  const m = /^input->>([a-z_]+)\.eq\.(.+)$/.exec(clause)
                  return m ? { key: m[1], value: m[2] } : null
                }).filter((x): x is { key: string; value: string } => x !== null)
                if (wanted.length > 0) {
                  rows = rows.filter((r) => {
                    const input = (r.input ?? {}) as Record<string, unknown>
                    return wanted.some((w) => input[w.key] === w.value)
                  })
                }
              }
              const orders = (f.__orders as Array<{ col: string; ascending?: boolean }> | undefined) ?? []
              if (orders.length) rows = [...rows].sort((a, b) => {
                for (const order of orders) {
                  const compared = String(a[order.col]).localeCompare(String(b[order.col])) * (order.ascending === false ? -1 : 1)
                  if (compared) return compared
                }
                return 0
              })
              if (typeof f.__limit === 'number') rows = rows.slice(0, f.__limit)
              return { data: rows, error: null }
            }
            if (key === 'ad_snapshot_captures') {
              let rows = t.ad_snapshot_captures
              for (const [col, val] of Object.entries(f)) {
                if (col.startsWith('gte:')) rows = rows.filter(r => String(r[col.slice(4)]) >= String(val))
                else if (!col.startsWith('__') && col !== 'level' && col !== 'ad_account_id' && col !== 'client_id') rows = rows.filter(r => r[col] === val)
              }
              if (Array.isArray(f.level)) rows = rows.filter(r => (f.level as unknown[]).includes(r.level))
              if (Array.isArray(f.ad_account_id)) rows = rows.filter(r => (f.ad_account_id as unknown[]).includes(r.ad_account_id))
              if (typeof f.client_id === 'string') rows = rows.filter(r => r.client_id === f.client_id)
              const orders = (f.__orders as Array<{ col: string; ascending?: boolean }> | undefined) ?? []
              if (orders.length) rows = [...rows].sort((a, b) => {
                for (const order of orders) {
                  const compared = String(a[order.col]).localeCompare(String(b[order.col])) * (order.ascending === false ? -1 : 1)
                  if (compared) return compared
                }
                return 0
              })
              const range = f.__range as { start: number; end: number } | undefined
              if (range) rows = rows.slice(range.start, range.end + 1)
              if (typeof f.__limit === 'number') rows = rows.slice(0, f.__limit)
              return { data: rows, error: null }
            }
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
                if (c === '__or' || c.startsWith('__') || c === 'trip_event_id') continue
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
            if (typeof f.ad_account_id === 'string') rows = rows.filter(r => r.ad_account_id === f.ad_account_id)
            if (Array.isArray(f.ad_account_id)) rows = rows.filter(r => (f.ad_account_id as unknown[]).includes(r.ad_account_id))
            // 账户级查询（level 传数组）+ 开了截断开关 → 丢掉 changed 行，模拟窗口截断
            if (log.truncateAccountWindow && Array.isArray(f.level)) {
              rows = rows.filter((r) => r.capture_reason !== 'changed')
            }
            if (typeof f.capture_reason === 'string') rows = rows.filter((r) => r.capture_reason === f.capture_reason)
            if (typeof f['gte:captured_at'] === 'string') rows = rows.filter(r => String(r.captured_at) >= String(f['gte:captured_at']))
            if (typeof f.level === 'string') rows = rows.filter((r) => r.level === f.level)
            if (Array.isArray(f.level)) rows = rows.filter((r) => (f.level as unknown[]).includes(r.level))
            if (typeof f.entity_id === 'string') rows = rows.filter((r) => r.entity_id === f.entity_id)
            const orders = (f.__orders as Array<{ col: string; ascending?: boolean }> | undefined) ?? []
            if (orders.length) rows = [...rows].sort((a, b) => {
              for (const order of orders) {
                const compared = String(a[order.col]).localeCompare(String(b[order.col])) * (order.ascending === false ? -1 : 1)
                if (compared) return compared
              }
              return 0
            })
            const range = f.__range as { start: number; end: number } | undefined
            if (range) rows = rows.slice(range.start, range.end + 1)
            if (typeof f.__limit === 'number') rows = rows.slice(0, f.__limit)
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
  'ads.cut_campaign_budget': { actionKey: 'ads.cut_campaign_budget', version: 1, steps: {}, rollback: async () => ({ ok: true, rollbackKind: 'noop', detail: {} }) } as unknown as CapabilityImplementation,
  'ads.scale_unit_budget': { actionKey: 'ads.scale_unit_budget', version: 1, steps: {}, rollback: async () => ({ ok: true, rollbackKind: 'noop', detail: {} }) } as unknown as CapabilityImplementation,
}

function resolve(
  t: Partial<Tables>,
  log: Log,
  at: 'authorize' | 'pre_provider' = 'authorize',
  actionKey: 'ads.pause_unit' | 'ads.cut_campaign_budget' | 'ads.scale_unit_budget' = 'ads.pause_unit',
  input: Record<string, unknown> = { ad_account_id: ACCOUNT, adset_id: ADSET, cycle_date: '2026-09-27' },
) {
  const tables: Tables = {
    ad_entity_snapshots: [],
    ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
    ads_circuit_events: [],
    // 默认空数组：客户没在这张表建过行 → 回落客户级总闸（跟这个函数改动前的行为一致，
    // 已有用例不用逐个加账户级配置才能继续通过）。
    client_meta_ad_accounts: [],
    ad_snapshot_captures: [],
    clients: null,
    action_runs: [],
    ...t,
  }
  const resolver = createAdsEnvelopeFactsResolver({
    sb: makeSb(tables, log),
    capabilities: withRollback,
    now: () => NOW,
  })
  return resolver({
    clientId: CLIENT,
    actionKey,
    input,
    at,
    runId: 'run-1',
  })
}

describe('加预算客户级安全事实', () => {
  const account = (id: string, level: string, entity: string, budget: number | null, over: Row = {}) => snap({
    id: `snapshot:${id}:${level}:${entity}`,
    ad_account_id: id, level, entity_id: entity, adset_id: level === 'adset' ? entity : null,
    campaign_id: level === 'adset' ? `cmp-${id}` : null,
    budget_level: level === 'adset' ? 'abo' : null,
    daily_budget_minor: budget, currency: 'NZD', effective_status: 'ACTIVE',
    capture_reason: 'daily', captured_at: new Date(NOW.getTime() - 60_000).toISOString(), ...over,
  })
  const completeCaptures = (id: string) => ['account', 'campaign', 'adset'].map(level => ({
    client_id: CLIENT, ad_account_id: id, level, captured_at: new Date(NOW.getTime() - 60_000).toISOString(), capture_reason: 'scheduled',
    complete: true, skipped_shared: false,
  }))
  const scaleInput = { ad_account_id: ACCOUNT, adset_id: ADSET, before_cents: 500, after_cents: 550, cycle_date: '2026-09-27' }

  it('读取客户所有账户并在同币种完整证据下返回总预算与客户上限', async () => {
    const rows = [
      account(ACCOUNT, 'account', ACCOUNT, null),
      account(ACCOUNT, 'campaign', 'cmp-act_1', null, { budget_level: 'abo' }),
      account(ACCOUNT, 'adset', ADSET, 500),
      account('act_2', 'account', 'act_2', null),
      account('act_2', 'campaign', 'cmp-act_2', null, { budget_level: 'abo' }),
      account('act_2', 'adset', 'as-2', 200),
    ]
    const r = await resolve({
      ad_entity_snapshots: rows,
      ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
      client_meta_ad_accounts: [
        { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 6_000 },
        { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 4_000 },
      ],
      ad_snapshot_captures: [...completeCaptures(ACCOUNT), ...completeCaptures('act_2')],
    }, log(), 'authorize', 'ads.scale_unit_budget', scaleInput)
    expect(r).toMatchObject({ facts: { beforeCents: 500, accountDailyTotalBeforeCents: 500, clientDailyTotalBeforeCents: 700, clientDailyCapCents: 10_000 } })
  })

  it('快照预算已不同于用户看到并批准的基线时拒绝创建放量授权', async () => {
    const r = await resolve({
      ad_entity_snapshots: [
        account(ACCOUNT, 'account', ACCOUNT, null),
        account(ACCOUNT, 'campaign', 'cmp-act_1', null, { budget_level: 'abo' }),
        account(ACCOUNT, 'adset', ADSET, 600),
      ],
      ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
      client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 10_000 }],
      ad_snapshot_captures: completeCaptures(ACCOUNT),
    }, log(), 'authorize', 'ads.scale_unit_budget', scaleInput)
    expect(r).toMatchObject({ unavailable: expect.stringContaining('预算已变化') })
  })

  it('CBO 的 O1 来源广告组可核算所属系列预算与客户总上限', async () => {
    const rows = [
      account(ACCOUNT, 'account', ACCOUNT, null),
      account(ACCOUNT, 'campaign', '456', 5_000, { budget_level: 'cbo' }),
      account(ACCOUNT, 'adset', ADSET, null, { campaign_id: '456', budget_level: 'cbo', learning_stage: 'SUCCESS' }),
    ]
    const r = await resolve({
      ad_entity_snapshots: rows,
      ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
      client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 10_000 }],
      ad_snapshot_captures: completeCaptures(ACCOUNT),
    }, log(), 'authorize', 'ads.scale_unit_budget', {
      ...scaleInput, campaign_id: '456', before_cents: 5_000, after_cents: 6_000,
    })
    expect(r).toMatchObject({
      request: { kind: 'budget_change', afterCents: 6_000 },
      facts: { beforeCents: 5_000, accountDailyTotalBeforeCents: 5_000, clientDailyTotalBeforeCents: 5_000, clientDailyCapCents: 10_000, learningStage: 'SUCCESS' },
    })
  })

  it('拒绝只凭一个 O1 广告组表现提高含多个在投广告组的 CBO 系列预算', async () => {
    const rows = [
      account(ACCOUNT, 'account', ACCOUNT, null),
      account(ACCOUNT, 'campaign', '456', 5_000, { budget_level: 'cbo' }),
      account(ACCOUNT, 'adset', ADSET, null, { campaign_id: '456', budget_level: 'cbo' }),
      account(ACCOUNT, 'adset', 'as-2', null, { campaign_id: '456', budget_level: 'cbo' }),
    ]
    const r = await resolve({ ad_entity_snapshots: rows }, log(), 'authorize', 'ads.scale_unit_budget', {
      ...scaleInput, campaign_id: '456', before_cents: 5_000, after_cents: 6_000,
    })
    expect(r).toMatchObject({ unavailable: expect.stringContaining('唯一在投广告组') })
  })

  it('任一账户缺少完整抓取回执时拒绝加预算', async () => {
    const r = await resolve({
      ad_entity_snapshots: [account(ACCOUNT, 'account', ACCOUNT, null), account(ACCOUNT, 'campaign', 'cmp-act_1', null, { budget_level: 'abo' }), account(ACCOUNT, 'adset', ADSET, 500)],
      client_meta_ad_accounts: [
        { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 6_000 },
        { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 4_000 },
      ],
      ad_snapshot_captures: completeCaptures(ACCOUNT),
    }, log(), 'authorize', 'ads.scale_unit_budget', scaleInput)
    expect(r).toMatchObject({ unavailable: expect.stringContaining('广告账户 act_2') })
  })

  it('忽略旧的完整回执，最新回执不完整时拒绝', async () => {
    const latest = new Date(NOW.getTime() - 30_000).toISOString()
    const prior = new Date(NOW.getTime() - 60_000).toISOString()
    const captures = [
      ...completeCaptures(ACCOUNT).map(row => ({ ...row, captured_at: prior })),
      ...completeCaptures(ACCOUNT).map(row => ({ ...row, captured_at: latest })),
    ]
    captures.find(row => row.level === 'adset' && row.captured_at === latest)!.complete = false
    const r = await resolve({
      ad_entity_snapshots: [account(ACCOUNT, 'account', ACCOUNT, null), account(ACCOUNT, 'campaign', 'cmp-act_1', null, { budget_level: 'abo' }), account(ACCOUNT, 'adset', ADSET, 500)],
      client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 10_000 }],
      ad_snapshot_captures: captures,
    }, log(), 'authorize', 'ads.scale_unit_budget', scaleInput)
    expect(r).toMatchObject({ unavailable: expect.stringContaining('不完整') })
  })

  it('超过 PostgREST 单页时继续分页后再核算，而不是把截断结果当完整', async () => {
    const rows = [
      account(ACCOUNT, 'account', ACCOUNT, null),
      account(ACCOUNT, 'campaign', 'cmp-act_1', null, { budget_level: 'abo' }),
      account(ACCOUNT, 'adset', ADSET, 500),
      ...Array.from({ length: 1_001 }, (_, i) => account(ACCOUNT, 'adset', `paused-${i}`, null, { effective_status: 'PAUSED' })),
    ]
    const r = await resolve({
      ad_entity_snapshots: rows,
      client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 10_000 }],
      ad_snapshot_captures: completeCaptures(ACCOUNT),
    }, log(), 'authorize', 'ads.scale_unit_budget', scaleInput)
    expect(r).toMatchObject({ facts: { clientDailyTotalBeforeCents: 500, clientDailyCapCents: 10_000 } })
  })
})

describe('ads.cut_campaign_budget CBO facts', () => {
  const campaign = (over: Row = {}) => snap({
    level: 'campaign', entity_id: '456', campaign_id: null, adset_id: null,
    budget_level: 'cbo', daily_budget_minor: 5_000, learning_stage: 'LEARNING',
    effective_status: 'ACTIVE', currency: 'NZD', ...over,
  })
  const run = (rows: Row[], after = 4_000, over: Row = {}) => {
    const testLog = log()
    return resolve({ ad_entity_snapshots: [...rows, campaign(over)] }, testLog, 'authorize', 'ads.cut_campaign_budget', {
      ad_account_id: ACCOUNT, campaign_id: '456', after_cents: after, cycle_date: '2026-09-27',
    })
  }

  it('读取系列自己的 CBO 预算，并在账户合计中避免把子广告组重复计入', async () => {
    const r = await run([
      snap({ level: 'adset', entity_id: 'as-cbo', campaign_id: '456', budget_level: 'cbo', daily_budget_minor: 5_000, currency: 'NZD' }),
    ])
    expect(r).toMatchObject({
      request: { kind: 'budget_change', afterCents: 4_000 },
      facts: { beforeCents: 5_000, accountDailyTotalBeforeCents: 5_000, clientDailyTotalBeforeCents: null, dailyCapCents: 10_000, clientDailyCapCents: null, hasRollbackHandler: true },
    })
  })

  it('拒绝借减预算动作提高系列预算', async () => {
    const r = await run([], 5_001)
    expect(r).toMatchObject({ unavailable: expect.stringContaining('高于当前预算') })
  })

  it('拒绝 ABO 或币种未知的系列快照', async () => {
    expect(await run([], 4_000, { budget_level: 'abo' })).toMatchObject({ unavailable: expect.stringContaining('不是系列级 CBO') })
    expect(await run([], 4_000, { currency: null })).toMatchObject({ unavailable: expect.stringContaining('币种未知') })
  })

  it('在投账户实体预算缺失时无法核算总额，拒绝执行', async () => {
    const r = await run([
      snap({ level: 'adset', entity_id: 'as-abo', campaign_id: 'other', budget_level: 'abo', daily_budget_minor: null, currency: 'NZD', effective_status: 'ACTIVE' }),
    ])
    expect(r).toMatchObject({ unavailable: expect.stringContaining('预算缺失或无效') })
  })
})

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

describe('🔴 冷却期 · 故意不认 kernel_post（它是按客户全量写的，代表不了这个实体变了）', () => {
  it('只有 kernel_post 快照、没有 changed → 仍然算「从没变过」，不许当成刚改过', async () => {
    // snapshot.ts:363-365：reason=kernel_post 时该客户所有实体一律写一行，不看设置有没有变。
    // 认它就会让任何一次动作冻死整个客户 72 小时（魏征复审查实）。
    const post = snap({ capture_reason: 'kernel_post', captured_at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString() })
    const r = await resolve({ ad_entity_snapshots: [snap(), post] }, log())
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.hoursSinceLastChange).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('🔴 冷却期 · 内核自己的执行记录（hoursSinceOwnLastAction）', () => {
  const run = (over: Row = {}): Row => ({
    client_id: CLIENT,
    action_key: 'ads.cut_unit_budget',
    status: 'succeeded',
    finished_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    input: { ad_account_id: ACCOUNT, adset_id: ADSET },
    ...over,
  })

  it('input.adset_id 命中 → 算出小时数', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({ action_runs: [run()] } as unknown as Tables, log()), {
      clientId: CLIENT, entityIds: [ADSET], now: NOW,
    })
    expect(r).toEqual({ ok: true, hours: 1 })
  })

  it('input.campaign_id 命中 → 算出小时数', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ action_key: 'ads.cut_campaign_budget', input: { ad_account_id: ACCOUNT, campaign_id: '456' } })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: ['456'], now: NOW })
    expect(r).toEqual({ ok: true, hours: 1 })
  })

  it('没有任何记录命中 → { ok: true, hours: null }', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ input: { ad_account_id: ACCOUNT, adset_id: 'other' } })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: [ADSET], now: NOW })
    expect(r).toEqual({ ok: true, hours: null })
  })

  it('🔴 查询报错 → { ok: false }，绝不能塌成 { ok: true, hours: null }（fail-open）', async () => {
    const l = log()
    l.errors.action_runs = 'boom'
    const r = await hoursSinceOwnLastAction(makeSb({ action_runs: [] } as unknown as Tables, l), {
      clientId: CLIENT, entityIds: [ADSET], now: NOW,
    })
    expect(r.ok).toBe(false)
    expect(r).not.toEqual({ ok: true, hours: null })
    if (r.ok) return
    expect(r.error).toContain('boom')
  })

  it.each(['dead_letter', 'failed'])('状态是 %s 的记录也算（撤回的终态是 dead_letter；写进 Meta 后失败落 failed）', async (status) => {
    // 🔴 不要写 rolled_back：action_runs.status 没有这个取值（kernel/types.ts 的 RunStatus
    //    与建表 CHECK），第一版写了它等于筛零行，两位复审都抓到了。
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ status, finished_at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString() })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: [ADSET], now: NOW })
    expect(r).toEqual({ ok: true, hours: 5 })
  })

  it('🔴 状态是 denied / queued 的记录不算（还没走到动手那一步）', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ status: 'denied' }), run({ status: 'queued' })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: [ADSET], now: NOW })
    expect(r).toEqual({ ok: true, hours: null })
  })

  it('🔴 有记录但完成时间读不懂 → ok:false，不许跟「没有记录」同一个出口', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ finished_at: '不是时间' })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: [ADSET], now: NOW })
    expect(r.ok).toBe(false)
    expect(r).not.toEqual({ ok: true, hours: null })
  })

  it('🔴 换素材那类动作：input 里只有 ad_id，也要能命中', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({
      action_runs: [run({ action_key: 'ads.swap_creative', input: { ad_account_id: ACCOUNT, ad_id: '789' } })],
    } as unknown as Tables, log()), { clientId: CLIENT, entityIds: [ADSET, '789'], now: NOW })
    expect(r).toEqual({ ok: true, hours: 1 })
  })

  it('🔴 实体编号形状不认识 → 拒，不拼进查询', async () => {
    const r = await hoursSinceOwnLastAction(makeSb({ action_runs: [run()] } as unknown as Tables, log()), {
      clientId: CLIENT, entityIds: ['1,2)or(true'], now: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it('🔴 快照一条都没有时保持 null（读不到就拒），不许被一条很旧的执行记录改写成数字', async () => {
    const r = await resolve({
      ad_entity_snapshots: [],
      action_runs: [run({ finished_at: new Date(NOW.getTime() - 500 * 3_600_000).toISOString() })],
    }, log())
    expect('unavailable' in r).toBe(true)
  })

  it('🔴 执行记录比快照更近时，最终冷却小时数取更近的那个', async () => {
    const changed = snap({ capture_reason: 'changed', captured_at: new Date(NOW.getTime() - 10 * 3_600_000).toISOString() })
    const r = await resolve({
      ad_entity_snapshots: [snap(), changed],
      action_runs: [run({ finished_at: new Date(NOW.getTime() - 3_600_000).toISOString() })],
    }, log())
    expect('facts' in r).toBe(true)
    if (!('facts' in r)) return
    expect(r.facts.hoursSinceLastChange).toBeCloseTo(1, 1)
  })

  it('🔴 读执行记录失败 → 拒，前缀是 facts:', async () => {
    const l = log()
    l.errors.action_runs = 'boom'
    const r = await resolve({ ad_entity_snapshots: [snap()] }, l)
    expect('unavailable' in r).toBe(true)
    if (!('unavailable' in r)) return
    expect(r.unavailable.startsWith('facts:')).toBe(true)
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

describe('🔴 ads.pause_campaign · 账户号必须是 act_ 形式（stop-loss 路由 503 缺陷的下一步）', () => {
  const account = (id: string, level: string, entity: string, budget: number | null, over: Row = {}) => snap({
    id: `snapshot:${id}:${level}:${entity}`,
    ad_account_id: id, level, entity_id: entity, adset_id: level === 'adset' ? entity : null,
    campaign_id: level === 'adset' ? `cmp-${id}` : null,
    budget_level: level === 'adset' ? 'abo' : null,
    daily_budget_minor: budget, currency: 'NZD', effective_status: 'ACTIVE',
    capture_reason: 'daily', captured_at: new Date(NOW.getTime() - 60_000).toISOString(), ...over,
  })
  const completeCaptures = (id: string) => ['account', 'campaign', 'adset'].map(level => ({
    client_id: CLIENT, ad_account_id: id, level, captured_at: new Date(NOW.getTime() - 60_000).toISOString(), capture_reason: 'scheduled',
    complete: true, skipped_shared: false,
  }))
  const tables = () => ({
    ad_entity_snapshots: [
      account(ACCOUNT, 'account', ACCOUNT, null),
      account(ACCOUNT, 'campaign', '456', 5_000, { budget_level: 'cbo' }),
      account(ACCOUNT, 'adset', ADSET, null, { campaign_id: '456', budget_level: 'cbo' }),
    ],
    ad_strategy_configs: { daily_budget_cap_cents: 10_000 },
    client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 10_000 }],
    ad_snapshot_captures: completeCaptures(ACCOUNT),
  })

  it('ad_account_id 用 act_ 形式 → 能读出事实', async () => {
    const r = await resolve(tables(), log(), 'authorize', 'ads.pause_campaign', {
      cycle_date: '2026-09-27', ad_account_id: ACCOUNT, campaign_id: '456',
    })
    expect('facts' in r).toBe(true)
  })

  it('ad_account_id 用纯数字 → 读不出事实（fail-closed）', async () => {
    // 这条证明为什么路由入口必须规范化——内核不会替它补 act_ 前缀。
    const r = await resolve(tables(), log(), 'authorize', 'ads.pause_campaign', {
      cycle_date: '2026-09-27', ad_account_id: ACCOUNT.replace(/^act_/, ''), campaign_id: '456',
    })
    expect('unavailable' in r).toBe(true)
    // 实测原因：按纯数字账户号去库里找，快照（存的是 act_ 形式）一行都对不上。
    if ('unavailable' in r) expect(r.unavailable).toContain('快照里查不到')
  })
})
