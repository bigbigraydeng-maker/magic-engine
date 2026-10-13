/**
 * /api/public-scan/keyword-gap 鉴权测试。
 *
 * 钉住 2026-09-27 盘点发现的问题：这个接口以前谁都能调，每次调用都花 DataForSEO 的钱，
 * 而且产品里没有任何地方在用它。现在只放行全局管理员——没登录、受限管理员（演示账号）
 * 都必须在花钱之前被拦下，不能先调 DataForSEO 再判权限。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({
  guardGlobalAdmin: vi.fn(async () => null),
}))
vi.mock('@/lib/seo-gap/public-gap', () => ({
  getPublicKeywordGapReport: vi.fn(async () => ({ domain: 'example.com', markets: [] })),
}))

import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { getPublicKeywordGapReport } from '@/lib/seo-gap/public-gap'
import { GET, POST } from './route'

const URL_BASE = 'http://localhost/api/public-scan/keyword-gap'

function getReq(query = '') {
  return new NextRequest(`${URL_BASE}${query}`)
}

function postReq(body: unknown) {
  return new NextRequest(URL_BASE, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.mocked(guardGlobalAdmin).mockReset()
  vi.mocked(guardGlobalAdmin).mockResolvedValue(null)
  vi.mocked(getPublicKeywordGapReport).mockClear()
})

describe.each([
  ['GET', () => GET(getReq('?domain=competitor.com.au&limit=500'))],
  ['POST', () => POST(postReq({ domain: 'competitor.com.au', limit: 500 }))],
] as const)('%s keyword-gap', (_method, call) => {
  it('没登录 → 401，而且一分钱都没花（没调 DataForSEO）', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const res = await call()
    expect(res.status).toBe(401)
    expect(getPublicKeywordGapReport).not.toHaveBeenCalled()
  })

  it('受限管理员（演示账号）→ 403，同样不花钱', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await call()
    expect(res.status).toBe(403)
    expect(getPublicKeywordGapReport).not.toHaveBeenCalled()
  })

  it('全局管理员 → 照常出报告，且响应不许被公共缓存存下来转给别人', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(getPublicKeywordGapReport).toHaveBeenCalledTimes(1)
    expect(getPublicKeywordGapReport).toHaveBeenCalledWith('competitor.com.au', ['au', 'nz'], 500)
    const cacheControl = res.headers.get('Cache-Control') ?? ''
    expect(cacheControl).toContain('no-store')
    expect(cacheControl).not.toContain('public')
  })
})
