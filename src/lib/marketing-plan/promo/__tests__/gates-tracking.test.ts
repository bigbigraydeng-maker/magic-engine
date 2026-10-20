/**
 * 推广计划检查清单里的「追踪与环境就绪」门（tracking.* / env.*）。
 * 灯来自开投前追踪检查函数留下的回执，不在这里现算；这里只管：
 *   · 客户没配置追踪检查 → 清单里没有这几道门（不适用，不是灰）
 *   · 配置了但没回执 / 回执太旧 → 全灰（硬门灰 = 不能批准），不当成绿
 *   · 回执新鲜 → 灯、原因、怎么办原样带过来；不适用的门不出现
 */
import { describe, expect, it } from 'vitest'
import { blockers, GATE_KEYS, type GateKey, type GateResult } from '../gates'
import { baseSpec, evaluateApproval, evaluatePhaseGates, goodFacts, NOW } from './fixtures'
import { GATE_LABELS } from '@/lib/ads-tracking-preflight/judge'
import { HARD_GATE, PREFLIGHT_GATE_KEYS, type PreflightGateKey, type TrackingGateReceipt } from '@/lib/ads-tracking-preflight/types'

const hoursBefore = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function receiptGate(key: PreflightGateKey, status: TrackingGateReceipt['status'], over: Partial<TrackingGateReceipt> = {}): TrackingGateReceipt {
  return { key, status, reason: `原因-${key}`, how: `怎么办-${key}`, evidence: {}, as_of: hoursBefore(2), hard: HARD_GATE[key], ...over }
}

const allGreen = (): TrackingGateReceipt[] => PREFLIGHT_GATE_KEYS.map(k => receiptGate(k, 'green', { how: '' }))

const isPreflightKey = (key: GateKey): key is PreflightGateKey => (PREFLIGHT_GATE_KEYS as readonly string[]).includes(key)

const trackingResults = (results: readonly GateResult[]) =>
  results.filter((r): r is GateResult & { key: PreflightGateKey } => isPreflightKey(r.key))

function run(tracking: ReturnType<typeof goodFacts>['tracking']) {
  const spec = baseSpec()
  return evaluatePhaseGates(spec, spec.phases[0], goodFacts({ tracking }))
}

describe('词表', () => {
  it('十道追踪 / 环境门都进了封闭的 GATE_KEYS', () => {
    for (const key of PREFLIGHT_GATE_KEYS) expect(GATE_KEYS).toContain(key)
  })
})

describe('客户没配置追踪检查（facts.tracking 为 undefined）', () => {
  it('清单里一道追踪门都没有——老客户的批准流程一点没变', () => {
    expect(trackingResults(run(undefined))).toEqual([])
  })
})

describe('配置了追踪检查，但还没有可用回执', () => {
  it('没有回执 → 十道门全灰，写明原因，硬门灰会挡住批准', () => {
    const results = trackingResults(run({ receipt: null }))
    expect(results.map(r => r.key)).toEqual([...PREFLIGHT_GATE_KEYS])
    for (const r of results) {
      expect(r.light, r.key).toBe('gray')
      expect(r.reason).toContain('回执')
      expect(r.how.length).toBeGreaterThan(0)
      expect(r.hard).toBe(HARD_GATE[r.key])
      expect(r.label).toBe(GATE_LABELS[r.key])
    }
    const spec = baseSpec()
    const verdict = evaluateApproval(spec, goodFacts({ tracking: { receipt: null } }))
    expect(blockers(trackingResults(verdict.results)).map(b => b.key)).toEqual(
      PREFLIGHT_GATE_KEYS.filter(k => HARD_GATE[k]),
    )
  })

  it('回执超过 36 小时 → 全灰，写明已经多少小时没更新；刚好 36 小时：除「广告账户与付款」外还算新鲜（预算那道门另算，见下）', () => {
    const stale = trackingResults(run({ receipt: { checked_at: hoursBefore(37), gates: allGreen() } }))
    for (const r of stale) {
      expect(r.light, r.key).toBe('gray')
      expect(r.reason).toContain('37')
      expect(r.reason).toContain('没更新')
    }
    const edge = trackingResults(run({ receipt: { checked_at: hoursBefore(36), gates: allGreen() } }))
    for (const r of edge.filter(x => x.key !== 'env.account_billing')) expect(r.light, r.key).toBe('green')
  })

  it('🔴 「广告账户与付款」读的是现在在投的预算，要现读：回执超过 12 小时这一道就灰（别的门仍按 36 小时）；刚好 12 小时还算新鲜；灰会挡住批准', () => {
    const at13 = trackingResults(run({ receipt: { checked_at: hoursBefore(13), gates: allGreen() } }))
    const budget13 = at13.find(r => r.key === 'env.account_billing')
    expect(budget13).toMatchObject({ light: 'gray', hard: true })
    expect(budget13?.reason).toContain('13')
    expect(budget13?.reason).toContain('预算')
    expect(budget13?.how).toContain('trigger')
    for (const r of at13.filter(x => x.key !== 'env.account_billing')) expect(r.light, r.key).toBe('green')

    const at12 = trackingResults(run({ receipt: { checked_at: hoursBefore(12), gates: allGreen() } }))
    for (const r of at12) expect(r.light, r.key).toBe('green')

    const verdict = evaluateApproval(baseSpec(), goodFacts({ tracking: { receipt: { checked_at: hoursBefore(13), gates: allGreen() } } }))
    expect(verdict.blockers.map(b => b.key)).toContain('env.account_billing')
  })

  it('回执时间读不懂 → 当作过期（灰），不当成新鲜', () => {
    const results = trackingResults(run({ receipt: { checked_at: 'garbage', gates: allGreen() } }))
    for (const r of results) expect(r.light).toBe('gray')
  })
})

