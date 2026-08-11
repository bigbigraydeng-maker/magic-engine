import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  selectAutoRunCandidates,
  runAutoRunBatch,
  claimItem,
  releaseStaleClaims,
  backoffAfterFailure,
  backoffElapsed,
  pinnedTopicOf,
  weeklyBlogEnabledOf,
  MAX_ATTEMPTS,
  MAX_ITEMS_PER_RUN,
  CLAIM_STALE_MINUTES,
  COOLDOWN_BACKOFF_DAYS,
  type AutoRunGenerateResult,
} from './auto-run'

const NOW = new Date('2026-08-06T09:30:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

// ── 假 supabase：**按表建模**，不按调用次序 ────────────────────────────────────
// 按次序编的假件在实现多查一张表时会静默返回半成品，症状指向完全无关的地方
// （2026-08-05 真实教训）。这里的实现真的执行 eq/in/order/limit ——
// 假件吞掉 .order 参数的话，「老的排前面」那一维就是零覆盖。

type Row = Record<string, unknown>

interface FakeOpts {
  /**
   * 反向破坏用：让 clients 表上的 SQL 闸门失效（`.eq('client_status')` 和
   * `.contains(seo_config)` 变成空操作），检验 TS 那一层的客户闸是不是真的在挡。
   */
  brokenSqlClientGate?: boolean
  /** 并发用：每次 update 落地之前给测试一个改库的机会（模拟别人抢先动了这一行）。 */
  onBeforeUpdate?: (table: string) => void
}

function makeFake(tables: Record<string, Row[]>, opts: FakeOpts = {}) {
  const inserted: Record<string, Row[]> = {}

  function from(table: string) {
    if (!(table in tables)) {
      throw new Error(`fake supabase: 表 '${table}' 没建模（不许兜底返回半成品）`)
    }
    const filters: Array<(r: Row) => boolean> = []
    let order: { col: string; asc: boolean } | null = null
    let limit: number | null = null
    let mode: 'select' | 'update' | 'insert' = 'select'
    let patch: Row | null = null
    let returning = false
    const gateOff = opts.brokenSqlClientGate && table === 'clients'

    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => {
      if (mode === 'update') returning = true
      return chain()
    }
    api.eq = (col: string, val: unknown) => {
      if (!(gateOff && col === 'client_status')) filters.push((r) => r[col] === val)
      return chain()
    }
    api.in = (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]))
      return chain()
    }
    api.gte = (col: string, val: number) => {
      filters.push((r) => ((r[col] as number) ?? 0) >= val)
      return chain()
    }
    api.lt = (col: string, val: string) => {
      filters.push((r) => r[col] != null && (r[col] as string) < val)
      return chain()
    }
    api.not = (col: string, op: string, val: unknown) => {
      if (op !== 'is' || val !== null) throw new Error(`fake supabase: not(${op}) 没建模`)
      filters.push((r) => r[col] != null)
      return chain()
    }
    api.contains = (col: string, obj: Record<string, unknown>) => {
      if (!gateOff) {
        filters.push((r) =>
          Object.entries(obj).every(
            ([k, v]) => ((r[col] as Record<string, unknown>) ?? {})[k] === v,
          ),
        )
      }
      return chain()
    }
    api.order = (col: string, o?: { ascending?: boolean }) => {
      order = { col, asc: o?.ascending !== false }
      return chain()
    }
    api.limit = (n: number) => {
      limit = n
      return chain()
    }
    api.update = (p: Row) => {
      mode = 'update'
      patch = p
      return chain()
    }
    api.insert = (rows: Row | Row[]) => {
      mode = 'insert'
      inserted[table] = [...(inserted[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])]
      return chain()
    }

    function run() {
      if (mode === 'insert') return { data: null, error: null }
      if (mode === 'update') opts.onBeforeUpdate?.(table)
      let rows = tables[table].filter((r) => filters.every((f) => f(r)))
      if (order) {
        const { col, asc } = order
        rows = [...rows].sort((a, b) =>
          String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0,
        )
      }
      if (limit != null) rows = rows.slice(0, limit)
      if (mode === 'update') {
        for (const r of rows) Object.assign(r, patch)
        return { data: returning ? rows.map((r) => ({ id: r.id })) : null, error: null }
      }
      return { data: rows.map((r) => ({ ...r })), error: null }
    }

    api.then = (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve)
    return api
  }

  return { fake: { from } as unknown as SupabaseClient, inserted, tables }
}

