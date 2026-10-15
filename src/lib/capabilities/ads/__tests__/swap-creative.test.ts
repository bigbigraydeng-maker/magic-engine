import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { getAdCreativeBinding, listAccountAdCreatives, setAdCreative } from '@/lib/meta/ad-creatives'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import { makeReadbackVerification } from '../common'
import { createSwapCreativeCapability } from '../swap-creative'

vi.mock('@/lib/meta/ad-creatives', () => ({
  getAdCreativeBinding: vi.fn(),
  listAccountAdCreatives: vi.fn(),
  setAdCreative: vi.fn(),
}))
vi.mock('@/lib/ads-strategy/config', () => ({ loadAdStrategyConfig: vi.fn() }))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({
  getRegisteredAccountIds: vi.fn(async () => ({ ids: ['1234567890'], error: null })),
}))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(() => ({ method: 'ads_readback_integrity', passed: true, checks: [] })),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

const AD = '777000111'
const VIDEO = '2069489893713349'
const PAGE = '1616575215312482'
const OLD_CREATIVE = '900000000000001'
const NEW_CREATIVE = '900000000000009'

function step(
  overrides: Partial<Record<string, unknown>> = {},
  priorOutputs: Record<string, Record<string, unknown>> = {},
): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey: 'apply',
    attempt: 1,
    idempotencyKey: 'test-swap',
    priorOutputs,
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', ad_id: AD, creative_ref: VIDEO, ...overrides },
  }
}

function pool(status: 'approved' | 'candidate', ref = VIDEO) {
  return { creative_pool: [{ kind: 'meta_video', ref, status }] }
}

const capability = createSwapCreativeCapability(createFakeSupabase({}))

describe('ads.swap_creative — 只换成已批准、账户里现成、同主页的素材', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadAdStrategyConfig).mockResolvedValue(pool('approved') as never)
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: OLD_CREATIVE, page_id: PAGE,
    })
    vi.mocked(listAccountAdCreatives).mockResolvedValue([
      { id: NEW_CREATIVE, name: '丝路无价版', video_id: VIDEO, page_id: PAGE },
    ])
    vi.mocked(setAdCreative).mockResolvedValue(true)
  })

  it('全部条件满足时换素材，并把换前编号留给撤回', async () => {
    const result = await capability.steps.apply(step())
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', NEW_CREATIVE)
    expect(result.output).toMatchObject({
      prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE, no_change: false, applied: true,
    })
  })

  it('目标视频不在素材池里时拒绝，且碰 Meta 之前就停', async () => {
    vi.mocked(loadAdStrategyConfig).mockResolvedValue(pool('approved', '111111') as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('不在这个客户的素材池里')
    expect(getAdCreativeBinding).not.toHaveBeenCalled()
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('素材池里还是待批准时拒绝', async () => {
    vi.mocked(loadAdStrategyConfig).mockResolvedValue(pool('candidate') as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('还是待批准状态')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('账户里只有别的主页发布的同一视频素材时拒绝，不跨主页换', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue([
      { id: NEW_CREATIVE, name: '别的主页', video_id: VIDEO, page_id: '999999999' },
    ])
    await expect(capability.steps.apply(step())).rejects.toThrow('现成素材')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('账户里没有现成素材时非可重试地拒绝，而不是自己建一条', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue([])
    await expect(capability.steps.apply(step())).rejects.toThrow('请先让人建一条')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('读不出当前素材或当前主页时停手，不碰广告', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: OLD_CREATIVE, page_id: null,
    })
    await expect(capability.steps.apply(step())).rejects.toThrow('无法保证能撤回')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('Meta 返回的账户归属跟请求不一致时停手', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '5555555555', effective_status: 'ACTIVE', creative_id: OLD_CREATIVE, page_id: PAGE,
    })
    await expect(capability.steps.apply(step())).rejects.toThrow('账户归属与本次请求不一致')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('广告已经挂着目标素材时不重复写，并标记 no_change', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: NEW_CREATIVE, page_id: PAGE,
    })
    const result = await capability.steps.apply(step())
    expect(setAdCreative).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({ no_change: true, new_creative_id: NEW_CREATIVE })
  })

  it('多条候选时取编号最大的那条', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue([
      { id: '900000000000002', name: '旧的', video_id: VIDEO, page_id: PAGE },
      { id: NEW_CREATIVE, name: '新的', video_id: VIDEO, page_id: PAGE },
    ])
    await capability.steps.apply(step())
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', NEW_CREATIVE)
  })

  it('ad_id 格式不对时在读任何东西之前就停', async () => {
    await expect(capability.steps.apply(step({ ad_id: 'act_abc' }))).rejects.toThrow('ad_id 格式无效')
    expect(loadAdStrategyConfig).not.toHaveBeenCalled()
  })
})

describe('ads.swap_creative — 回读', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: NEW_CREATIVE, page_id: PAGE,
    })
  })

  it('拿 apply 的回执比对 Meta 当前素材', async () => {
    const prior = { apply: { prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE } }
    await capability.steps.readback(step({}, prior))
    expect(makeReadbackVerification).toHaveBeenCalledWith(
      { creative_id: NEW_CREATIVE },
      { creative_id: NEW_CREATIVE },
    )
  })

  it('没有 apply 回执时不假装验证通过', async () => {
    await expect(capability.steps.readback(step({}, {}))).rejects.toThrow('无法回读比对')
  })
})

describe('ads.swap_creative — 撤回', () => {
  const receipt = { apply: { prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdCreative).mockResolvedValue(true)
  })

  it('当前素材就是我们换上的那个时，写回换前的编号', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: NEW_CREATIVE, page_id: PAGE,
    })
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', OLD_CREATIVE)
    expect(result.ok).toBe(true)
  })

  it('期间被别人改过时拒绝覆盖', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: '900000000000077', page_id: PAGE,
    })
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('已被其他操作改过')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('没有 apply 回执时判为没写过 Meta，不乱撤', async () => {
    const result = await capability.rollback!(step({}, {}), {})
    expect(result.ok).toBe(true)
    expect(result.rollbackKind).toBe('noop')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('读不到当前素材时如实报撤回失败，不当成撤回成功', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(null)
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('未尝试撤回')
  })

  it('Meta 没确认恢复时报失败', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue({
      id: AD, account_id: '1234567890', effective_status: 'ACTIVE', creative_id: NEW_CREATIVE, page_id: PAGE,
    })
    vi.mocked(setAdCreative).mockResolvedValue(false)
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('未确认恢复')
  })
})
