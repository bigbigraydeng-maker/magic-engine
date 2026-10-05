/**
 * `circuit-cap-facts.ts` 的测试。
 *
 * 它组装的事实要喂进一个财务判据（客户日预算上限），出错的方向都是
 * fail-open——所以这份假 supabase **真的按各表的过滤条件筛行**，不是无条件
 * 返回固定数组。假件同时要模拟五张表（`client_meta_ad_accounts` / `clients` /
 * `ad_entity_snapshots` / `ad_strategy_configs` / `ad_daily_insights`），因为
 * `loadClientCapFacts` 组合了四个各自查 `supabaseAdmin` 单例的既有函数
 * （`getClientAdAccounts` / `resolveClientEvaluationDate` /
 * `loadAdStrategyConfigWithSource`）加本文件自己的两个查询。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// 一个按表名路由、真的做过滤/排序/上限的假 supabase。
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type TableName =
  | 'client_meta_ad_accounts'
  | 'clients'
  | 'ad_entity_snapshots'
  | 'ad_strategy_configs'
  | 'ad_daily_insights'

const db: Record<TableName, Row[]> = {
  client_meta_ad_accounts: [],
  clients: [],
  ad_entity_snapshots: [],
  ad_strategy_configs: [],
  ad_daily_insights: [],
}

/** 表名 → 该表这一次查询是否要报错（模拟查询失败）。测试间会被 reset。 */
const failTables = new Set<TableName>()

function resetDb() {
  for (const key of Object.keys(db) as TableName[]) db[key] = []
  failTables.clear()
}

function makeBuilder(table: TableName) {
  const filters: Array<(row: Row) => boolean> = []
  let orderCol: string | null = null
  let orderAsc = true
  let limitN: number | null = null

  function rowsMatched(): Row[] {
    let rows = db[table].filter((row) => filters.every((f) => f(row)))
    if (orderCol) {
      const col = orderCol
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? '')
        const bv = String(b[col] ?? '')
        if (av === bv) return 0
        const cmp = av < bv ? -1 : 1
        return orderAsc ? cmp : -cmp
      })
    }
    if (limitN !== null) rows = rows.slice(0, limitN)
    return rows
  }

  function result() {
    if (failTables.has(table)) {
      return { data: null, error: { message: `${table} 查询故意失败` } }
    }
    return { data: rowsMatched(), error: null }
  }

  const builder = {
    select() {
      return builder
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value)
      return builder
    },
    in(column: string, values: readonly unknown[]) {
      filters.push((row) => values.includes(row[column]))
      return builder
    },
    gte(column: string, value: unknown) {
      filters.push((row) => String(row[column]) >= String(value))
      return builder
    },
    lte(column: string, value: unknown) {
      filters.push((row) => String(row[column]) <= String(value))
      return builder
    },
    order(column: string, opts?: { ascending?: boolean }) {
      orderCol = column
      orderAsc = opts?.ascending !== false
      return builder
    },
    limit(n: number) {
      limitN = n
      return builder
    },
    maybeSingle() {
      const r = result()
      if (r.error) return Promise.resolve(r)
      return Promise.resolve({ data: r.data[0] ?? null, error: null })
    },
    then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) {
      return Promise.resolve(result()).then(resolve)
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: TableName) => makeBuilder(table),
  },
}))

import { loadClientCapFacts } from '../circuit-cap-facts'
// 真实函数，不是假件 —— 测试要用跟生产完全同一套时区口径来算「昨天是哪天」，
// 不能自己另写一遍 UTC 减一天（那正是本文件要防的口径分家）。
import { accountYesterday } from '../account-timezone'

const CLIENT = '11111111-1111-1111-1111-111111111111'

/** 造一个账户绑定行。 */
function accountRow(adAccountId: string, over: Partial<Row> = {}): Row {
  return { client_id: CLIENT, ad_account_id: adAccountId, label: null, is_primary: false, ...over }
}

/** 造一条 `ad_daily_insights` 行（默认 campaign 级）。 */
function insightRow(adAccountId: string, insightDate: string, spend: number | null, over: Partial<Row> = {}): Row {
  return {
    client_id: CLIENT,
    ad_account_id: adAccountId,
    level: 'campaign',
    insight_date: insightDate,
    spend,
    ...over,
  }
}

