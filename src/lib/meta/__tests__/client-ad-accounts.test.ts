/**
 * getClientAdAccounts / getClientAdAccountIds — 多账户读取的共享入口。
 *
 * 这是给"查不出来就少扫一点"能接受的调用方用的（同步 cron、每日巡检），
 * 跟 campaign-ownership 那种必须 fail closed 的安全闸不是一回事，所以这里
 * 查询失败会退化成空数组而不是抛错，测试也照这个约定来断言。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { accountsEq, clientMaybeSingle } = vi.hoisted(() => ({
  accountsEq: vi.fn(),
  clientMaybeSingle: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: () => ({ order: accountsEq }) }) }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: clientMaybeSingle }) }) }
    },
  },
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getClientAdAccounts,
  getClientAdAccountIds,
  getActiveClientsWithMetaAccounts,
} from '../client-ad-accounts'

function resetAll() {
  accountsEq.mockReset()
  clientMaybeSingle.mockReset()
}

describe('getClientAdAccounts', () => {
  beforeEach(resetAll)

  it('新表有多条记录 → 全部返回，主账户排前面（按查询里的 order 结果原样返回）', async () => {
    accountsEq.mockResolvedValue({
      data: [
        { ad_account_id: 'act_111', label: '主账户', is_primary: true },
        { ad_account_id: 'act_222', label: 'CTStours 官方账户', is_primary: false },
      ],
      error: null,
    })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([
      { adAccountId: 'act_111', label: '主账户', isPrimary: true },
      { adAccountId: 'act_222', label: 'CTStours 官方账户', isPrimary: false },
    ])
    expect(clientMaybeSingle).not.toHaveBeenCalled()
  })

  it('新表 0 行 → 退回老列 meta_ad_account_id', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([{ adAccountId: 'act_123', label: '主账户', isPrimary: true }])
  })

  it('新表 0 行、老列也是 null → 空数组（不是抛错）', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: null }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([])
  })

  it('新表查询出错 → 退化成退回老列（同步类调用方，查不出来就少扫一点，不抛错）', async () => {
    accountsEq.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_999' }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([{ adAccountId: 'act_999', label: '主账户', isPrimary: true }])
  })

  it('两处都出错 → 空数组，不抛异常', async () => {
    accountsEq.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    clientMaybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([])
  })
})

describe('getClientAdAccountIds', () => {
  beforeEach(resetAll)

  it('只取 id 字符串列表', async () => {
    accountsEq.mockResolvedValue({
      data: [
        { ad_account_id: 'act_111', label: '主账户', is_primary: true },
        { ad_account_id: 'act_222', label: null, is_primary: false },
      ],
      error: null,
    })
    const ids = await getClientAdAccountIds('client-a')
    expect(ids).toEqual(['act_111', 'act_222'])
  })
})

// 这个函数接的是调用方传进来的 supabase 客户端（不是模块顶层那个 supabaseAdmin），
// 所以直接手搭一个符合形状的假客户端就够，不用走上面那套 vi.mock。
describe('getActiveClientsWithMetaAccounts', () => {
  function fakeSupabase(opts: {
    legacyRows?: unknown[]
    legacyError?: { message: string } | null
    registeredRows?: unknown[]
    registeredError?: { message: string } | null
    extraRows?: unknown[]
    extraError?: { message: string } | null
  } = {}) {
    const {
      legacyRows = [], legacyError = null,
      registeredRows = [], registeredError = null,
      extraRows = [], extraError = null,
    } = opts
    // 实测：下面 select().eq().not() / select().eq().in() / 裸 select() 这三条链路，
    // 逐条对着 getActiveClientsWithMetaAccounts 源码里真实发出的三次调用核对过，
    // 跑过全部用例确认每条分支都命中了对应的假实现，不是凭空拍的形状。
    const fake = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                not: () => Promise.resolve({ data: legacyRows, error: legacyError }),
                in: () => Promise.resolve({ data: extraRows, error: extraError }),
              }),
            }),
          }
        }
        if (table === 'client_meta_ad_accounts') {
          return { select: () => Promise.resolve({ data: registeredRows, error: registeredError }) }
        }
        return {}
      },
    }
    return fake as unknown as SupabaseClient
  }

  it('只有老列有值的客户 → 照旧返回', async () => {
    const clients = await getActiveClientsWithMetaAccounts(
      fakeSupabase({ legacyRows: [{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }] }),
    )
    expect(clients).toEqual([{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }])
  })

  it('客户老列是空的、但在新表登记了账户（主账户被清空后的样子）→ 照样被列进来', async () => {
    const clients = await getActiveClientsWithMetaAccounts(
      fakeSupabase({
        legacyRows: [],
        registeredRows: [{ client_id: 'c2' }],
        extraRows: [{ id: 'c2', name: 'CTS', meta_ad_account_id: null }],
      }),
    )
    expect(clients).toEqual([{ id: 'c2', name: 'CTS', meta_ad_account_id: null }])
  })

  it('同一个客户老列有值、新表也登记了同一个客户 → 不重复列出', async () => {
    const clients = await getActiveClientsWithMetaAccounts(
      fakeSupabase({
        legacyRows: [{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }],
        registeredRows: [{ client_id: 'c1' }, { client_id: 'c1' }],
      }),
    )
    expect(clients).toEqual([{ id: 'c1', name: 'CTS', meta_ad_account_id: 'act_1' }])
  })

  it('查老列出错 → 抛出去，不当成「没有客户」', async () => {
    await expect(
      getActiveClientsWithMetaAccounts(fakeSupabase({ legacyError: { message: 'db down' } })),
    ).rejects.toThrow('db down')
  })

  it('查新表出错 → 抛出去', async () => {
    await expect(
      getActiveClientsWithMetaAccounts(fakeSupabase({ registeredError: { message: 'timeout' } })),
    ).rejects.toThrow('timeout')
  })

  it('查新表登记的额外客户详情时出错 → 抛出去', async () => {
    await expect(
      getActiveClientsWithMetaAccounts(
        fakeSupabase({ registeredRows: [{ client_id: 'c2' }], extraError: { message: 'boom' } }),
      ),
    ).rejects.toThrow('boom')
  })
})
