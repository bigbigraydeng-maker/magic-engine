/**
 * AD-SEC-1 归属校验的测试。
 *
 * 守的是「campaign_id 来自请求体，必须真的属于这个客户登记的某个广告账户」——
 * 每一条读不出来的分支都必须 fail closed（拒绝），不能默认放行。
 *
 * 2026-09-13：客户可以登记多个广告账户（client_meta_ad_accounts），这里新增
 * 的用例专门覆盖「属于第二个非主账户」和「新表查不到时退回老列」两条路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock 工厂被提到文件最前面执行，这时候普通 const 还没跑到——用 vi.hoisted
// 把 mock 函数的创建也提到同一个位置，不然会撞 TDZ（引用了还没初始化的变量）。
const { accountsEq, clientMaybeSingle, getCampaignDetails } = vi.hoisted(() => ({
  accountsEq: vi.fn(),
  clientMaybeSingle: vi.fn(),
  getCampaignDetails: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: accountsEq }) }
      }
      // table === 'clients'（老列兼容退回路径）
      return { select: () => ({ eq: () => ({ maybeSingle: clientMaybeSingle }) }) }
    },
  },
}))
vi.mock('../client', () => ({ getCampaignDetails }))

import { assertCampaignOwnedByClient } from '../campaign-ownership'

function resetAll() {
  accountsEq.mockReset()
  clientMaybeSingle.mockReset()
  getCampaignDetails.mockReset()
}

describe('assertCampaignOwnedByClient — 允许路径', () => {
  beforeEach(resetAll)

  it('account_id 完全一致（单账户）→ 放行', async () => {
    accountsEq.mockResolvedValue({ data: [{ ad_account_id: 'act_123' }], error: null })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE', account_id: '123' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })

  it('一边带 act_ 前缀一边不带 → 归一化后仍算一致', async () => {
    accountsEq.mockResolvedValue({ data: [{ ad_account_id: '123' }], error: null })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE', account_id: 'act_123' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })

  it('客户登记了两个账户，campaign 属于其中第二个（非主账户）→ 放行', async () => {
    accountsEq.mockResolvedValue({
      data: [{ ad_account_id: 'act_111' }, { ad_account_id: 'act_222' }],
      error: null,
    })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE', account_id: '222' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })

  it('新表查不到这个客户的行（还没回填）→ 退回老列 meta_ad_account_id 判断，一致则放行', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE', account_id: '123' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })
})

describe('assertCampaignOwnedByClient — 拒绝路径（每条都必须 fail closed）', () => {
  beforeEach(resetAll)

  it('新表和老列都没有登记 → 拒绝，不是放行', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: null }, error: null })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
    expect(getCampaignDetails).not.toHaveBeenCalled()
  })

  it('查新表出错 → 直接拒绝，不尝试退回老列（查不出来≠没有）', async () => {
    accountsEq.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
    expect(clientMaybeSingle).not.toHaveBeenCalled()
  })

  it('新表空、退回查老列时也出错 → 拒绝', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it('Meta 读不到这条 campaign → 拒绝', async () => {
    accountsEq.mockResolvedValue({ data: [{ ad_account_id: 'act_123' }], error: null })
    getCampaignDetails.mockResolvedValue(null)
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it('Meta 没返回 account_id → 拒绝（不当成「没问题」）', async () => {
    accountsEq.mockResolvedValue({ data: [{ ad_account_id: 'act_123' }], error: null })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it.each(['120210000000000001?method=post&status=PAUSED', 'camp1', '../act_123', '', '1'.repeat(33)])(
    'campaign_id 不是纯数字（%j）→ 拒绝，且不查登记、不调 Meta',
    async bad => {
      const r = await assertCampaignOwnedByClient(bad, 'client-a', 'tok')
      expect(r.ok).toBe(false)
      expect(accountsEq).not.toHaveBeenCalled()
      expect(getCampaignDetails).not.toHaveBeenCalled()
    },
  )

  it('跨客户：campaign 的 account_id 跟这个客户登记的任何账户都对不上 → 拒绝', async () => {
    accountsEq.mockResolvedValue({
      data: [{ ad_account_id: 'act_111' }, { ad_account_id: 'act_222' }],
      error: null,
    })
    getCampaignDetails.mockResolvedValue({ id: '120210000000000001', name: 'x', status: 'ACTIVE', account_id: '999' })
    const r = await assertCampaignOwnedByClient('120210000000000001', 'client-a', 'tok')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不属于')
  })
})