// ── 库里那批行长什么样（照生产真实形状） ────────────────────────────────────────

function item(over: Row = {}): Row {
  return {
    id: 'item-1',
    client_id: 'oztop',
    title: '发一篇 SEO 博客',
    action_type: 'generate_blog_post',
    fix_type: 'me_auto',
    status: 'pending',
    source: 'diagnostic',
    prescription_id: 'presc-fresh',
    marketing_plan_id: null,
    steps_json: null,
    created_at: daysAgo(3),
    started_at: null,
    auto_run_attempts: 0,
    auto_run_next_at: null,
    ...over,
  }
}

function client(over: Row = {}): Row {
  return {
    id: 'oztop',
    name: 'Oztop',
    domain: 'oztop.com.au',
    client_status: 'active',
    seo_config: { weekly_blog: true },
    ...over,
  }
}

function baseTables(over: { items?: Row[]; clients?: Row[]; extraPrescriptions?: Row[] } = {}) {
  return {
    execution_items: over.items ?? [item()],
    clients: over.clients ?? [client()],
    prescriptions: [
      { id: 'presc-fresh', client_id: 'oztop', status: 'approved', approved_at: daysAgo(4), generated_at: daysAgo(5) },
      { id: 'presc-old', client_id: 'oztop', status: 'approved', approved_at: daysAgo(69), generated_at: daysAgo(70) },
      { id: 'presc-dead', client_id: 'oztop', status: 'superseded', approved_at: daysAgo(2), generated_at: daysAgo(3) },
      // 🔴 别的客户的一份新鲜方案 —— 专门喂给「跨客户错配」回归测试用，不该被任何 oztop 的动作背书
      { id: 'presc-other-client', client_id: 'some-other-client', status: 'approved', approved_at: daysAgo(1), generated_at: daysAgo(2) },
      ...(over.extraPrescriptions ?? []),
    ],
    marketing_plans: [
      { id: 'plan-done', client_id: 'oztop', status: 'completed', approved_at: daysAgo(60), end_date: daysAgo(30).slice(0, 10) },
    ],
    execution_logs: [],
  }
}

/** 每个客户各自一份新鲜方案（id 按 `presc-${clientId}`），供多客户测试各自背书自己的动作用。 */
function freshPrescriptionsFor(clientIds: string[]): Row[] {
  return clientIds.map((cid) => ({
    id: `presc-${cid}`,
    client_id: cid,
    status: 'approved',
    approved_at: daysAgo(4),
    generated_at: daysAgo(5),
  }))
}

const okGenerate = (res: Partial<AutoRunGenerateResult> = {}) => ({
  generateBlog: vi.fn(async () => ({
    outcome: 'generated',
    post_id: 'post-1',
    topic: 'spc flooring for wet areas',
    ...res,
  })),
})

// ── 小工具 ────────────────────────────────────────────────────────────────────

