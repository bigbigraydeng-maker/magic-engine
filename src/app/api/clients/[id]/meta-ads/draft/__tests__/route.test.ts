/**
 * The direct draft route asks for a card. It does not build.
 * pageId still comes from the client row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const issuePausedDraftCard = vi.fn()
const getMetaTokenForClient = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () => ({
    ok: true,
    user: { id: 'u1', email: 'opc@example.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
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
  getMetaTokenForClient: (...args: unknown[]) => getMetaTokenForClient(...args),
}))

vi.mock('@/lib/ads-strategy/paused-draft-submit', () => ({
  issuePausedDraftCard: (...args: unknown[]) => issuePausedDraftCard(...args),
}))

vi.mock('@/lib/ads-strategy/paused-draft-context', () => ({
  loadPausedDraftContext: async () => ({
    accountLabel: '已登记的广告账户',
    review: { adAccountId: 'act_1', accounts: [], clientCapCents: null },
  }),
}))

vi.mock('@/lib/kernel', () => ({ createKernel: () => ({}) }))

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
  issuePausedDraftCard.mockResolvedValue({ runId: 'run-1', wroteMeta: false })
})

describe('POST /meta-ads/draft — pageId 归属（AD-SEC-2）', () => {
  it('客户配了主页 → 用客户登记的那个，只出卡，不去建', async () => {
    const res = await POST(req({ pageId: '别家客户的主页id', geoCountries: ['NZ'] }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(202)
    expect(issuePausedDraftCard).toHaveBeenCalledTimes(1)
    const draftArg = issuePausedDraftCard.mock.calls[0][0] as { draft: { pageId: string } }
    expect(draftArg.draft.pageId).toBe('real-page-id')
    const body = await res.json()
    expect(body.wroteMeta).toBe(false)
  })

  it('客户没配主页 → 拒绝(424)，不出卡', async () => {
    clientRow = { meta_ad_account_id: 'act_1', facebook_page_id: null, country: 'New Zealand' }
    const res = await POST(req({ pageId: '请求体里随便一个id', geoCountries: ['NZ'] }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(424)
    expect(issuePausedDraftCard).not.toHaveBeenCalled()
  })

  it('多个广告组不出卡，也不去建', async () => {
    const res = await POST(req({ adSets: [{ name: 'a' }, { name: 'b' }] }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(issuePausedDraftCard).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ wroteMeta: false })
  })
})