describe('回执新鲜', () => {
  const fresh = (gates: TrackingGateReceipt[]) => ({ receipt: { checked_at: hoursBefore(5), gates } })

  it('灯、原因、怎么办原样带过来；硬 / 软取自词表；取数时间取回执里那道门的', () => {
    const gates = allGreen().map(g => (g.key === 'tracking.pixel_alive' ? receiptGate('tracking.pixel_alive', 'red') : g))
    const results = trackingResults(run(fresh(gates)))
    const pixel = results.find(r => r.key === 'tracking.pixel_alive')
    expect(pixel).toMatchObject({
      light: 'red', hard: true, reason: '原因-tracking.pixel_alive', how: '怎么办-tracking.pixel_alive',
      label: GATE_LABELS['tracking.pixel_alive'], group: 'tool', as_of: hoursBefore(2),
    })
    expect(results.filter(r => r.light === 'green')).toHaveLength(9)
  })

  it('硬门红会挡住批准，软门红 / 黄只提醒', () => {
    const hardRed = fresh(allGreen().map(g => (g.key === 'tracking.landing_ok' ? receiptGate('tracking.landing_ok', 'red') : g)))
    const v1 = evaluateApproval(baseSpec(), goodFacts({ tracking: hardRed }))
    expect(v1.blockers.map(b => b.key)).toContain('tracking.landing_ok')

    const softRed = fresh(allGreen().map(g => (g.key === 'tracking.capi_ready' ? receiptGate('tracking.capi_ready', 'red') : g)))
    const v2 = evaluateApproval(baseSpec(), goodFacts({ tracking: softRed }))
    expect(v2.blockers.map(b => b.key)).not.toContain('tracking.capi_ready')
  })

  it('「不适用」的门不出现在清单里', () => {
    const gates = allGreen().map(g => (g.key === 'tracking.lead_reaches_crm' ? receiptGate('tracking.lead_reaches_crm', 'gray', { na: true, hard: false }) : g))
    const keys = trackingResults(run(fresh(gates))).map(r => r.key)
    expect(keys).not.toContain('tracking.lead_reaches_crm')
    expect(keys).toHaveLength(9)
  })

  it('回执里少了某一道门 → 那一道灰（没证据不等于绿），其余照常', () => {
    const gates = allGreen().filter(g => g.key !== 'env.account_billing')
    const results = trackingResults(run(fresh(gates)))
    expect(results.find(r => r.key === 'env.account_billing')?.light).toBe('gray')
    expect(results.find(r => r.key === 'tracking.pixel_alive')?.light).toBe('green')
  })
})

describe('只在有广告步骤的阶段出现', () => {
  it('阶段里没有广告步骤 → 追踪门不出现，哪怕配置了', () => {
    const spec = baseSpec()
    const noAds = { ...spec.phases[0], steps: spec.phases[0].steps.filter(s => s.kind !== 'ads_campaign') }
    const results = evaluatePhaseGates(spec, noAds, goodFacts({ tracking: { receipt: null } }))
    expect(trackingResults(results)).toEqual([])
  })
})

