/**
 * 「在广告健康页显示」PATCH。假 supabase 按 client_id / ad_account_id / 行 id 过滤，
 * 用来抓住「改到别的客户」和「两个客户共用同一个账户号却写错行」。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))

interface AccountRow {
  id: string
  client_id: string
  ad_account_id: string
  hidden_from_ad_health: boolean
}

const CLIENT = '11111111-1111-1111-1111-111111111111'
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222'

let accounts: AccountRow[] = []
let failStep: 'accounts' | 'update' | null = null

function makeAccountsQuery() {
  const filters: Array<(row: AccountRow) => boolean> = []
  const query = {
    select: () => query,
    eq(col: keyof AccountRow, value: unknown) {
      filters.push((row) => row[col] === value)
      return query
    },
    update(payload: Partial<AccountRow>) {
      return {
        eq(col: keyof AccountRow, value: unknown) {
          const chain = {
            select: () => chain,
            maybeSingle() {
              if (failStep === 'update') {
                return Promise.resolve({ data: null, error: { message: '写入故意失败' } })
              }
              const matches = accounts.filter((row) => row[col] === value)
              for (const row of matches) Object.assign(row, payload)
              return Promise.resolve({ data: matches[0] ?? null, error: null })
            },
          }
          return chain
        },
      }
    },
    maybeSingle() {
      if (failStep === 'accounts') {
        return Promise.resolve({ data: null, error: { message: '查账户绑定故意失败' } })
      }
      const rows = accounts.filter((row) => filters.every((keep) => keep(row)))
      return Promise.resolve({ data: rows[0] ?? null, error: null })
    },
  }
  return query
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') return makeAccountsQuery()
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
  failStep = null
  vi.clearAllMocks()
  mockAdmin.mockResolvedValue({ ok: true, user: { email: 'pm@magicengine.cloud' } as never })
})

describe('鉴权', () => {
  it('不是全局 admin → 原样透传状态码，不写库', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]

    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_1'))

    expect(res.status).toBe(403)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })
})

describe('请求体校验', () => {
  it('不是合法 JSON → 400', async () => {
    const bad = new NextRequest('http://localhost/x', { method: 'PATCH', body: '{oops' })
    expect((await PATCH(bad, params('act_1'))).status).toBe(400)
  })

  it('缺字段 → 400，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    const res = await PATCH(req({}), params('act_1'))
    expect(res.status).toBe(400)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })

  it.each([
    ['字符串', 'false'],
    ['数字', 1],
    ['null', null],
  ])('hidden_from_ad_health 是 %s → 400', async (_label, value) => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    const res = await PATCH(req({ hidden_from_ad_health: value }), params('act_1'))
    expect(res.status).toBe(400)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })
})

describe('账户必须属于这个客户', () => {
  it('这个客户没有这个账户号 → 404，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_999'))
    expect(res.status).toBe(404)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })

  it('账户号存在，但绑在别的客户名下 → 404', async () => {
    accounts = [{ id: 'r1', client_id: OTHER_CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_1'))
    expect(res.status).toBe(404)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })

  it('查绑定失败 → 500，不写库', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    failStep = 'accounts'
    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_1'))
    expect(res.status).toBe(500)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })
})

describe('写入', () => {
  it('打开显示（hidden false）→ 200，回写后的行', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]

    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'r1',
      client_id: CLIENT,
      ad_account_id: 'act_1',
      hidden_from_ad_health: false,
    })
    expect(accounts[0].hidden_from_ad_health).toBe(false)
  })

  it('关掉显示（hidden true）→ 200', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: false }]
    const res = await PATCH(req({ hidden_from_ad_health: true }), params('act_1'))
    expect(res.status).toBe(200)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })

  it('两个客户共用同一个账户号 → 只改自己客户名下那一行', async () => {
    accounts = [
      { id: 'r1', client_id: CLIENT, ad_account_id: 'act_shared', hidden_from_ad_health: true },
      { id: 'r2', client_id: OTHER_CLIENT, ad_account_id: 'act_shared', hidden_from_ad_health: true },
    ]

    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_shared'))

    expect(res.status).toBe(200)
    expect(accounts.find((row) => row.client_id === CLIENT)?.hidden_from_ad_health).toBe(false)
    expect(accounts.find((row) => row.client_id === OTHER_CLIENT)?.hidden_from_ad_health).toBe(true)
  })

  it('校验都过了但写库报错 → 500，原值还在', async () => {
    accounts = [{ id: 'r1', client_id: CLIENT, ad_account_id: 'act_1', hidden_from_ad_health: true }]
    failStep = 'update'
    const res = await PATCH(req({ hidden_from_ad_health: false }), params('act_1'))
    expect(res.status).toBe(500)
    expect(accounts[0].hidden_from_ad_health).toBe(true)
  })
})
