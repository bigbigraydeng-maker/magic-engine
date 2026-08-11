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

import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listActiveAdSets, fetchAdCreativesReadback } from '@/lib/meta/readback'
import { sweepClient, sweepAllClients, blockerSummary } from '../readback-sweep'

const mockToken = vi.mocked(getMetaTokenForClient)
const mockList = vi.mocked(listActiveAdSets)
const mockCreatives = vi.mocked(fetchAdCreativesReadback)

const CLIENT = { id: 'c1', name: 'Roman', meta_ad_account_id: 'act_123' }

beforeEach(() => {
  vi.resetAllMocks()
  mockToken.mockResolvedValue('tok')
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
  function fakeSupabase(rows: unknown[]): SupabaseClient {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ not: () => Promise.resolve({ data: rows, error: null }) }),
        }),
      }),
    } as unknown as SupabaseClient
  }

  it('第一个客户抛异常，第二个照扫', async () => {
    mockToken.mockImplementation(async (id: string) => {
      if (id === 'c1') throw new Error('boom')
      return 'tok'
    })
    mockList.mockResolvedValue([])

    const results = await sweepAllClients(
      fakeSupabase([
        { id: 'c1', name: 'A', meta_ad_account_id: 'act_1' },
        { id: 'c2', name: 'B', meta_ad_account_id: 'act_2' },
      ]),
    )
    expect(results).toHaveLength(2)
    expect(results[0].error).toContain('boom')
    expect(results[1].error).toBeUndefined()
  })

  it('读客户列表本身失败 → 抛出去，让 cron 记成失败而不是「今天 0 个问题」', async () => {
    const bad = {
      from: () => ({
        select: () => ({
          eq: () => ({ not: () => Promise.resolve({ data: null, error: { message: 'db down' } }) }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(sweepAllClients(bad)).rejects.toThrow('db down')
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
        findings: [{ code: 'retargeting_relaxed', severity: 'blocker', message: '名单形同虚设' }],
      }],
    })
    expect(s).toContain('暖池重定向')
    expect(s).toContain('名单形同虚设')
  })
})
