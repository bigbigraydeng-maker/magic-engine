/**
 * 房子的**鉴权**测试。
 *
 * 为什么单独钉这一层：`PATCH /api/listings/[listingId]` 的 URL 上没有 client_id，
 * 所以唯一的越权闸门就是 `requireListingAccess` —— 它必须先把房子读出来拿到
 * 归属的 client_id，再走标准客户鉴权。
 *
 * 少了那一步的后果很具体：**任何登录用户把网址里的房子 id 换成别人的，
 * 就能改别的中介的房子**。而这是一个改动这个文件时极容易顺手删掉的三行代码。
 *
 * 复审时实测过：把那段客户鉴权整段拿掉，原有 60 个测试**全绿、零报警**。
 * 下面这几条就是补上的守护 —— 变异（删掉鉴权 / 忽略鉴权结果）必须让它们变红。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { requireListingAccess } from '../queries'

const LISTING_ID = 'listing-1'
const OWNER_CLIENT = 'client-owner'

/** listings 表按 id 查一行；row=null 表示查不到。 */
function mockListingRow(row: Record<string, unknown> | null, error: unknown = null) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: row, error }),
      }),
    }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireListingAccess —— 越权闸门', () => {
  it('🔴 必须拿「房子归属的 client_id」去做客户鉴权（不是 URL 里的任何东西）', async () => {
    mockListingRow({ id: LISTING_ID, client_id: OWNER_CLIENT })
    ;(requireDashboardClientAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

    const r = await requireListingAccess(LISTING_ID)

    expect(requireDashboardClientAccess).toHaveBeenCalledTimes(1)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith(OWNER_CLIENT)
    expect(r.ok).toBe(true)
  })

  it('🔴 客户鉴权不通过 → 必须原样拒绝，绝不能放行', async () => {
    mockListingRow({ id: LISTING_ID, client_id: OWNER_CLIENT })
    ;(requireDashboardClientAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      error: '无权访问该客户',
    })

    const r = await requireListingAccess(LISTING_ID)

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(403)
  })

  it('🔴 鉴权失败时不得返回房子数据（越权读也是越权）', async () => {
    mockListingRow({ id: LISTING_ID, client_id: OWNER_CLIENT, vendor_notes: '房主私下说底价 120 万' })
    ;(requireDashboardClientAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      error: '无权访问该客户',
    })

    const r = await requireListingAccess(LISTING_ID)

    expect(r).not.toHaveProperty('row')
  })

  it('房子不存在 → 404，且不去做客户鉴权（没有归属可判）', async () => {
    mockListingRow(null)

    const r = await requireListingAccess('does-not-exist')

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('读库出错 → 500，同样不放行', async () => {
    mockListingRow(null, { message: 'db down' })

    const r = await requireListingAccess(LISTING_ID)

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(500)
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })
})
