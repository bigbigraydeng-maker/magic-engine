/**
 * 每日扫描的测试。
 *
 * 重点只有两件事：
 *   1. 「查不出来」绝不能被记成「没问题」—— 本仓反复踩的同一个坑。
 *   2. 一个客户 / 一个广告组炸掉，不能让其余的今天都不扫。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
}))
vi.mock('@/lib/meta/readback', () => ({
  listActiveAdSets: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
}))
// 2026-09-13：sweepAllClients 现在还要查每个客户名下的完整账户列表，候选客户
// 名单也换成同时看老列 + 新表的 getActiveClientsWithMetaAccounts。
// 默认给一个账户，让改动前就有的测试不用逐个改期望值。
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getClientAdAccountIds: vi.fn(),
  getActiveClientsWithMetaAccounts: vi.fn(),
}))

import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listActiveAdSets, fetchAdCreativesReadback } from '@/lib/meta/readback'
import { getClientAdAccountIds, getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import { sweepClient, sweepAllClients, blockerSummary } from '../readback-sweep'

const mockToken = vi.mocked(getMetaTokenForClient)
const mockList = vi.mocked(listActiveAdSets)
const mockCreatives = vi.mocked(fetchAdCreativesReadback)
const mockAccountIds = vi.mocked(getClientAdAccountIds)
const mockActiveClients = vi.mocked(getActiveClientsWithMetaAccounts)

const CLIENT = { id: 'c1', name: 'Roman', meta_ad_account_id: 'act_123' }

beforeEach(() => {
  vi.resetAllMocks()
  mockToken.mockResolvedValue('tok')
  // 默认：每个客户名下就登记着自己那一个账户，跟改动前行为一致。
  mockAccountIds.mockImplementation(async (clientId: string) =>
    clientId === 'c1' ? ['act_1'] : clientId === 'c2' ? ['act_2'] : [],
  )
})

describe('sweepClient — 「查不出来」和「没问题」必须分开', () => {
  it('没配广告账户 → error，而不是 0 个问题', async () => {
    const r = await sweepClient({ ...CLIENT, meta_ad_account_id: null })
    expect(r.error).toBeTruthy()
    expect(r.adSetsChecked).toBe(0)
  })

  it('拿不到授权 → error', async () => {
    mockToken.mockResolvedValue(null)
    const r = await sweepClient(CLIENT)
    expect(r.error).toContain('授权')
  })

  it('列不出广告组（Meta 返回 null）→ error，不能报 0 blocker 就完事', async () => {
    mockList.mockResolvedValue(null)
    const r = await sweepClient(CLIENT)
    expect(r.error).toBeTruthy()
    expect(r.blockers).toBe(0)
    expect(r.adSetsChecked).toBe(0)
  })

  it('账户里一个在投广告组都没有 → 不是 error（真的没有 ≠ 查不出来）', async () => {
    mockList.mockResolvedValue([])
    const r = await sweepClient(CLIENT)
    expect(r.error).toBeUndefined()
    expect(r.adSetsChecked).toBe(0)
  })

  it('某个组的文案回读失败 → 留一条 warn，不能从统计里静默消失', async () => {
    mockList.mockResolvedValue([{ id: 'as1', name: '暖池重定向' }])
    mockCreatives.mockResolvedValue(null)
    const r = await sweepClient(CLIENT)
    expect(r.adSetsChecked).toBe(1)
    expect(r.adSets[0].findings[0].code).toBe('readback_failed')
    expect(r.adSets[0].hasBlocker).toBe(false)
    expect(r.warns).toBe(1)
  })
})

describe('sweepClient — 真的把闸门跑起来了', () => {
  it('客户行业真的传进闸门文案（G11 接线）：travel 说「客户服务市场」', async () => {
    mockList.mockResolvedValue([
      {
        id: 'as1', name: 'x', optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE',
        targeting: { geo_locations: { countries: ['NZ'] } },
      },
    ])
    mockCreatives.mockResolvedValue([{ adId: 'a1', adName: 'EN', texts: ['Hello'] }])
    const r = await sweepClient({ ...CLIENT, expected_geo: 'Auckland', industry: 'travel' })
    const geo = r.adSets[0].findings.find((f) => f.code === 'geo_mismatch')
    expect(geo?.message).toContain('客户服务市场在「Auckland」')
  })

  it('私信组里中文 + 韩文创意 → blocker（那次得罪 5 个买家的形状）', async () => {
    mockList.mockResolvedValue([
      { id: 'as1', name: 'Kiteroa 私信', optimization_goal: 'CONVERSATIONS' },
    ])
    mockCreatives.mockResolvedValue([
      { adId: 'a1', adName: 'CN', texts: ['全新四房现房，学区房，欢迎私信预约看房'] },
      { adId: 'a2', adName: 'KR', texts: ['신축 단독주택 지금 입주 가능합니다 문의 주세요'] },
    ])
    const r = await sweepClient(CLIENT)
    expect(r.blockers).toBeGreaterThan(0)
    expect(r.adSets[0].hasBlocker).toBe(true)
    expect(r.adSets[0].findings.map((f) => f.code)).toContain('mixed_script_messaging_adset')
  })

  it('目标写点击、落点是 Messenger —— 照样按私信查（不能只看优化目标）', async () => {
    mockList.mockResolvedValue([
      {
        id: 'as1',
        name: '看房咨询',
        optimization_goal: 'LINK_CLICKS',
        destination_type: 'MESSENGER',
      },
    ])
    mockCreatives.mockResolvedValue([
      { adId: 'a1', adName: 'CN', texts: ['全新四房现房，学区房，欢迎私信预约看房'] },
      { adId: 'a2', adName: 'EN', texts: ['Brand new four bedroom home, message us to book a viewing'] },
    ])
    const r = await sweepClient(CLIENT)
    expect(r.adSets[0].findings.map((f) => f.code)).toContain('mixed_script_messaging_adset')
  })

  it('单一语言的私信组 → 不报 blocker', async () => {
    mockList.mockResolvedValue([
      { id: 'as1', name: 'Kiteroa 私信', optimization_goal: 'CONVERSATIONS' },
    ])
    mockCreatives.mockResolvedValue([
      { adId: 'a1', adName: 'EN1', texts: ['Brand new four bedroom home in Rothesay Bay'] },
      { adId: 'a2', adName: 'EN2', texts: ['Book a private viewing this weekend'] },
    ])
    const r = await sweepClient(CLIENT)
    expect(r.adSets[0].hasBlocker).toBe(false)
  })
})

describe('sweepAllClients — 一个客户炸了不能拖累其他客户', () => {
  // 候选客户名单现在整个来自 getActiveClientsWithMetaAccounts（已单独测过），
  // 这里直接 mock 它的返回值，不用再手搭 supabase 调用链假客户端。
  const dummySupabase = {} as SupabaseClient

  it('第一个客户抛异常，第二个照扫', async () => {
    mockActiveClients.mockResolvedValue([
      { id: 'c1', name: 'A', meta_ad_account_id: 'act_1' },
      { id: 'c2', name: 'B', meta_ad_account_id: 'act_2' },
    ])
    mockToken.mockImplementation(async (id: string) => {
      if (id === 'c1') throw new Error('boom')
      return 'tok'
    })
    mockList.mockResolvedValue([])

    const results = await sweepAllClients(dummySupabase)
    expect(results).toHaveLength(2)
    expect(results[0].error).toContain('boom')
    expect(results[1].error).toBeUndefined()
  })

  it('读客户列表本身失败 → 抛出去，让 cron 记成失败而不是「今天 0 个问题」', async () => {
    mockActiveClients.mockRejectedValue(new Error('db down'))
    await expect(sweepAllClients(dummySupabase)).rejects.toThrow('db down')
  })

  it('一个客户登记了两个账户 → 各产出一条结果，两个都真的被扫过', async () => {
    mockActiveClients.mockResolvedValue([{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }])
    mockAccountIds.mockResolvedValue(['act_1', 'act_2'])
    mockList.mockResolvedValue([])

    const results = await sweepAllClients(dummySupabase)

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.adAccountId).sort()).toEqual(['act_1', 'act_2'])
    expect(results.every((r) => r.clientId === 'c1' && r.clientName === 'CTS')).toBe(true)
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('第二个账户扫描炸了，不影响第一个账户已经扫出的结果', async () => {
    mockActiveClients.mockResolvedValue([{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }])
    mockAccountIds.mockResolvedValue(['act_1', 'act_2'])
    mockList.mockImplementation(async (accountId: string) => {
      if (accountId === 'act_2') throw new Error('rate limited')
      return []
    })

    const results = await sweepAllClients(dummySupabase)

    expect(results).toHaveLength(2)
    const ok = results.find((r) => r.adAccountId === 'act_1')
    const bad2 = results.find((r) => r.adAccountId === 'act_2')
    expect(ok?.error).toBeUndefined()
    expect(bad2?.error).toContain('rate limited')
  })

  it('客户只在新表登记了账户、老列（主账户）是空的 → 照样被列进来扫（主账户被清空后的样子）', async () => {
    mockActiveClients.mockResolvedValue([{ id: 'c3', name: 'CTS', meta_ad_account_id: null }])
    mockAccountIds.mockResolvedValue(['act_9'])
    mockList.mockResolvedValue([])

    const results = await sweepAllClients(dummySupabase)

    expect(results).toHaveLength(1)
    expect(results[0].clientId).toBe('c3')
    expect(results[0].adAccountId).toBe('act_9')
    expect(results[0].error).toBeUndefined()
  })
})

describe('blockerSummary', () => {
  it('没有 blocker 就返回 null（不产生一条空提醒）', () => {
    expect(
      blockerSummary({
        clientId: 'c1', clientName: 'A', adAccountId: 'act_1',
        adSetsChecked: 1, blockers: 0, warns: 2, adSets: [],
      }),
    ).toBeNull()
  })

  it('有 blocker 时带上广告组名 —— 光说「有问题」等于没说', () => {
    const s = blockerSummary({
      clientId: 'c1', clientName: 'A', adAccountId: 'act_1',
      adSetsChecked: 1, blockers: 1, warns: 0,
      adSets: [{
        adSetId: 'as1', adSetName: '暖池重定向', hasBlocker: true, buyerWillSee: [],
        findings: [{ code: 'retargeting_relaxed', severity: 'blocker', message: '名单形同虚设', learnedFrom: '2026-08-04 暖池名单被放宽事故' }],
      }],
    })
    expect(s).toContain('暖池重定向')
    expect(s).toContain('名单形同虚设')
  })
})