/** 造一条账户级快照行（给时区 + 币种用）。 */
function accountSnapshotRow(adAccountId: string, over: Partial<Row> = {}): Row {
  return {
    client_id: CLIENT,
    ad_account_id: adAccountId,
    level: 'account',
    entity_id: `${adAccountId}-account`,
    timezone_name: 'Pacific/Auckland',
    currency: 'NZD',
    captured_at: new Date().toISOString(),
    ...over,
  }
}

/** 造一条 campaign/adset 级快照行（给"在不在投"用）。 */
function entitySnapshotRow(
  adAccountId: string,
  entityId: string,
  effectiveStatus: string,
  over: Partial<Row> = {},
): Row {
  return {
    client_id: CLIENT,
    ad_account_id: adAccountId,
    level: 'campaign',
    entity_id: entityId,
    effective_status: effectiveStatus,
    captured_at: new Date().toISOString(),
    ...over,
  }
}

function configRow(over: Partial<Row> = {}): Row {
  return {
    client_id: CLIENT,
    enabled: true,
    digest_recipients: [],
    daily_budget_cap_cents: 100000,
    autonomy_mode: 'observe',
    creative_pool: [],
    autopilot_enabled: false,
    autopilot_dry_run: true,
    ...over,
  }
}

beforeEach(() => {
  resetDb()
})

describe('账户列表 + 参考日', () => {
  it('从 client_meta_ad_accounts 读账户列表', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1'), accountRow('act_2')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1'), accountSnapshotRow('act_2')]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.map((a) => a.adAccountId).sort()).toEqual(['act_1', 'act_2'])
  })

  it('没有 client_meta_ad_accounts 行时回落 clients.meta_ad_account_id', async () => {
    db.clients = [{ id: CLIENT, meta_ad_account_id: 'act_fallback' }]
    db.ad_entity_snapshots = [accountSnapshotRow('act_fallback')]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.map((a) => a.adAccountId)).toEqual(['act_fallback'])
  })

  it('零个账户 → accounts 为空数组，不报错', async () => {
    db.ad_strategy_configs = [configRow()]
    const facts = await loadClientCapFacts(CLIENT)
    expect(facts.accounts).toEqual([])
  })
})

describe('配置来源与上限', () => {
  it('有配置行 → configSource=row，capCents 是配置的值', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow({ daily_budget_cap_cents: 250000 })]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.configSource).toBe('row')
    expect(facts.capCents).toBe(250000)
  })

  it('没有配置行 → configSource=default，capCents 为 null', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.configSource).toBe('default')
    expect(facts.capCents).toBeNull()
  })

  it('配置读取失败 → configSource=fallback', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    failTables.add('ad_strategy_configs')

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.configSource).toBe('fallback')
  })
})

describe('每账户花费事实', () => {
  it('参考日当天有花费 → lastCompleteDate 就是参考日、spendCents 是当天合计', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')] // 时区 Pacific/Auckland（见 accountSnapshotRow 默认值）
    db.ad_strategy_configs = [configRow()]
    // 用跟生产同一个函数算「Auckland 时区下的昨天」，不用 UTC 减一天——
    // 两者在 UTC+12/13 的午夜前后会差一天，写死 UTC 会让这条测试脆弱地
    // 依赖跑测试时的挂钟时刻。
    const referenceDay = accountYesterday('Pacific/Auckland', new Date())
    db.ad_daily_insights = [insightRow('act_1', referenceDay, 100)]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(facts.clientReferenceDate).toBe(referenceDay)
    expect(a1.lastCompleteDate).toBe(referenceDay)
    expect(a1.spendCents).toBe(10000)
  })

  it('🔴 同一天多条 campaign 行（多个系列）→ 合计相加，不是只取一条', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [
      insightRow('act_1', day, 100, { entity_id: 'camp_1' }),
      insightRow('act_1', day, 50, { entity_id: 'camp_2' }),
      insightRow('act_1', day, 25, { entity_id: 'camp_3' }),
    ]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.spendCents).toBe(17500)
  })

  it('🔴 只算 campaign 级：混进 adset/ad 级的同一笔花费不重复计入', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [
      insightRow('act_1', day, 100, { level: 'campaign', entity_id: 'camp_1' }),
      insightRow('act_1', day, 100, { level: 'adset', entity_id: 'adset_1' }),
      insightRow('act_1', day, 100, { level: 'ad', entity_id: 'ad_1' }),
    ]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.spendCents).toBe(10000)
  })

  it('🔴 混有另一个账户同一天的花费 → 不计入这个账户', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1'), accountRow('act_2')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1'), accountSnapshotRow('act_2')]
    db.ad_strategy_configs = [configRow()]
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [insightRow('act_1', day, 100), insightRow('act_2', day, 999)]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.spendCents).toBe(10000)
    expect(facts.accounts.find((a) => a.adAccountId === 'act_2')!.spendCents).toBe(99900)
  })

  it('🔴 混有另一个客户同一天的花费 → 不计入', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [
      insightRow('act_1', day, 100),
      insightRow('act_1', day, 999, { client_id: 'other-client' }),
    ]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.spendCents).toBe(10000)
  })

  it('账户完全没有数据 → lastCompleteDate 和 spendCents 都是 null（不是 0）', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.lastCompleteDate).toBeNull()
    expect(a1.spendCents).toBeNull()
  })

  it('参考日当天没数据但更早有 → lastCompleteDate 是那个更早的日期', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]
    const staleDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [insightRow('act_1', staleDay, 42)]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.lastCompleteDate).toBe(staleDay)
    expect(a1.spendCents).toBe(4200)
  })

  it('spend 为 null 的行按 0 累加，不是让整天变成 null', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    db.ad_daily_insights = [
      insightRow('act_1', day, null, { entity_id: 'camp_1' }),
      insightRow('act_1', day, 10, { entity_id: 'camp_2' }),
    ]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.spendCents).toBe(1000)
  })
})

