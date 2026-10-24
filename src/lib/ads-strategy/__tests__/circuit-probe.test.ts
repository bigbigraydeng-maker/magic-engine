/**
 * A0 只读熔断探针的测试。
 *
 * 第一组是本文件最要紧的：**机械地钉住「这个模块没有写入路径」**。
 * 两轮四次复审否掉「直接接上写入」的理由之一，是「默认关的开关」靠的是承诺
 * （哪天有人打开就生效）。A0 的强处在于**代码里压根没有写入那一行** ——
 * 所以这件事必须由一条扫源码的测试守着，不能由注释声明。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  probeClientCircuit,
  readDeliveringByLevel,
  resolveProbeAccountCapCents,
  CANDIDATE_ABSOLUTE_CAP_MULTIPLES,
} from '../circuit-probe'

const PROBE_FILE = join(process.cwd(), 'src/lib/ads-strategy/circuit-probe.ts')

/** 一次断言、集中一处 —— 同 `src/lib/pm-todo/__tests__/ads-account-status-items.test.ts` 的写法。 */
function asSupabase(stub: object): SupabaseClient {
  return stub as SupabaseClient
}

/** 只读探针只用 `from().select()…limit()/maybeSingle()` 两条链，替身只覆盖它们。 */
function emptyReadOnlyStub(): SupabaseClient {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = self
  api.gte = self
  api.order = self
  api.limit = () => Promise.resolve({ data: [], error: null })
  api.maybeSingle = () => Promise.resolve({ data: null, error: null })
  return asSupabase({ from: () => api })
}

describe('🔴 A0 的硬约束：这个模块不许有写入路径', () => {
  const source = readFileSync(PROBE_FILE, 'utf8')
  /** 先剥注释再判 —— 注释里本来就会出现「不写 ads_circuit_events」这类字样。 */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('源码里不出现熔断事件表', () => {
    expect(code).not.toContain('ads_circuit_events')
  })

  it.each(['.insert(', '.upsert(', '.update(', '.delete(', '.rpc('])(
    '源码里不出现写操作 %s',
    (writeCall) => {
      expect(code).not.toContain(writeCall)
    },
  )

  it('也不发任何 Inngest 事件', () => {
    expect(code).not.toContain('inngest')
    expect(code).not.toContain('sendInngestEvent')
  })
})

describe('probeClientCircuit', () => {
  it('非 bounded_auto 的客户直接跳过，并如实记原因（跳过 ≠ 没问题）', async () => {
    const out = await probeClientCircuit(emptyReadOnlyStub(), {
      clientId: 'c-1',
      autonomyMode: 'observe',
      now: new Date('2026-10-18T00:00:00Z'),
    })

    expect(out.skipped).toBe('not_bounded_auto')
    expect(out.accounts).toHaveLength(0)
    // 🔴 跳过的客户不许被记成「没超」——那会让「没观察」和「观察过没事」长得一样
    expect(out.clientCapKind).toBe('undeterminable')
    expect(out.clientCapReason).toBe('skipped:not_bounded_auto')
    expect(out.clientReferenceDate).toBeNull()
  })
})

