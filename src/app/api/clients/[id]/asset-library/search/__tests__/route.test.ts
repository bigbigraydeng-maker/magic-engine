import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  from: vi.fn(),
  rankAssetsByPrompt: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/factory/rank-assets-by-prompt', () => ({
  rankAssetsByPrompt: mocks.rankAssetsByPrompt,
}))

import { POST } from '../route'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: { id: CLIENT_ID } }
}

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/asset-library/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 抽出的 rankAssetsByPrompt 是这条路由此前**没有测试覆盖**的核心逻辑(魏征设计
// 复审 ⚠️ 指出的风险)——这里锁的是重构后路由不变的契约:查询结果原样交给共享
// 排序函数、结果按 snake_case Recommendation 形状吐回去,且不能开 requireVerified
// (人工选图界面要让 FDE 看得见/选得到未核实来源,这条红线只在自动出片管线收紧)。
/** Thenable chainable query-builder stub,同款写法见 social-plan/route.test.ts。 */
function chainableQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'is']) {
    q[m] = vi.fn().mockReturnValue(q)
  }
  ;(q as { then: (resolve: (v: typeof result) => void) => void }).then = (resolve) => resolve(result)
  return q
}

function adminAccess() {
  return { ok: true as const }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

describe('POST /api/clients/[id]/asset-library/search', () => {
  it('400 当 image_prompt 缺失', async () => {
    const res = await POST(makeRequest({}), routeContext())
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('未授权时透传 access.status/error', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' })
    const res = await POST(makeRequest({ image_prompt: 'great wall' }), routeContext())
    expect(res.status).toBe(403)
  })

  it('把查询结果原样交给 rankAssetsByPrompt(不开 requireVerified),并把结果映射回 snake_case Recommendation', async () => {
    const rows = [
      { id: 'a1', storage_url: 'https://x/a.jpg', original_filename: 'a.jpg', vision_metadata: { quality_score: 8 }, source: 'client_verified' },
    ]
    mocks.from.mockReturnValue(chainableQuery({ data: rows, error: null }))
    mocks.rankAssetsByPrompt.mockResolvedValue([
      { id: 'a1', storageUrl: 'https://x/a.jpg', reason: 'great match', qualityScore: 8, metadata: { quality_score: 8 }, source: 'client_verified' },
    ])

    const res = await POST(makeRequest({ image_prompt: 'great wall' }), routeContext())
    const body = await res.json()

    expect(mocks.rankAssetsByPrompt).toHaveBeenCalledWith('great wall', rows, 6)
    expect(body).toEqual({
      success: true,
      recommendations: [
        {
          id: 'a1',
          storage_url: 'https://x/a.jpg',
          original_filename: 'a.jpg',
          reason: 'great match',
          quality_score: 8,
          metadata: { quality_score: 8 },
          source: 'client_verified',
        },
      ],
    })
  })

  it('🔴 2026-09-13 事故回归：查询结果里没有 kind 键的照片行必须保留，只排除 kind==="video" 的行（曾用 DB 级 not-eq 写，PostgREST 对着「键不存在」的行整行排除，把几乎所有照片一起筛掉）', async () => {
    const rows = [
      { id: 'photo-no-kind', storage_url: 'https://x/a.jpg', original_filename: 'a.jpg', vision_metadata: { scene: 'wall' }, source: 'client_verified' },
      { id: 'photo-null-metadata', storage_url: 'https://x/b.jpg', original_filename: 'b.jpg', vision_metadata: null, source: 'client_verified' },
      { id: 'video-row', storage_url: 'https://x/c.mp4', original_filename: 'c.mp4', vision_metadata: { kind: 'video' }, source: 'client_verified' },
    ]
    mocks.from.mockReturnValue(chainableQuery({ data: rows, error: null }))
    mocks.rankAssetsByPrompt.mockResolvedValue([])

    await POST(makeRequest({ image_prompt: 'great wall' }), routeContext())

    const passedAssets = mocks.rankAssetsByPrompt.mock.calls[0][1] as Array<{ id: string }>
    expect(passedAssets.map((a) => a.id).sort()).toEqual(['photo-no-kind', 'photo-null-metadata'])
  })

  it('limit 夹在 1-20 区间', async () => {
    mocks.from.mockReturnValue(chainableQuery({ data: [], error: null }))
    mocks.rankAssetsByPrompt.mockResolvedValue([])

    await POST(makeRequest({ image_prompt: 'x', limit: 999 }), routeContext())
    expect(mocks.rankAssetsByPrompt).toHaveBeenCalledWith('x', [], 20)
  })

  it('数据库报错时返回 500', async () => {
    mocks.from.mockReturnValue(chainableQuery({ data: null, error: new Error('db down') }))
    const res = await POST(makeRequest({ image_prompt: 'x' }), routeContext())
    expect(res.status).toBe(500)
  })
})
