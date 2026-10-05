/**
 * AD-SEC-2：pageId 一律以 clients 表为准，客户没配主页时必须拒绝——
 * 不能回退请求体（那正是这条守卫本来要挡住的事：把广告塞进别家客户的主页）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createDraftForApproval = vi.fn()
const getMetaTokenForClient = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () => ({ ok: true }),
}))

let clientRow: Record<string, unknown> | null = {
  meta_ad_account_id: 'act_1',
  facebook_page_id: 'real-page-id',
  country: 'New Zealand',
}
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: clientRow, error: null }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: (...a: unknown[]) => getMetaTokenForClient(...a),
}))

vi.mock('@/lib/ads-strategy/draft-and-gate', () => ({
  createDraftForApproval: (...a: unknown[]) => createDraftForApproval(...a),
}))

const loadDraftRedlines = vi.fn()
vi.mock('@/lib/ads-strategy/draft-redlines', () => ({
  loadDraftRedlines: (...a: unknown[]) => loadDraftRedlines(...a),
}))

import { POST } from '../route'

const req = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/clients/c1/meta-ads/draft', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  clientRow = { meta_ad_account_id: 'act_1', facebook_page_id: 'real-page-id', country: 'New Zealand' }
  getMetaTokenForClient.mockResolvedValue('tok')
  loadDraftRedlines.mockResolvedValue([])
  createDraftForApproval.mockResolvedValue({ actionId: 'a1', status: 'awaiting_approval', summary: 'x', findings: [] })
})

describe('POST /meta-ads/draft — pageId 归属（AD-SEC-2）', () => {
  it('客户配了主页 → 用客户登记的那个，忽略请求体里的 pageId', async () => {
    await POST(req({ pageId: '别家客户的主页id', geoCountries: ['NZ'] }), { params: Promise.resolve({ id: 'c1' }) })
    expect(createDraftForApproval).toHaveBeenCalledTimes(1)
    const draftArg = createDraftForApproval.mock.calls[0][0] as { pageId: string }
    expect(draftArg.pageId).toBe('real-page-id')
  })

  it('客户没配主页 → 拒绝(424)，不回退请求体的 pageId', async () => {
    clientRow = { meta_ad_account_id: 'act_1', facebook_page_id: null, country: 'New Zealand' }
    const res = await POST(req({ pageId: '请求体里随便一个id', geoCountries: ['NZ'] }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(424)
    expect(createDraftForApproval).not.toHaveBeenCalled()
  })
})

describe('POST /meta-ads/draft — 客户禁用词', () => {
  const ctx = { params: Promise.resolve({ id: 'c1' }) }
  const depsArg = () => createDraftForApproval.mock.calls[0][1] as { brandRedlines?: string[] }

  it('读到的禁用词原样传给起草（不是写死的）', async () => {
    loadDraftRedlines.mockResolvedValue(['phrase one', 'phrase two'])
    await POST(req({ geoCountries: ['NZ'] }), ctx)
    expect(loadDraftRedlines).toHaveBeenCalledWith(expect.anything(), 'c1')
    expect(depsArg().brandRedlines).toEqual(['phrase one', 'phrase two'])
  })

  it('客户没配（空数组）→ 传空数组，不能变成 undefined（两者意思不同）', async () => {
    loadDraftRedlines.mockResolvedValue([])
    await POST(req({ geoCountries: ['NZ'] }), ctx)
    expect(depsArg().brandRedlines).toEqual([])
  })

  it('读库失败（null）→ 传 undefined = 没加载，绝不退化成空数组', async () => {
    loadDraftRedlines.mockResolvedValue(null)
    await POST(req({ geoCountries: ['NZ'] }), ctx)
    expect(depsArg().brandRedlines).toBeUndefined()
  })
})