describe('🔴 零写入要扫到传递依赖，不能只扫自己这一个文件', () => {
  /**
   * 子牙复审指出的口子：原先只扫 `circuit-probe.ts`。而 `loadClientCapFacts`
   * 与 `resolveAccountTimezone` **都不接 `sb`、内部直接用 `supabaseAdmin` 单例**，
   * 也就是说探针生产路径上大半的读是走它们的。哪天有人往 `circuit-cap-facts.ts`
   * 加一行「把算好的事实缓存进表」（它只有探针一个生产调用方，改起来看着很安全），
   * 原先那条测试照绿 —— 「零写入由测试钉住」这句话就空了一半。
   */
  const DEPS = [
    'src/lib/ads-strategy/circuit-cap-facts.ts',
    'src/lib/ads-strategy/circuit-spend-window.ts',
    'src/lib/ads-strategy/account-timezone.ts',
    'src/lib/ads-strategy/circuit-detectors.ts',
  ]

  it.each(DEPS)('%s 里也没有写操作', (rel) => {
    const src = readFileSync(join(process.cwd(), rel), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const writeCall of ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc(']) {
      expect(code, `${rel} 出现了 ${writeCall}`).not.toContain(writeCall)
    }
    expect(code).not.toContain('ads_circuit_events')
  })
})

describe('分层数「在不在投」：判不了必须是 null，不许记成 0', () => {
  /** 只覆盖 `from().select()…limit()` 这一条链，返回给定的行。 */
  function stubRows(rows: unknown[]): SupabaseClient {
    const api: Record<string, unknown> = {}
    const self = () => api
    api.select = self
    api.eq = self
    api.in = self
    api.gte = self
    api.order = self
    api.limit = () => Promise.resolve({ data: rows, error: null })
    return asSupabase({ from: () => api })
  }

  const call = (sb: SupabaseClient) =>
    readDeliveringByLevel(sb, 'c-1', 'act_x', new Date('2026-10-18T00:00:00Z'))

  it('🔴 回看窗口里零行 → 三个数全 null（连快照都拿不到 ≠ 没有在投的）', async () => {
    expect(await call(stubRows([]))).toEqual({
      deliveringCampaigns: null,
      deliveringAdsets: null,
      adsetsSeen: null,
    })
  })

  it('🔴 撞上行数上限 → 三个数全 null（数出来只会偏小，且看不出被截断）', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      entity_id: `e${i}`,
      level: 'adset',
      effective_status: 'ACTIVE',
      captured_at: '2026-10-17T00:00:00Z',
    }))
    expect(await call(stubRows(rows))).toEqual({
      deliveringCampaigns: null,
      deliveringAdsets: null,
      adsetsSeen: null,
    })
  })

  it('读失败 → 三个数全 null', async () => {
    const api: Record<string, unknown> = {}
    const self = () => api
    api.select = self
    api.eq = self
    api.in = self
    api.gte = self
    api.order = self
    api.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } })
    expect(await call(asSupabase({ from: () => api }))).toEqual({
      deliveringCampaigns: null,
      deliveringAdsets: null,
      adsetsSeen: null,
    })
  })

  it('🔴 有行时如实分层：系列在投、广告组全停 —— 这就是共享层判错的那一层', async () => {
    const rows = [
      { entity_id: 'c1', level: 'campaign', effective_status: 'ACTIVE', captured_at: '2026-10-17T02:00:00Z' },
      { entity_id: 'a1', level: 'adset', effective_status: 'PAUSED', captured_at: '2026-10-17T02:00:00Z' },
      { entity_id: 'a2', level: 'adset', effective_status: 'PAUSED', captured_at: '2026-10-17T02:00:00Z' },
      // 同一实体的旧快照：只认最新那行，不许重复计数
      { entity_id: 'a1', level: 'adset', effective_status: 'ACTIVE', captured_at: '2026-10-16T02:00:00Z' },
    ]
    expect(await call(stubRows(rows))).toEqual({
      deliveringCampaigns: 1,
      deliveringAdsets: 0,
      adsetsSeen: 2,
    })
  })
})