describe('批准 / 看板现读的预算门（facts.tracking.live_budget）', () => {
  const KEY = 'env.account_billing'
  const liveGate = (status: TrackingGateReceipt['status'], over: Partial<TrackingGateReceipt> = {}): TrackingGateReceipt =>
    receiptGate(KEY, status, { as_of: NOW.toISOString(), reason: '现读-原因', how: '现读-怎么办', ...over })
  const budgetOf = (tracking: ReturnType<typeof goodFacts>['tracking']) => trackingResults(run(tracking)).find(r => r.key === KEY)
  const staleReceipt = { checked_at: hoursBefore(20), gates: allGreen() }

  it('🔴 存档过期、但现读到了 → 用现读的这一份（灯、原因、怎么办、读取时间都是现读的），晚上不再永远灰；别的门仍按存档', () => {
    const tracking = { receipt: staleReceipt, client_id: 'client-1', live_budget: liveGate('green') }
    expect(budgetOf(tracking)).toMatchObject({ light: 'green', reason: '现读-原因', how: '现读-怎么办', as_of: NOW.toISOString(), hard: true })
    // 存档 20 小时：别的门没到 36 小时，照存档
    for (const r of trackingResults(run(tracking)).filter(x => x.key !== KEY)) expect(r.light, r.key).toBe('green')
    expect(evaluateApproval(baseSpec(), goodFacts({ tracking })).blockers.map(b => b.key)).not.toContain(KEY)
  })

  it('现读到的是红 / 灰 → 照现读的灯，会挡批准（现读不是放行通道）', () => {
    for (const status of ['red', 'gray'] as const) {
      const tracking = { receipt: staleReceipt, live_budget: liveGate(status) }
      expect(budgetOf(tracking)?.light, status).toBe(status)
      expect(evaluateApproval(baseSpec(), goodFacts({ tracking })).blockers.map(b => b.key), status).toContain(KEY)
    }
  })

  it('完全没有存档（receipt 为 null）也能用现读的预算门；别的九道门仍是灰', () => {
    const results = trackingResults(run({ receipt: null, live_budget: liveGate('green') }))
    expect(results.find(r => r.key === KEY)?.light).toBe('green')
    for (const r of results.filter(x => x.key !== KEY)) expect(r.light, r.key).toBe('gray')
  })

  it('🔴 现读的读取时间不新鲜 / 没写读取时间 → 不采用（回到存档的判法），不会被一份旧的“现读”骗过', () => {
    for (const asOf of [hoursBefore(13), null]) {
      const tracking = { receipt: staleReceipt, live_budget: liveGate('green', { as_of: asOf }) }
      const r = budgetOf(tracking)
      expect(r?.light, String(asOf)).toBe('gray')
      expect(r?.reason, String(asOf)).toContain('20')
    }
  })

  it('🔴 想现读但没读成（live_budget 为 null）+ 存档过期 / 没有存档 → 灰，写明“刚才试过现读也没读成”，怎么办带客户编号和触发接口', () => {
    const stale = budgetOf({ receipt: staleReceipt, client_id: 'client-1', live_budget: null })
    expect(stale).toMatchObject({ light: 'gray', hard: true })
    expect(stale?.reason).toContain('20')
    expect(stale?.reason).toContain('现读')
    expect(stale?.reason).toContain('没读成')
    expect(stale?.how).toContain('client-1')
    expect(stale?.how).toContain('/api/admin/ads-tracking-preflight/trigger')

    const none = budgetOf({ receipt: null, client_id: 'client-1', live_budget: null })
    expect(none?.light).toBe('gray')
    expect(none?.reason).toContain('没读成')
    expect(none?.how).toContain('client-1')
  })

  it('现读没读成、但存档够新 → 仍按存档的灯（存档里的红不会因为这次没读成就消失）', () => {
    const red = { checked_at: hoursBefore(2), gates: allGreen().map(g => (g.key === KEY ? receiptGate(KEY, 'red') : g)) }
    const r = budgetOf({ receipt: red, live_budget: null })
    expect(r).toMatchObject({ light: 'red', reason: `原因-${KEY}` })
  })

  it('没要求现读（live_budget 不存在）+ 存档过期 → 老样子灰；提示里带上客户编号，开发拿去就能用', () => {
    const r = budgetOf({ receipt: staleReceipt, client_id: 'client-1' })
    expect(r?.light).toBe('gray')
    expect(r?.reason).not.toContain('现读也没读成')
    expect(r?.how).toContain('client-1')
    expect(r?.how).toContain('/api/admin/ads-tracking-preflight/trigger')
    // 没有客户编号时给占位，不写 undefined
    const anon = budgetOf({ receipt: staleReceipt })
    expect(anon?.how).toContain('<本客户编号>')
    expect(anon?.how).not.toContain('undefined')
  })

  it('现读结果只影响预算这一道：其它门的灯不会被它改动', () => {
    const tracking = { receipt: { checked_at: hoursBefore(2), gates: allGreen() }, live_budget: liveGate('red') }
    const results = trackingResults(run(tracking))
    expect(results.find(r => r.key === KEY)?.light).toBe('red')
    expect(results.filter(r => r.key !== KEY).every(r => r.light === 'green')).toBe(true)
  })
})
