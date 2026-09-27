/**
 * 账户级日预算上限 PATCH 路由的测试。
 *
 * 假 supabase 真的按 `client_id` / `ad_account_id` 过滤——"合计校验漏了某个
 * 客户/账户的行"这类错法在无条件返回固定数组的假件下全是绿的。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))

interface AccountRow {
  id: string
  client_id: string
  ad_account_id: string
  daily_budget_cap_cents: number | null
}

const CLIENT = '11111111-1111-1111-1111-111111111111'
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222'

let accounts: AccountRow[] = []
let configCap: number | null = null
let failStep: 'accounts' | 'siblings' | 'config' | 'update' | null = null

function makeAccountsQuery() {
  const filters: Array<(r: AccountRow) => boolean> = []
  const q = {
    select: () => q,
    eq(col: keyof AccountRow, value: unknown) {
      filters.push((r) => r[col] === value)
      return q
    },
    update(payload: Partial<AccountRow>) {
      return {
        eq(col: keyof AccountRow, value: unknown) {
          if (failStep === 'update') return Promise.resolve({ error: { message: '写入故意失败' } })
          // 真 SQL 的 UPDATE...WHERE 会改**所有**匹配的行，不是只改第一个——
          // 用 .find() 只改第一行会让"按 ad_account_id 写、漏了 client_id"这类
          // bug 因为数组顺序凑巧改对了第一行而被掩盖过去。
          const matches = accounts.filter((r) => r[col] === value)
          for (const row of matches) Object.assign(row, payload)
          return Promise.resolve({ error: null })
        },
      }
    },
    maybeSingle() {
      if (failStep === 'accounts') return Promise.resolve({ data: null, error: { message: '查账户绑定故意失败' } })
      const rows = accounts.filter((r) => filters.every((f) => f(r)))
      return Promise.resolve({ data: rows[0] ?? null, error: null })
    },
    then(resolve: (v: { data: AccountRow[] | null; error: { message: string } | null }) => unknown) {
      if (failStep === 'siblings') {
        return Promise.resolve({ data: null, error: { message: '查账户上限故意失败' } }).then(resolve)
      }
      const rows = accounts.filter((r) => filters.every((f) => f(r)))
      return Promise.resolve({ data: rows, error: null }).then(resolve)
    },
  }
  return q
}

function makeConfigQuery() {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle() {
      if (failStep === 'config') return Promise.resolve({ data: null, error: { message: '查总闸故意失败' } })
      return Promise.resolve({ data: { daily_budget_cap_cents: configCap }, error: null })
    },
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') return makeAccountsQuery()
      if (table === 'ad_strategy_configs') return makeConfigQuery()
      throw new Error('unexpected table: ' + table)
    },
  },
}))

import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { PATCH } from '../route'

const mockAdmin = vi.mocked(requireGlobalAdmin)

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) })
}

function params(accountId: string) {
  return { params: Promise.resolve({ id: CLIENT, accountId }) }
}

beforeEach(() => {
  accounts = []
  configCap = null
  failStep = null
  vi.clearAllMocks()
  mockAdmin.mockResolvedValue({ ok: true, user: { email: 'pm@magicengine.cloud' } as never })
})

describe('鉴权', () => {
  it('不是全局 admin → 原样透传状态码，不写库', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]

    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))

    expect(res.status).toBe(403)
    expect(accounts[0].daily_budget_cap_cents).toBeNull()
  })
})

describe('请求体校验', () => {
  it('不是合法 JSON → 400', async () => {
    const bad = new NextRequest('http://localhost/x', { method: 'PATCH', body: '{oops' })
    expect((await PATCH(bad, params('act_1'))).status).toBe(400)
  })

  it('缺字段 → 400', async () => {
    expect((await PATCH(req({}), params('act_1'))).status).toBe(400)
  })

  it.each([
    ['字符串', 'abc'],
    ['负数', -100],
    ['零', 0],
    ['小数', 1.5],
  ])('daily_budget_cap_cents 是 %s → 400', async (_label, value) => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    const res = await PATCH(req({ daily_budget_cap_cents: value }), params('act_1'))
    expect(res.status).toBe(400)
  })

  it('null → 合法，清空上限', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: 500 }]
    const res = await PATCH(req({ daily_budget_cap_cents: null }), params('act_1'))
    expect(res.status).toBe(200)
    expect(accounts[0].daily_budget_cap_cents).toBeNull()
  })
})

describe('账户必须先绑定过', () => {
  it('这个客户没有这个账户号 → 404，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_999'))
    expect(res.status).toBe(404)
  })

  it('🔴 账户号存在，但绑在别的客户名下 → 404（不能跨客户改）', async () => {
    accounts = [{ id: 'r1', client_id: OTHER_CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))
    expect(res.status).toBe(404)
  })

  it('查绑定失败 → 500，不写库', async () => {
    failStep = 'accounts'
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))
    expect(res.status).toBe(500)
  })

  it('绑定查到了，但查"其它账户已有上限"这一步失败 → 500，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    failStep = 'siblings'
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))
    expect(res.status).toBe(500)
    expect(accounts[0].daily_budget_cap_cents).toBeNull()
  })
})

describe('sum(账户上限) ≤ 客户总闸', () => {
  it('没有客户总闸时不校验，直接放行', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    configCap = null

    const res = await PATCH(req({ daily_budget_cap_cents: 999_999 }), params('act_1'))

    expect(res.status).toBe(200)
    expect(accounts[0].daily_budget_cap_cents).toBe(999_999)
  })

  it('单账户、新值 ≤ 总闸 → 放行', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    configCap = 10_000

    const res = await PATCH(req({ daily_budget_cap_cents: 10_000 }), params('act_1'))

    expect(res.status).toBe(200)
  })

  it('🔴 单账户、新值超总闸 1 分 → 拒，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    configCap = 10_000

    const res = await PATCH(req({ daily_budget_cap_cents: 10_001 }), params('act_1'))

    expect(res.status).toBe(400)
    expect(accounts[0].daily_budget_cap_cents).toBeNull()
  })

  it('🔴 多账户：这个账户的新值 + 别的账户已有的上限 合计超总闸 → 拒', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: 6_000 },
      { id: 'r2', client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 4_000 },
    ]
    configCap = 10_000

    // 把 act_1 从 6000 改到 6001 → 合计变成 10001，超了
    const res = await PATCH(req({ daily_budget_cap_cents: 6_001 }), params('act_1'))

    expect(res.status).toBe(400)
    expect(accounts[0].daily_budget_cap_cents).toBe(6_000)
  })

  it('多账户：合计恰好等于总闸 → 放行（不是严格小于）', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: 6_000 },
      { id: 'r2', client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 4_000 },
    ]
    configCap = 10_000

    const res = await PATCH(req({ daily_budget_cap_cents: 6_000 }), params('act_1'))

    expect(res.status).toBe(200)
  })

  it('🔴 混进别的客户同名账户号的行 → 不算进这个客户的合计', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: 6_000 },
      // 同一个 act_ 号，但挂在别的客户下（不该发生，但假件要证明"就算发生也不串账"）
      { id: 'r2', client_id: OTHER_CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 999_999 },
    ]
    configCap = 10_000

    const res = await PATCH(req({ daily_budget_cap_cents: 4_000 }), params('act_1'))

    expect(res.status).toBe(200)
    expect(accounts[0].daily_budget_cap_cents).toBe(4_000)
  })

  it('🔴 清空上限（传 null）不应被当成贡献 0 之外的任何值去算合计', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: 6_000 },
      { id: 'r2', client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 4_000 },
    ]
    configCap = 10_000

    const res = await PATCH(req({ daily_budget_cap_cents: null }), params('act_1'))

    expect(res.status).toBe(200)
    expect(accounts[0].daily_budget_cap_cents).toBeNull()
  })

  it('查总闸失败 → 500，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    failStep = 'config'
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))
    expect(res.status).toBe(500)
  })

  it('🔴 两个客户共用同一个 act_ 号（共用/代理账户）→ 只改自己客户名下那一行', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_shared', daily_budget_cap_cents: 100 },
      { id: 'r2', client_id: OTHER_CLIENT, ad_account_id: 'act_shared', daily_budget_cap_cents: 200 },
    ]
    configCap = null

    const res = await PATCH(req({ daily_budget_cap_cents: 999 }), params('act_shared'))

    expect(res.status).toBe(200)
    expect(accounts.find((a) => a.client_id === CLIENT)!.daily_budget_cap_cents).toBe(999)
    // 另一个客户名下那一行必须原封不动——按主键 id 写，不能按 ad_account_id 写
    // （两行的 ad_account_id 一样，按它写会两行一起改，或者改错那一行）。
    expect(accounts.find((a) => a.client_id === OTHER_CLIENT)!.daily_budget_cap_cents).toBe(200)
  })
})

describe('写入失败', () => {
  it('校验都过了但写库报错 → 500', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', daily_budget_cap_cents: null }]
    failStep = 'update'
    const res = await PATCH(req({ daily_budget_cap_cents: 100 }), params('act_1'))
    expect(res.status).toBe(500)
  })
})