describe('🔴 单账户回落：跟真正的授权判据同源（envelope-facts.ts 的 perAccountCaps）', () => {
  /**
   * 钉的是纯函数 `resolveProbeAccountCapCents`，不是 `probeClientCircuit`。
   * 原因（实测）：`probeClientCircuit` 里的账户清单来自 `supabaseAdmin` 单例，
   * 替身注入不进去，所以在它上面写的用例会**空跑也绿** —— 把回落判据故意改坏
   * （永不回落）跑一遍，那种用例照样全过，等于没测。换成纯函数后，同样的
   * 变异会把下面第一条判红。
   */
  const clientCap = 10_000

  it('只登记 1 个账户且上限为空 → 回落成客户总闸', () => {
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    expect(resolveProbeAccountCapCents(rows, 'act_1', clientCap)).toBe(clientCap)
  })

  it('只登记 1 个账户但客户总闸也没设 → 还是 null，不许编一个数', () => {
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    expect(resolveProbeAccountCapCents(rows, 'act_1', null)).toBeNull()
  })

  it('只登记 1 个账户且填了自己的上限 → 用它自己的，不看总闸', () => {
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: 4_000 }]
    expect(resolveProbeAccountCapCents(rows, 'act_1', clientCap)).toBe(4_000)
  })

  it('登记 2 个账户、其中一个上限为空 → 那个仍是 null（不回落，缺口要暴露出来）', () => {
    const rows = [
      { ad_account_id: 'act_1', daily_budget_cap_cents: null },
      { ad_account_id: 'act_2', daily_budget_cap_cents: 5_000 },
    ]
    expect(resolveProbeAccountCapCents(rows, 'act_1', clientCap)).toBeNull()
    expect(resolveProbeAccountCapCents(rows, 'act_2', clientCap)).toBe(5_000)
  })

  it('问的账户根本不在登记清单里 → null（不拿别人的上限顶）', () => {
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: 4_000 }]
    expect(resolveProbeAccountCapCents(rows, 'act_other', clientCap)).toBeNull()
  })

  it('🔴 一行都没登记（legacy 客户）→ 回落成客户总闸，跟真闸第一层回落一致', () => {
    // envelope-facts.ts:113-123：零行时改用 clients.meta_ad_account_id 建账户、上限 = 客户总闸。
    // 探针的账户清单也走同一条回落，所以这里不回落就会对 legacy 客户报假阻塞（子牙/魏征复审）。
    expect(resolveProbeAccountCapCents([], 'act_legacy', clientCap)).toBe(clientCap)
  })

  it('🔴 清单里只有一个账户、但问的是清单外的账户 → null，不许拿总闸顶', () => {
    // 这一条是「低报」风险：比假阻塞更危险。真闸对清单外账户直接 unavailable。
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    expect(resolveProbeAccountCapCents(rows, 'act_other', clientCap)).toBeNull()
  })

  it.each([0, -1, 1.5, Number.NaN])('上限是 %s 这种无效值 → 当没有上限，不拿它去算硬顶', (bad) => {
    // 真闸要求安全整数且 > 0（envelope-facts.ts:122-124）。0 会让所有倍数恒判超限。
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: bad }]
    expect(resolveProbeAccountCapCents(rows, 'act_1', clientCap)).toBe(clientCap)
  })

  it('客户总闸是 0 这种无效值 → 回落也不生效，返回 null', () => {
    const rows = [{ ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    expect(resolveProbeAccountCapCents(rows, 'act_1', 0)).toBeNull()
  })

  it('🔴 接线钉死：probeClientCircuit 真的把这个函数的结果传给 probeAccount', () => {
    // 为什么用扫源码的方式：probeClientCircuit 的账户清单来自 supabaseAdmin 单例，
    // 替身注入不进去，唯一那条用例走 observe 分支提前返回，到不了调用点（魏征复审指出）。
    // 所以「判据对不对」有用例钉，「有没有接上」只能钉源码。
    const probeSource = readFileSync(PROBE_FILE, 'utf8')
    const callSite = /probeAccount\(\s*sb,\s*clientId,\s*account\.adAccountId,\s*resolveProbeAccountCapCents\(/
    expect(probeSource).toMatch(callSite)
    // 旧的那份口径（caps Map）必须已经删掉，不许留第二处
    expect(probeSource).not.toContain('caps.get(')
  })
})

describe('候选倍数清单', () => {
  it('是 1 / 3 / 5 / 6 —— 1 是为了看「拿上限本身当硬顶」有多离谱', () => {
    expect([...CANDIDATE_ABSOLUTE_CAP_MULTIPLES]).toEqual([1, 3, 5, 6])
  })

  it('🔴 不许在这里把它收成一个值', () => {
    // 只剩一个值 = 有人把它当成「选定的阈值」了，而 A0 的全部意义是先不选。
    expect(CANDIDATE_ABSOLUTE_CAP_MULTIPLES.length).toBeGreaterThan(1)
  })
})
