/**
 * 诊断输入加载器 · 广告设置读失败必须抛，不能塌成默认值。
 *
 * 塌成默认值时 digestRecipients 是空列表，「日报收件人混了外部邮箱」那条 D7
 * 会静默漏报，而且没有任何地方记下「今天其实没读到设置」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAdStrategyConfigWithSource: vi.fn(),
  loadOutcomeConfig: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: { facebook_page_id: 'page-1' }, error: null }),
  }
  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table !== 'clients') throw new Error(`fake supabase: 表 '${table}' 没建模`)
        return builder
      },
    },
  }
})
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/entity-settings', () => ({ fetchHourlyAdsetSpend: vi.fn() }))
// 没有广告账户：只测客户级的三路读取，不进逐账户加载。
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getClientAdAccountIds: async () => [],
  findSharedAdAccounts: async () => ({ shared: new Set<string>() }),
}))
vi.mock('@/lib/ads-strategy/config', () => ({ loadAdStrategyConfigWithSource: mocks.loadAdStrategyConfigWithSource }))
vi.mock('../../outcome-config', () => ({ loadOutcomeConfig: mocks.loadOutcomeConfig }))

import { loadDiagnosisInput } from '../loader'
import { emptyOutcomeConfig } from '../../outcome-ladder'

function strategyConfig(digestRecipients: string[]) {
  return {
    client_id: 'client-1',
    enabled: true,
    digest_recipients: digestRecipients,
    daily_budget_cap_cents: null,
    autonomy_mode: 'observe' as const,
    creative_pool: [],
    autopilot_enabled: false,
    autopilot_dry_run: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadOutcomeConfig.mockResolvedValue({ config: emptyOutcomeConfig(), source: 'no_row' })
})

describe('loadDiagnosisInput — 广告设置读取', () => {
  it('🔴 读失败 → 抛错并带原始报错，不拿默认值（空收件人）继续诊断', async () => {
    mocks.loadAdStrategyConfigWithSource.mockResolvedValue({
      config: strategyConfig([]), source: 'fallback', error: 'column "creative_pool" does not exist',
    })
    await expect(loadDiagnosisInput('client-1', '2026-09-21', '2026-09-22T00:00:00Z'))
      .rejects.toThrow('ad_strategy_configs read failed: column "creative_pool" does not exist')
  })

  it('读成功 → 收件人照配置透传', async () => {
    mocks.loadAdStrategyConfigWithSource.mockResolvedValue({ config: strategyConfig(['a@x.com']), source: 'row' })
    const input = await loadDiagnosisInput('client-1', '2026-09-21', '2026-09-22T00:00:00Z')
    expect(input.digestRecipients).toEqual(['a@x.com'])
    expect(input.clientPageId).toBe('page-1')
  })

  it('调用方已经读到收件人并传进来 → 不再读广告设置（那次重读就算会失败也不影响）', async () => {
    mocks.loadAdStrategyConfigWithSource.mockResolvedValue({ config: strategyConfig([]), source: 'fallback', error: 'timeout' })
    const input = await loadDiagnosisInput('client-1', '2026-09-21', '2026-09-22T00:00:00Z', { digestRecipients: ['b@x.com'] })
    expect(input.digestRecipients).toEqual(['b@x.com'])
    expect(mocks.loadAdStrategyConfigWithSource).not.toHaveBeenCalled()
  })

  it('没有设置行（新客户）→ 照默认值走，不抛', async () => {
    mocks.loadAdStrategyConfigWithSource.mockResolvedValue({ config: strategyConfig([]), source: 'default' })
    const input = await loadDiagnosisInput('client-1', '2026-09-21', '2026-09-22T00:00:00Z')
    expect(input.digestRecipients).toEqual([])
  })
})