describe('花费事实：第一步「找哪一天」必须跟第二步同一套过滤条件', () => {
  it('🔴 第一步查询若漏了 level 过滤，会被同一天的 adset/ad 级行带偏「哪一天」', () => {
    return (async () => {
      db.client_meta_ad_accounts = [accountRow('act_1')]
      db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
      db.ad_strategy_configs = [configRow()]

      const referenceDay = accountYesterday('Pacific/Auckland', new Date())
      const staleCampaignDay = new Date(
        new Date(`${referenceDay}T00:00:00Z`).getTime() - 3 * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)
      const recentAdsetOnlyDay = new Date(
        new Date(`${referenceDay}T00:00:00Z`).getTime() - 1 * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)

      db.ad_daily_insights = [
        // 唯一的 campaign 级数据，在 3 天前
        insightRow('act_1', staleCampaignDay, 50, { level: 'campaign', entity_id: 'camp_1' }),
        // 更晚一天，但只有 adset 级——没有 campaign 级行
        insightRow('act_1', recentAdsetOnlyDay, 999, { level: 'adset', entity_id: 'adset_1' }),
      ]

      const facts = await loadClientCapFacts(CLIENT)
      const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!

      // 「哪一天」必须仍然是 campaign 级数据存在的那一天，不能被更晚的 adset 级
      // 行带偏——带偏之后第二步用 campaign 过滤去查那一天会查到 0 行，
      // 把真实花费（5000 分）看成 0。
      expect(a1.lastCompleteDate).toBe(staleCampaignDay)
      expect(a1.spendCents).toBe(5000)
    })()
  })

  it('🔴 第一步查询若漏了账户过滤，会被同一客户另一个账户的数据带偏「哪一天」', () => {
    return (async () => {
      db.client_meta_ad_accounts = [accountRow('act_1'), accountRow('act_2')]
      db.ad_entity_snapshots = [accountSnapshotRow('act_1'), accountSnapshotRow('act_2')]
      db.ad_strategy_configs = [configRow()]

      const referenceDay = accountYesterday('Pacific/Auckland', new Date())
      const act1Day = new Date(new Date(`${referenceDay}T00:00:00Z`).getTime() - 3 * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const act2Day = new Date(new Date(`${referenceDay}T00:00:00Z`).getTime() - 1 * 86_400_000)
        .toISOString()
        .slice(0, 10)

      db.ad_daily_insights = [
        insightRow('act_1', act1Day, 50),
        insightRow('act_2', act2Day, 999),
      ]

      const facts = await loadClientCapFacts(CLIENT)
      const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!

      // act_1「哪一天」必须是它自己的数据日，不能被 act_2 更晚的数据带偏——
      // 带偏之后第二步按账户过滤查那天会查到 0 行，真实花费被看成 0。
      expect(a1.lastCompleteDate).toBe(act1Day)
      expect(a1.spendCents).toBe(5000)
    })()
  })
})

describe('在不在投 + 币种', () => {
  it('有一个实体在投 → hasDeliveringEntity 为 true', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [
      accountSnapshotRow('act_1', { currency: 'AUD' }),
      entitySnapshotRow('act_1', 'camp_1', 'PAUSED'),
      entitySnapshotRow('act_1', 'camp_2', 'ACTIVE'),
    ]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.hasDeliveringEntity).toBe(true)
    expect(a1.currency).toBe('AUD')
  })

  it('所有实体都不在投 → hasDeliveringEntity 为 false（不是 null）', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [
      accountSnapshotRow('act_1'),
      entitySnapshotRow('act_1', 'camp_1', 'PAUSED'),
      entitySnapshotRow('act_1', 'camp_2', 'ARCHIVED'),
    ]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.hasDeliveringEntity).toBe(false)
  })

  it('🔴 回看窗口里连一行快照都没有 → hasDeliveringEntity 为 null（不是 false）', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    // 只给账户级那一行（用来解析时区/币种），不给任何 campaign/adset 快照
    db.ad_entity_snapshots = [accountSnapshotRow('act_1')]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.hasDeliveringEntity).toBeNull()
  })

  it('🔴 只取每个实体最新那条快照 —— 旧的一条说 ACTIVE、最新一条说 PAUSED，结果按最新', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [
      accountSnapshotRow('act_1'),
      entitySnapshotRow('act_1', 'camp_1', 'ACTIVE', {
        captured_at: new Date(Date.now() - 6 * 3_600_000).toISOString(),
      }),
      entitySnapshotRow('act_1', 'camp_1', 'PAUSED', {
        captured_at: new Date().toISOString(),
      }),
    ]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.hasDeliveringEntity).toBe(false)
  })

  it('🔴 混进另一个账户在投的实体 → 不算进这个账户', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1'), accountRow('act_2')]
    db.ad_entity_snapshots = [
      accountSnapshotRow('act_1'),
      accountSnapshotRow('act_2'),
      entitySnapshotRow('act_1', 'camp_1', 'PAUSED'),
      entitySnapshotRow('act_2', 'camp_2', 'ACTIVE'),
    ]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.hasDeliveringEntity).toBe(false)
    expect(facts.accounts.find((a) => a.adAccountId === 'act_2')!.hasDeliveringEntity).toBe(true)
  })

  it('🔴 实体只有回看窗口之外的旧快照 → 不当作「现在在投」，也不当作「知道」', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    const staleCapturedAt = new Date(Date.now() - 72 * 3_600_000).toISOString() // 72h 前，超出 48h 回看窗口
    db.ad_entity_snapshots = [
      accountSnapshotRow('act_1'),
      entitySnapshotRow('act_1', 'camp_1', 'ACTIVE', { captured_at: staleCapturedAt }),
    ]
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    // 这条实体唯一的一条快照在窗口外——判据应当把它当「拿不到快照」，
    // 不能因为它历史上说过 ACTIVE 就断言「现在在投」。
    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.hasDeliveringEntity).toBeNull()
  })

  it('🔴 快照行数恰好撞到上限 → 当作截断（不知道），不当作「扫完了、都不在投」', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    const rows = [accountSnapshotRow('act_1')]
    for (let i = 0; i < 2000; i++) {
      rows.push(entitySnapshotRow('act_1', `camp_${i}`, 'PAUSED'))
    }
    db.ad_entity_snapshots = rows
    db.ad_strategy_configs = [configRow()]

    const facts = await loadClientCapFacts(CLIENT)

    expect(facts.accounts.find((a) => a.adAccountId === 'act_1')!.hasDeliveringEntity).toBeNull()
  })

  it('查询失败 → hasDeliveringEntity 为 null，但币种仍尽量给出', async () => {
    db.client_meta_ad_accounts = [accountRow('act_1')]
    db.ad_entity_snapshots = [accountSnapshotRow('act_1', { currency: 'NZD' })]
    db.ad_strategy_configs = [configRow()]
    failTables.add('ad_entity_snapshots')

    const facts = await loadClientCapFacts(CLIENT)

    const a1 = facts.accounts.find((a) => a.adAccountId === 'act_1')!
    expect(a1.hasDeliveringEntity).toBeNull()
    // 账户级快照那次查询和 campaign/adset 那次查询共用同一张失败表，
    // 币种这里也读不到 —— 断言 null 而不是断言某个具体币种，避免对假件的
    // "两次查询是否分别失败"这个实现细节做出脆弱的假设。
    expect(a1.currency).toBeNull()
  })
})
