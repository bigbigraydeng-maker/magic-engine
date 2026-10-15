import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import {
  getAdCreativeBinding, listAccountAdCreatives, setAdCreative,
  type AccountAdCreative, type AccountAdCreativeList, type AdCreativeBinding,
} from '@/lib/meta/ad-creatives'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { ADS_ACTION_DEFINITIONS } from '@/lib/kernel/registry-ads'
import { makeReadbackVerification } from '../common'
import { createSwapCreativeCapability } from '../swap-creative'

vi.mock('@/lib/meta/ad-creatives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/ad-creatives')>()
  return {
    ...actual,
    getAdCreativeBinding: vi.fn(),
    listAccountAdCreatives: vi.fn(),
    setAdCreative: vi.fn(),
  }
})
vi.mock('@/lib/ads-strategy/config', () => ({ loadAdStrategyConfigWithSource: vi.fn() }))
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
const OLD_VIDEO = '1111111111'
const PAGE = '1616575215312482'
const OLD_CREATIVE = '900000000000001'
const NEW_CREATIVE = '900000000000009'

/** 一套买家可见文案 + 落地去向；换素材只许换视频，这些必须两边一致。 */
function spec(videoId: string, message = '14 天中国深度游', link = 'https://ctstours.co.nz/tours') {
  return {
    object_story_spec: {
      page_id: PAGE,
      video_data: {
        video_id: videoId,
        message,
        title: 'Best of China',
        call_to_action: { type: 'LEARN_MORE', value: { link } },
      },
    },
  }
}

function binding(
  over: Partial<AdCreativeBinding> = {},
  creative: Record<string, unknown> = { id: OLD_CREATIVE, ...spec(OLD_VIDEO) },
): AdCreativeBinding {
  return {
    id: AD,
    account_id: '1234567890',
    effective_status: 'ACTIVE',
    issues_info: [],
    creative_id: typeof creative.id === 'string' ? creative.id : null,
    page_id: PAGE,
    video_id: OLD_VIDEO,
    creative_raw: creative,
    ...over,
  }
}

function listed(rows: AccountAdCreative[], complete = true): AccountAdCreativeList {
  return { creatives: rows, complete, truncated_reason: complete ? null : '第 2 页返回 HTTP 500' }
}

function candidate(over: Partial<AccountAdCreative> = {}, raw = { id: NEW_CREATIVE, ...spec(VIDEO) }): AccountAdCreative {
  return {
    id: NEW_CREATIVE, name: '丝路无价版', video_id: VIDEO, page_id: PAGE, status: 'ACTIVE', raw, ...over,
  }
}

function pool(over: Record<string, unknown> = {}) {
  return {
    source: 'row' as const,
    config: {
      creative_pool: [{
        kind: 'meta_video', ref: VIDEO, status: 'approved',
        approved_by: 'bigbigraydeng@gmail.com', approved_at: '2026-10-14T00:00:00Z', ...over,
      }],
    },
  }
}

function step(
  overrides: Record<string, unknown> = {},
  priorOutputs: Record<string, Record<string, unknown>> = {},
): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey: 'apply', attempt: 1, idempotencyKey: 'test-swap', priorOutputs,
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', ad_id: AD, creative_ref: VIDEO, ...overrides },
  }
}

const capability = createSwapCreativeCapability(createFakeSupabase({}))