describe('小工具', () => {
  it('pinnedTopicOf：卡上点了名就认出来（seo 巡逻写的是 steps_json.keyword）', () => {
    expect(pinnedTopicOf({ keyword: 'spc flooring' })).toBe('spc flooring')
    expect(pinnedTopicOf({ url: 'https://x.com/a' })).toBe('https://x.com/a')
    expect(pinnedTopicOf({ keyword: '   ' })).toBeNull()
    expect(pinnedTopicOf(null)).toBeNull()
    expect(pinnedTopicOf({ rule_id: 'R1' })).toBeNull()
  })

  it('weeklyBlogEnabledOf：只有明确 true 才算开', () => {
    expect(weeklyBlogEnabledOf({ weekly_blog: true })).toBe(true)
    expect(weeklyBlogEnabledOf({ weekly_blog: 'true' })).toBe(false)
    expect(weeklyBlogEnabledOf({})).toBe(false)
    expect(weeklyBlogEnabledOf(null)).toBe(false)
  })

  it('backoffAfterFailure：2 天 → 4 天 → 停手', () => {
    expect(backoffAfterFailure(1, NOW)!.getTime() - NOW.getTime()).toBe(2 * 86_400_000)
    expect(backoffAfterFailure(2, NOW)!.getTime() - NOW.getTime()).toBe(4 * 86_400_000)
    expect(backoffAfterFailure(MAX_ATTEMPTS, NOW)).toBeNull()
  })

  it('backoffElapsed：脏时间戳不该把一条动作永久冻住', () => {
    expect(backoffElapsed(null, NOW)).toBe(true)
    expect(backoffElapsed('garbage', NOW)).toBe(true)
    expect(backoffElapsed(daysAgo(1), NOW)).toBe(true)
    expect(backoffElapsed(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(false)
  })
})

// ── 选行 ──────────────────────────────────────────────────────────────────────

describe('selectAutoRunCandidates —— 选谁、为什么不选', () => {
  it('方案还新鲜的白名单动作 → 可跑', async () => {
    const { fake } = makeFake(baseTables())
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.judged).toHaveLength(1)
    expect(r.toRun.map((t) => t.id)).toEqual(['item-1'])
  })

  it('🔴 方案 69 天前批的 → 拦下。生产里仅有的 2 件可跑动作正是这种', async () => {
    const { fake } = makeFake(baseTables({ items: [item({ prescription_id: 'presc-old' })] }))
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(0)
    expect(r.judged[0].verdict.run).toBe(false)
    if (!r.judged[0].verdict.run) expect(r.judged[0].verdict.reason).toContain('太久没复核')
  })

  it('🔴 挂在已被换掉的方案下 → 拦下', async () => {
    const { fake } = makeFake(baseTables({ items: [item({ prescription_id: 'presc-dead' })] }))
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(0)
  })

  it('🔴 跨客户错配：prescription_id 指向的方案是「别的客户」新批的（哪怕新鲜、approved）→ 当没背书拦下，不能借别的客户的方案跑这条', async () => {
    const { fake } = makeFake(
      baseTables({ items: [item({ prescription_id: 'presc-other-client' })] }),
    )
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(0)
    expect(r.judged[0].endorsement.kind).toBe('unendorsed')
    if (!r.judged[0].verdict.run) expect(r.judged[0].verdict.reason).toContain('没有任何一轮分析说过它该做')
  })

  it('🔴 没有动作类型的 114 件根本进不了候选（SQL 就筛掉了）', async () => {
    const { fake } = makeFake(baseTables({ items: [item({ action_type: null })] }))
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.judged).toHaveLength(0)
  })

  it('🔴 退避期内的不选，到期了才选', async () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString()
    const inBackoff = makeFake(baseTables({ items: [item({ auto_run_next_at: future })] }))
    expect((await selectAutoRunCandidates(inBackoff.fake, NOW)).judged).toHaveLength(0)

    const due = makeFake(baseTables({ items: [item({ auto_run_next_at: daysAgo(1) })] }))
    expect((await selectAutoRunCandidates(due.fake, NOW)).judged).toHaveLength(1)
  })

  it(`🔴 失败 ${MAX_ATTEMPTS} 次的不再选 —— 停手就是停手，不能靠人天天看着`, async () => {
    const { fake } = makeFake(
      baseTables({ items: [item({ auto_run_attempts: MAX_ATTEMPTS })] }),
    )
    expect((await selectAutoRunCandidates(fake, NOW)).judged).toHaveLength(0)
  })

  it('🔴 老的排前面 —— 反过来排会让积压永远排在队尾', async () => {
    const { fake } = makeFake(
      baseTables({
        items: [
          item({ id: 'new', created_at: daysAgo(1) }),
          item({ id: 'old', created_at: daysAgo(20) }),
        ],
      }),
    )
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.judged.map((j) => j.id)).toEqual(['old', 'new'])
  })

  it('🔴 一轮最多 3 件、每客户最多 1 件，被挤掉的要报出来（不许静默截断）', async () => {
    const items = ['a', 'b', 'c'].map((id) =>
      item({ id, client_id: 'oztop', created_at: daysAgo(10) }),
    )
    const { fake } = makeFake(baseTables({ items }))
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(1)
    expect(r.deferredByQuota).toBe(2)
  })

  it('多客户时一个客户一件，总数不超过上限', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4']
    const clients = ids.map((id) => client({ id, name: id }))
    const items = ids.map((cid) =>
      item({ id: `i-${cid}`, client_id: cid, prescription_id: `presc-${cid}`, created_at: daysAgo(5) }),
    )
    const { fake } = makeFake(baseTables({ items, clients, extraPrescriptions: freshPrescriptionsFor(ids) }))
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(MAX_ITEMS_PER_RUN)
    expect(new Set(r.toRun.map((t) => t.client_id)).size).toBe(MAX_ITEMS_PER_RUN)
  })

  it('名额可以往小调（上线首轮 ?max=1），但调不大', async () => {
    const ids = ['c1', 'c2', 'c3']
    const clients = ids.map((id) => client({ id, name: id }))
    const items = ids.map((cid) => item({ id: `i-${cid}`, client_id: cid, prescription_id: `presc-${cid}` }))
    const extraPrescriptions = freshPrescriptionsFor(ids)
    const small = makeFake(baseTables({ items, clients, extraPrescriptions }))
    expect((await selectAutoRunCandidates(small.fake, NOW, 1)).toRun).toHaveLength(1)

    const big = makeFake(baseTables({ items, clients, extraPrescriptions }))
    expect((await selectAutoRunCandidates(big.fake, NOW, 99)).toRun).toHaveLength(MAX_ITEMS_PER_RUN)
  })

  it('客户行查不回来时不动它，也不当成可跑', async () => {
    const { fake } = makeFake(baseTables({ items: [item({ client_id: 'oztop' })], clients: [] }))
    const r = await selectAutoRunCandidates(fake, NOW)
    // 客户名单为空 → 连候选都不查（性能过滤先命中）
    expect(r.judged).toHaveLength(0)
  })
})

