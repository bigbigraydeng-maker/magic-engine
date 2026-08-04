/**
 * 投流建广告后必须记下「投的是哪条片」。
 *
 * 这是自动建广告的两条路径之一(另一条是 winner-reel-sync)。拿掉记录那一步,
 * 生产上不会有任何报错 —— 只是三个月后发现 attr_creative_ref 还是空的。所以这条
 * 测试守的是那一步本身,不是它的返回值。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const boostPagePost = vi.fn()
const linkAdToCreative = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: async () => ({ ok: true }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { name: 'Oztop', meta_ad_account_id: 'act_1' },
            error: null,
          }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/meta/client', () => ({
  boostPagePost: (...a: unknown[]) => boostPagePost(...a),
}))

vi.mock('@/lib/ads/creative-link', () => ({
  linkAdToCreative: (...a: unknown[]) => linkAdToCreative(...a),
}))

import { POST } from '../route'

const req = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/clients/c1/meta-ads/boost-post', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const BODY = {
  post_id: '748077268383005_1004101655665734',
  page_id: '748077268383005',
  daily_budget_aud: 20,
  duration_days: 7,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_SYSTEM_USER_TOKEN = 'token'
  boostPagePost.mockResolvedValue({ campaign_id: 'c', ad_set_id: 'as', ad_id: 'ad-777' })
  linkAdToCreative.mockResolvedValue({
    creativeRef: 'wo-1',
    creativeSource: 'content_work_order',
    linkMethod: 'published_post_id',
    unresolvedReason: null,
  })
})

describe('POST /meta-ads/boost-post', () => {
  it('建完广告立刻记素材对应关系,用刚拿到的 ad_id', async () => {
    const res = await POST(req(BODY), { params: { id: 'client-oztop' } })
    expect(res.status).toBe(200)

    expect(linkAdToCreative).toHaveBeenCalledTimes(1)
    expect(linkAdToCreative.mock.calls[0][0]).toMatchObject({
      clientId: 'client-oztop',
      adId: 'ad-777',
      postId: '748077268383005_1004101655665734',
      pageId: '748077268383005',
      createdBy: 'boost_post_api',
    })

    const json = await res.json()
    expect(json).toMatchObject({ ad_id: 'ad-777', creative_ref: 'wo-1', creative_link_method: 'published_post_id' })
  })

  it('认不出是哪条片 → 回执如实说留空 + 原因,不假装成功归因', async () => {
    linkAdToCreative.mockResolvedValue({
      creativeRef: null,
      creativeSource: null,
      linkMethod: 'unresolved',
      unresolvedReason: '帖子不对应任何已发布的 ME 工单',
    })

    const res = await POST(req(BODY), { params: { id: 'client-oztop' } })
    const json = await res.json()

    expect(json.creative_ref).toBeNull()
    expect(json.creative_link_method).toBe('unresolved')
    expect(json.creative_link_note).toContain('工单')
  })

  it('广告没建成 → 不记任何对应关系(没有 ad_id 可记)', async () => {
    boostPagePost.mockResolvedValue(null)

    const res = await POST(req(BODY), { params: { id: 'client-oztop' } })

    expect(res.status).toBe(502)
    expect(linkAdToCreative).not.toHaveBeenCalled()
  })
})