describe('ads.swap_creative · apply —— 只换视频，不换一个字', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue(pool() as never)
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding())
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([candidate()]))
    vi.mocked(setAdCreative).mockResolvedValue(true)
  })

  it('文案与落地去向一致时换素材，并把换前编号留给撤回', async () => {
    const result = await capability.steps.apply(step())
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', NEW_CREATIVE)
    expect(result.output).toMatchObject({
      prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE, no_change: false, applied: true,
    })
  })

  it('候选文案跟今天这条不一样时拒绝——未审过的文案不许借换素材上线', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([
      candidate({}, { id: NEW_CREATIVE, ...spec(VIDEO, '最后 3 天！仅剩 2 个位') }),
    ]))
    await expect(capability.steps.apply(step())).rejects.toThrow('文案与落地去向')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('候选落地链接不一样时拒绝', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([
      candidate({}, { id: NEW_CREATIVE, ...spec(VIDEO, '14 天中国深度游', 'https://example.com/other') }),
    ]))
    await expect(capability.steps.apply(step())).rejects.toThrow('文案与落地去向')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('目标视频不在素材池里时拒绝，且碰 Meta 之前就停', async () => {
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue(pool({ ref: '111111' }) as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('不在这个客户的素材池里')
    expect(getAdCreativeBinding).not.toHaveBeenCalled()
  })

  it('素材池里还是待批准时拒绝', async () => {
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue(pool({ status: 'candidate' }) as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('还是待批准状态')
  })

  it('标着已批准但没有批准人或批准时间时不认这条批准', async () => {
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue(pool({ approved_by: undefined }) as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('没有批准人或批准时间')
  })

  it('素材池是读库失败兜底来的空池子时按可重试处理，不报成「没批准」', async () => {
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ source: 'fallback', config: { creative_pool: [] } } as never)
    await expect(capability.steps.apply(step())).rejects.toThrow('不是「没批准」而是读失败')
  })

  it('当前广告挂的是动态素材时交人工，不静默换成单视频', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(
      binding({}, { id: OLD_CREATIVE, asset_feed_spec: { videos: [] }, ...spec(OLD_VIDEO) }),
    )
    await expect(capability.steps.apply(step())).rejects.toThrow('动态素材')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('当前广告不是单视频形态（轮播/图文）时交人工', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ video_id: null }))
    await expect(capability.steps.apply(step())).rejects.toThrow('不是单视频素材')
  })

  it('账户里只有别的主页发布的同一视频素材时拒绝，不跨主页换', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([candidate({ page_id: '999999999' })]))
    await expect(capability.steps.apply(step())).rejects.toThrow('现成素材')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('候选已归档或已删除时不挑它', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([candidate({ status: 'ARCHIVED' })]))
    await expect(capability.steps.apply(step())).rejects.toThrow('现成素材')
  })

  it('清单没取全又没命中时按可重试处理，不说「没有、请人去建」', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([], false))
    await expect(capability.steps.apply(step())).rejects.toThrow('没取全')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('清单取全了且确实没有时，才允许走非可重试的转人工', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([]))
    await expect(capability.steps.apply(step())).rejects.toThrow('请先让人建一条')
  })

  it('读不出当前素材或当前主页时停手，不碰广告', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ page_id: null }))
    await expect(capability.steps.apply(step())).rejects.toThrow('无法保证能撤回')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('Meta 返回的账户归属跟请求不一致时停手', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ account_id: '5555555555' }))
    await expect(capability.steps.apply(step())).rejects.toThrow('账户归属与本次请求不一致')
  })

  it('广告已经挂着这条视频时不重复写，并标记 no_change', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ video_id: VIDEO }))
    const result = await capability.steps.apply(step())
    expect(setAdCreative).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({ no_change: true })
  })

  it('多条都合格的候选里取编号最大的那条', async () => {
    vi.mocked(listAccountAdCreatives).mockResolvedValue(listed([
      candidate({ id: '900000000000002' }, { id: '900000000000002', ...spec(VIDEO) }),
      candidate(),
    ]))
    await capability.steps.apply(step())
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', NEW_CREATIVE)
  })

  it('ad_id 格式不对时在读任何东西之前就停', async () => {
    await expect(capability.steps.apply(step({ ad_id: 'act_abc' }))).rejects.toThrow('ad_id 格式无效')
    expect(loadAdStrategyConfigWithSource).not.toHaveBeenCalled()
  })
})