// ── 反向破坏：客户闸门到底在不在挡 ──────────────────────────────────────────────

describe('🔴 反向破坏 —— 拆掉客户闸，潜客必须立刻冒出来', () => {
  const prospectTables = () =>
    baseTables({
      items: [item({ id: 'prospect-item', client_id: 'lead-co' })],
      clients: [client({ id: 'lead-co', name: '某潜客', client_status: 'prospect' })],
    })

  it('闸门完好时：潜客的动作根本不进候选名单', async () => {
    const { fake } = makeFake(prospectTables())
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.judged).toHaveLength(0)
  })

  it('把 SQL 那道闸拆掉 → 名单立刻多出潜客，但 TS 那道闸必须仍然拦住它', async () => {
    const { fake } = makeFake(prospectTables(), { brokenSqlClientGate: true })
    const r = await selectAutoRunCandidates(fake, NOW)
    // 多出来了 —— 证明这道闸原本真的在挡（不是恒真的装饰）
    expect(r.judged.map((j) => j.id)).toEqual(['prospect-item'])
    // 但仍然一件都不跑 —— 证明第二道闸不是摆设
    expect(r.toRun).toHaveLength(0)
    const v = r.judged[0].verdict
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('不是在服务的状态')
  })

  it('同一条动作，客户改成在服务中 → 立刻变成可跑（证明拦它的确实是客户状态）', async () => {
    const { fake } = makeFake(
      baseTables({
        items: [item({ id: 'prospect-item', client_id: 'lead-co', prescription_id: 'presc-lead-co' })],
        clients: [client({ id: 'lead-co', name: '某潜客', client_status: 'active' })],
        extraPrescriptions: freshPrescriptionsFor(['lead-co']),
      }),
    )
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun.map((t) => t.id)).toEqual(['prospect-item'])
  })

  it('🔴 客户没开周更 → 拦下（演示账号 DEMO 靠的就是这道闸）', async () => {
    const { fake } = makeFake(
      baseTables({
        items: [item({ client_id: 'demo-co' })],
        clients: [
          client({ id: 'demo-co', name: 'Harbourline Physio (DEMO)', seo_config: { weekly_blog: false } }),
        ],
      }),
      { brokenSqlClientGate: true },
    )
    const r = await selectAutoRunCandidates(fake, NOW)
    expect(r.toRun).toHaveLength(0)
    const v = r.judged[0].verdict
    if (!v.run) expect(v.reason).toContain('没开每周内容')
  })
})

