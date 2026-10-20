/**
 * loadPromoFacts 的「现读预算门」开关：
 *   · 批准 / 看板 / 派广告任务前的复查传 { liveBudget: true } → 追踪回执读取函数拿到「现读」回调；
 *   · 不传（每日对账之类后台任务）→ 拿不到，只读存档，不去打 Meta；
 *   · 计划里没有广告步骤 → 不需要预算门，传了也不现读。
 * 现读回调用的依赖：当前时间、全局 fetch、库、令牌解析（只返回令牌字符串，没有令牌 = null）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  loadTracking: vi.fn(),
  readLive: vi.fn(),
  resolveToken: vi.fn(),
  admin: { from: () => ({}) },
}))

vi.mock('@/lib/supabase', () => {
  const from = () => {
    const b: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit', 'eq', 'in', 'gte', 'lte', 'lt', 'contains']) b[method] = () => b
    b.maybeSingle = async () => ({ data: null, error: null })
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 })
    return b
  }
  m.admin.from = from
  return { supabaseAdmin: m.admin }
})
vi.mock('@/lib/ads-tracking-preflight/load-receipt', () => ({ loadTrackingGateFacts: m.loadTracking }))
vi.mock('@/lib/ads-tracking-preflight/live-budget', () => ({ readLiveBudgetGateCached: m.readLive }))
vi.mock('@/lib/meta/token-selection', () => ({ resolveMetaToken: m.resolveToken }))

import { loadPromoFacts } from '../facts'
import { baseSpec } from './fixtures'

const NOW = new Date('2026-11-12T03:00:00Z')

type LoadOptions = { now?: Date; readLiveBudget?: (clientId: string) => Promise<unknown> }

const optionsPassed = (): LoadOptions => m.loadTracking.mock.calls[0][2]

beforeEach(() => {
  vi.clearAllMocks()
  m.loadTracking.mockResolvedValue(undefined)
  m.readLive.mockResolvedValue(null)
})

describe('loadPromoFacts · liveBudget 开关', () => {
  it('不传 → 追踪回执读取函数拿不到现读回调（后台任务只读存档，不去打 Meta），但带着判过期用的当前时间', async () => {
    await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(m.loadTracking).toHaveBeenCalledTimes(1)
    expect(m.loadTracking.mock.calls[0][1]).toBe('client-1')
    expect(optionsPassed()).toEqual({ now: NOW })
    expect(optionsPassed().readLiveBudget).toBeUndefined()
  })

  it('liveBudget: false → 同样不现读', async () => {
    await loadPromoFacts('client-1', baseSpec(), [], NOW, { liveBudget: false })
    expect(optionsPassed().readLiveBudget).toBeUndefined()
  })

  it('🔴 liveBudget: true 且计划里有广告步骤 → 给现读回调；回调用当前时间、全局 fetch、库去读', async () => {
    await loadPromoFacts('client-1', baseSpec(), [], NOW, { liveBudget: true })
    const { readLiveBudget } = optionsPassed()
    expect(typeof readLiveBudget).toBe('function')

    await readLiveBudget?.('client-1')
    expect(m.readLive).toHaveBeenCalledTimes(1)
    const [clientId, deps] = m.readLive.mock.calls[0]
    expect(clientId).toBe('client-1')
    expect(deps.now).toBe(NOW)
    expect(deps.fetcher).toBe(fetch)
    expect(deps.supabase).toBe(m.admin)
  })

  it('现读回调里的令牌解析：只往外给令牌字符串；解析不出来 = null（读取函数据此一个 Meta 请求都不发）', async () => {
    await loadPromoFacts('client-1', baseSpec(), [], NOW, { liveBudget: true })
    await optionsPassed().readLiveBudget?.('client-1')
    const { resolveMetaToken } = m.readLive.mock.calls[0][1]

    m.resolveToken.mockResolvedValueOnce({ token: 'tok-1', source: 'x' })
    await expect(resolveMetaToken('client-1')).resolves.toBe('tok-1')
    expect(m.resolveToken.mock.calls[0][0]).toBe(m.admin)
    expect(m.resolveToken.mock.calls[0][1]).toBe('client-1')

    m.resolveToken.mockResolvedValueOnce(null)
    await expect(resolveMetaToken('client-1')).resolves.toBeNull()
  })

  it('计划里没有广告步骤 → 不需要预算门，传了 liveBudget 也不现读', async () => {
    const spec = baseSpec()
    const noAds = { ...spec, phases: spec.phases.map(p => ({ ...p, steps: p.steps.filter(s => s.kind !== 'ads_campaign') })) }
    await loadPromoFacts('client-1', noAds, [], NOW, { liveBudget: true })
    expect(optionsPassed().readLiveBudget).toBeUndefined()
  })
})
