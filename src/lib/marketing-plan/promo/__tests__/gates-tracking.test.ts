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

  it('回执超过 36 小时 → 全灰，写明已经多少小时没更新；刚好 36 小时还算新鲜', () => {
    const stale = trackingResults(run({ receipt: { checked_at: hoursBefore(37), gates: allGreen() } }))
    for (const r of stale) {
      expect(r.light, r.key).toBe('gray')
      expect(r.reason).toContain('37')
      expect(r.reason).toContain('没更新')
    }
    const edge = trackingResults(run({ receipt: { checked_at: hoursBefore(36), gates: allGreen() } }))
    for (const r of edge) expect(r.light, r.key).toBe('green')
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