// ── 认领 ──────────────────────────────────────────────────────────────────────

describe('claimItem —— 行级原子认领', () => {
  it('🔴 两个人同时抢同一条，只有一个拿得到', async () => {
    const { fake, tables } = makeFake(baseTables())
    const [a, b] = await Promise.all([
      claimItem(fake, { id: 'item-1', started_at: null }, NOW),
      claimItem(fake, { id: 'item-1', started_at: null }, NOW),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(tables.execution_items[0].status).toBe('in_progress')
  })

  it('已经不是待办状态的抢不到（返回 false，不是抛错）', async () => {
    const { fake } = makeFake(baseTables({ items: [item({ status: 'in_progress' })] }))
    expect(await claimItem(fake, { id: 'item-1', started_at: null }, NOW)).toBe(false)
  })

  it('认领时写自己的时间戳，第一次开工才补 started_at', async () => {
    const { fake, tables } = makeFake(baseTables())
    await claimItem(fake, { id: 'item-1', started_at: null }, NOW)
    expect(tables.execution_items[0].auto_run_started_at).toBe(NOW.toISOString())
    expect(tables.execution_items[0].started_at).toBe(NOW.toISOString())

    const already = makeFake(baseTables({ items: [item({ started_at: daysAgo(9) })] }))
    await claimItem(already.fake, { id: 'item-1', started_at: daysAgo(9) }, NOW)
    // 人上次开工的时刻不覆盖
    expect(already.tables.execution_items[0].started_at).toBe(daysAgo(9))
  })
})

describe('releaseStaleClaims —— 只捡自己掉的，不碰人手拖过去的卡', () => {
  it('🔴 库里那 20 件僵尸（两个开工时间列都是 NULL）一件都不许碰', async () => {
    const zombie = item({
      id: 'zombie',
      status: 'in_progress',
      auto_run_started_at: null,
      generation_started_at: null,
      created_at: daysAgo(65),
    })
    const { fake, tables } = makeFake(baseTables({ items: [zombie] }))
    expect(await releaseStaleClaims(fake, NOW)).toBe(0)
    expect(tables.execution_items[0].status).toBe('in_progress')
  })

  it('自己认领超时的放回待办，并记一次失败', async () => {
    const stuck = item({
      id: 'mine',
      status: 'in_progress',
      auto_run_started_at: new Date(NOW.getTime() - (CLAIM_STALE_MINUTES + 30) * 60_000).toISOString(),
      auto_run_attempts: 0,
    })
    const { fake, tables } = makeFake(baseTables({ items: [stuck] }))
    expect(await releaseStaleClaims(fake, NOW)).toBe(1)
    const row = tables.execution_items[0]
    expect(row.status).toBe('pending')
    expect(row.auto_run_attempts).toBe(1)
    expect(row.auto_run_started_at).toBeNull()
    expect(String(row.auto_run_error)).toContain('中断')
  })

  it('刚认领没多久的不动', async () => {
    const fresh = item({
      id: 'fresh',
      status: 'in_progress',
      auto_run_started_at: new Date(NOW.getTime() - 60_000).toISOString(),
    })
    const { fake } = makeFake(baseTables({ items: [fresh] }))
    expect(await releaseStaleClaims(fake, NOW)).toBe(0)
  })
})

// ── 跑一轮 ────────────────────────────────────────────────────────────────────

describe('runAutoRunBatch —— 空跑', () => {
  it('🔴 空跑一行都不写：不认领、不生成、不改状态', async () => {
    const { fake, tables, inserted } = makeFake(baseTables())
    const deps = okGenerate()
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: true })

    expect(deps.generateBlog).not.toHaveBeenCalled()
    expect(tables.execution_items[0].status).toBe('pending')
    expect(tables.execution_items[0].auto_run_started_at).toBeUndefined()
    expect(inserted.execution_logs).toBeUndefined()
    expect(r.dry_run).toBe(true)
    expect(r.runnable).toBe(1)
    expect(r.generated).toBe(0)
  })

  it('空跑要把每条的判定原样给人看（人眼确认名单就靠这个）', async () => {
    const { fake } = makeFake(
      baseTables({
        items: [item({ id: 'ok' }), item({ id: 'old', prescription_id: 'presc-old' })],
      }),
    )
    const r = await runAutoRunBatch(fake, okGenerate(), NOW, { dryRun: true })
    expect(r.verdicts).toHaveLength(2)
    expect(r.verdicts.find((v) => v.id === 'ok')!.verdict).toBe('run')
    const blocked = r.verdicts.find((v) => v.id === 'old')!
    expect(blocked.verdict).toBe('blocked')
    expect(blocked.reason).toContain('太久没复核')
    expect(blocked.client).toBe('Oztop')
  })
})

