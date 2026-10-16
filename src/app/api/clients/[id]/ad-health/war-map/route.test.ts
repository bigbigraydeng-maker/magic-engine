/**
 * GET /api/clients/[id]/ad-health/war-map — who may see it, and what happens on failure.
 *
 * 作战地图 S1 是内部结论（观众池、频率、内部诊断），只给不受限的管理员。
 * 其余身份一律 403（fail-closed）；读失败回 500 + error，不能回一份空视图冒充「没有」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { WarMapInput } from '@/lib/ads-strategy/war-map/types'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  load: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/ads-strategy/war-map/load', () => ({ loadWarMapInput: m.load }))

import { GET } from './route'

const CLIENT = 'c0000000-0000-0000-0000-00000000000a'

function call(): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/clients/${CLIENT}/ad-health/war-map`), { params: { id: CLIENT } })
}

function emptyInput(): WarMapInput {
  return {
    now: '2026-10-16T01:00:00.000Z',
    accounts: [],
    audiences: [],
    audienceHistory: [],
    adsets: [],
    campaigns: [],
    clocks: { dataDay: null, fetchedAt: null },
    growth: null,
    plan: null,
    creativePoolApproved: 0,
  }
}

describe('GET /api/clients/[id]/ad-health/war-map', () => {
  beforeEach(() => {
    m.access.mockReset()
    m.load.mockReset()
  })

  it('不受限的管理员拿到视图', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValue(emptyInput())
    const res = await call()
    expect(res.status).toBe(200)
  })

  it('付费客户账号 403，且根本不去读库', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid', allowedClientId: CLIENT })
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('限定单客户的管理员（demo）也是 403', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: CLIENT })
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('没登录或没权限时沿用鉴权的状态码', async () => {
    m.access.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('读库失败回 500 和原因，不回空视图', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockRejectedValue(new Error('读账户状态失败：boom'))
    const res = await call()
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: string; view?: unknown }
    expect(body.error).toContain('读不到作战地图')
    // 原始报错（可能带表名、列名）只进日志，不回浏览器
    expect(JSON.stringify(body)).not.toContain('boom')
    expect(body.view).toBeUndefined()
  })
})