describe('ads.swap_creative · readback', () => {
  const receipt = { apply: { prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ creative_id: NEW_CREATIVE, video_id: VIDEO }))
  })

  it('产物必须带 applied——少了它每次换成功都会被判无效产物并自动撤回', async () => {
    const result = await capability.steps.readback(step({}, receipt))
    expect(result.output).toMatchObject({ applied: true })
  })

  it('把素材编号、审核状态、审核问题数一起纳入验证判据', async () => {
    await capability.steps.readback(step({}, receipt))
    expect(makeReadbackVerification).toHaveBeenCalledWith(
      { creative_id: NEW_CREATIVE, effective_status: 'ACTIVE', issue_count: 0 },
      { creative_id: NEW_CREATIVE, effective_status: 'ACTIVE', issue_count: 0 },
    )
  })

  it('换完被打回审核时，判据里的实际值不是 ACTIVE（由 Kernel 据此撤回）', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(
      binding({ creative_id: NEW_CREATIVE, video_id: VIDEO, effective_status: 'DISAPPROVED', issues_info: [{ level: 'AD' }] }),
    )
    await capability.steps.readback(step({}, receipt))
    expect(makeReadbackVerification).toHaveBeenCalledWith(
      expect.objectContaining({ effective_status: 'ACTIVE', issue_count: 0 }),
      expect.objectContaining({ effective_status: 'DISAPPROVED', issue_count: 1 }),
    )
  })

  it('读不到审核问题清单时记成 -1，不当成 0 个问题', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(
      binding({ creative_id: NEW_CREATIVE, video_id: VIDEO, issues_info: null }),
    )
    await capability.steps.readback(step({}, receipt))
    expect(makeReadbackVerification).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ issue_count: -1 }),
    )
  })

  it('没有 apply 回执时不假装验证通过', async () => {
    await expect(capability.steps.readback(step({}, {}))).rejects.toThrow('无法回读比对')
  })

  // 🔴 这条钉的是契约而不是行为：产物口径 = **最后一个成功步骤**的 output，
  //    而注册表声明了 required 字段。少一个就会在 kernel 里被判 INVALID_OUTPUT →
  //    判失败 → 自动撤回，而三个只调 steps.* 的测试全绿也看不出来（子牙复审 B1）。
  it('最后一步的产物满足注册表声明的 required 字段', async () => {
    const required = ADS_ACTION_DEFINITIONS['ads.swap_creative'].outputSchema.required ?? []
    const result = await capability.steps.readback(step({}, receipt))
    for (const key of required) {
      expect(result.output, `注册表要求产物里有 ${key}`).toHaveProperty(key)
    }
  })
})

describe('ads.swap_creative · 撤回', () => {
  const receipt = { apply: { prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdCreative).mockResolvedValue(true)
  })

  it('当前素材就是我们换上的那个时，写回换前的编号', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ creative_id: NEW_CREATIVE }))
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(setAdCreative).toHaveBeenCalledWith(AD, 'test-token', OLD_CREATIVE)
    expect(result.ok).toBe(true)
  })

  it('期间被别人改过时拒绝覆盖', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ creative_id: '900000000000077' }))
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('已被其他操作改过')
    expect(setAdCreative).not.toHaveBeenCalled()
  })

  it('没有回执、但广告已经挂上了本次要换的视频 → 如实报撤不回，要人核对', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(
      binding({ creative_id: NEW_CREATIVE, video_id: VIDEO }, { id: NEW_CREATIVE, ...spec(VIDEO) }),
    )
    const result = await capability.rollback!(step({}, {}), {})
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('撤不回去')
  })

  it('没有回执、广告挂的也不是本次要换的视频 → 这次确实没写进 Meta', async () => {
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding())
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
    vi.mocked(getAdCreativeBinding).mockResolvedValue(binding({ creative_id: NEW_CREATIVE }))
    vi.mocked(setAdCreative).mockResolvedValue(false)
    const result = await capability.rollback!(step({}, receipt), receipt)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toContain('未确认恢复')
  })
})