describe('runAutoRunBatch —— 真跑', () => {
  it('成功：动作标完成、写一条工作日志、退避计数清零', async () => {
    const { fake, tables, inserted } = makeFake(baseTables())
    const deps = okGenerate()
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })

    expect(r.generated).toBe(1)
    const row = tables.execution_items[0]
    expect(row.status).toBe('completed')
    expect(row.auto_run_started_at).toBeNull()
    expect(row.auto_run_attempts).toBe(0)
    expect(inserted.execution_logs).toHaveLength(1)
    const log = inserted.execution_logs[0]
    expect(log.client_id).toBe('oztop')
    expect(String(log.content)).toContain('草稿')
    expect(String(log.content)).toContain('还没发布')
  })

  it('🔴 「这周已经有文章了」不算失败 —— 计成失败的话三个正常星期就能停掉一条好动作', async () => {
    const { fake, tables } = makeFake(baseTables())
    const deps = { generateBlog: vi.fn(async () => ({ outcome: 'skipped_recent_post' })) }
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })

    expect(r.failed).toBe(0)
    const row = tables.execution_items[0]
    expect(row.status).toBe('pending')
    expect(row.auto_run_attempts).toBe(0)
    // 等冷却期过完再来，别每天白跑
    const waitDays = (Date.parse(row.auto_run_next_at as string) - NOW.getTime()) / 86_400_000
    expect(waitDays).toBe(COOLDOWN_BACKOFF_DAYS)
  })

  it('失败：放回待办 + 计一次数 + 压 2 天退避', async () => {
    const { fake, tables } = makeFake(baseTables())
    const deps = { generateBlog: vi.fn(async () => ({ outcome: 'error', error: 'AI 超时' })) }
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })

    expect(r.failed).toBe(1)
    const row = tables.execution_items[0]
    expect(row.status).toBe('pending')
    expect(row.auto_run_attempts).toBe(1)
    expect(row.auto_run_error).toBe('AI 超时')
    expect((Date.parse(row.auto_run_next_at as string) - NOW.getTime()) / 86_400_000).toBe(2)
  })

  it('生成器直接抛异常也当失败处理，不让整轮挂掉', async () => {
    const { fake, tables } = makeFake(baseTables())
    const deps = {
      generateBlog: vi.fn(async () => {
        throw new Error('boom')
      }),
    }
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })
    expect(r.failed).toBe(1)
    expect(tables.execution_items[0].auto_run_error).toBe('boom')
  })

  it(`🔴 第 ${MAX_ATTEMPTS} 次失败后停手：不再排下次，等人`, async () => {
    const { fake, tables } = makeFake(
      baseTables({ items: [item({ auto_run_attempts: MAX_ATTEMPTS - 1 })] }),
    )
    const deps = { generateBlog: vi.fn(async () => ({ outcome: 'error', error: '又挂了' })) }
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })

    expect(r.results[0].outcome).toBe('gave_up')
    const row = tables.execution_items[0]
    expect(row.auto_run_attempts).toBe(MAX_ATTEMPTS)
    expect(row.auto_run_next_at).toBeNull()
  })

  it('🔴 选完之后、认领之前被别人拿走 → 跳过而不是失败，更不能照跑', async () => {
    // 这是真实并发下唯一会走到的分支：候选是几毫秒前的快照，认领时才知道还在不在。
    const { fake, tables } = makeFake(baseTables(), {
      onBeforeUpdate: (table) => {
        if (table === 'execution_items') {
          // FDE 在这一瞬间把卡拖走了
          tables.execution_items[0].status = 'skipped'
        }
      },
    })
    const deps = okGenerate()
    const r = await runAutoRunBatch(fake, deps, NOW, { dryRun: false })

    expect(r.results[0].outcome).toBe('skipped_not_claimed')
    expect(r.generated).toBe(0)
    expect(r.failed).toBe(0)
    // 🔴 最要紧的一条：没抢到就绝不能还去生成
    expect(deps.generateBlog).not.toHaveBeenCalled()
    // 人拖走的状态没被我们改回去
    expect(tables.execution_items[0].status).toBe('skipped')
  })

  it('已经在进行中的连候选都不是', async () => {
    const taken = makeFake(baseTables({ items: [item({ status: 'in_progress' })] }))
    const r = await runAutoRunBatch(taken.fake, okGenerate(), NOW, { dryRun: false })
    expect(r.considered).toBe(0)
  })
})

// ── 反向断言：这条线永远只产草稿 ────────────────────────────────────────────────

describe('🔴 反向断言 —— 自动执行不许把东西发出去', () => {
  it('自动执行模块本身不碰任何发布/CMS/GitHub 代码', () => {
    const src = readFileSync(path.join(__dirname, 'auto-run.ts'), 'utf8')
    for (const forbidden of ['@/lib/cms', 'github', 'publish', 'publer']) {
      expect(src.toLowerCase().includes(forbidden), `auto-run.ts 里出现了 ${forbidden}`).toBe(false)
    }
  })

  it('cron 接口只接周更那一条生成线，不自己拼生成逻辑', () => {
    const route = readFileSync(
      path.join(__dirname, '../../app/api/cron/execution-auto-run/route.ts'),
      'utf8',
    )
    expect(route).toContain('generateWeeklyBlogForClient')
    for (const forbidden of ['@/lib/cms', 'GithubClient', 'publishBlog']) {
      expect(route.includes(forbidden), `route.ts 里出现了 ${forbidden}`).toBe(false)
    }
  })

  it('成功路径写进库的只有「动作完成」和一条日志 —— blog_posts 由生成线自己写', async () => {
    const { fake, inserted } = makeFake(baseTables())
    await runAutoRunBatch(fake, okGenerate(), NOW, { dryRun: false })
    // 这个模块自己没往 blog_posts 写过任何东西（写了的话假件会因为表没建模直接抛）
    expect(Object.keys(inserted)).toEqual(['execution_logs'])
  })
})
