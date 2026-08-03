import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
  listConnections:    vi.fn(),
  getConnectionById:  vi.fn(),
  revokeConnection:   vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
  requirePaidClientAccess: mocks.requireDashboardClientAccess,
  requireOnboardingClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  listConnections:   mocks.listConnections,
  getConnectionById: mocks.getConnectionById,
  revokeConnection:  mocks.revokeConnection,
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET, DELETE } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID  = 'client-abc'
const CONN_ID    = 'conn-xyz-123'

const CONN_SUMMARY = {
  id:            CONN_ID,
  provider:      'google_gbp',
  display_name:  'OzTop Building Supplies',
  account_id:    'accounts/999',
  location_name: null,
  status:        'active',
  scopes:        ['https://www.googleapis.com/auth/business.manage'],
  last_synced_at: null,
  error_message:  null,
}

const CONN_ROW = {
  ...CONN_SUMMARY,
  client_id:         CLIENT_ID,
  access_token_enc:  'enc:access',
  refresh_token_enc: 'enc:refresh',
  token_expiry:      '2026-07-01T00:00:00Z',
  created_at:        '2026-06-03T00:00:00Z',
  updated_at:        '2026-06-03T00:00:00Z',
}

function routeContext() {
  return { params: { id: CLIENT_ID } }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gbp`)
}

function makeDeleteRequest(connectionId?: string) {
  const url = new URL(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gbp`)
  if (connectionId) url.searchParams.set('connectionId', connectionId)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
  mocks.listConnections.mockResolvedValue([CONN_SUMMARY])
  mocks.getConnectionById.mockResolvedValue(CONN_ROW)
  mocks.revokeConnection.mockResolvedValue(undefined)
})

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/platform/gbp', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 401, error: 'Unauthenticated',
    })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has no access to this client', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 403, error: 'Forbidden',
    })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(403)
  })

  it('returns 200 with connections array on success', async () => {
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].id).toBe(CONN_ID)
  })

  it('calls listConnections with the correct clientId', async () => {
    await GET(makeGetRequest(), routeContext())
    expect(mocks.listConnections).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('does NOT include token fields in the response', async () => {
    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    const conn = body.connections[0]
    expect(conn).not.toHaveProperty('access_token_enc')
    expect(conn).not.toHaveProperty('refresh_token_enc')
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/clients/[id]/platform/gbp', () => {
  it('returns 400 when connectionId is missing', async () => {
    const res = await DELETE(makeDeleteRequest(), routeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/connectionId/)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 401, error: 'Unauthenticated',
    })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 404 when connection does not belong to this client (tenant isolation)', async () => {
    // Simulate connection belonging to a DIFFERENT client
    mocks.getConnectionById.mockResolvedValue({
      ...CONN_ROW,
      client_id: 'other-client',
    })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
  })

  it('returns 404 when connection is not found', async () => {
    mocks.getConnectionById.mockResolvedValue(null)
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
  })

  it('calls revokeConnection with the correct id on success', async () => {
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(200)
    expect(mocks.revokeConnection).toHaveBeenCalledWith(CONN_ID)
  })

  it('returns success:true JSON on success', async () => {
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

/**
 * 这条路由只管 Google 商家页 —— 别的平台的连接既不能显示，更不能删。
 *
 * ## 2026-08-03 的真实故障
 *
 * `listConnections(clientId)` 返回这个客户**所有平台**的连接。这条路由原先不过滤，
 * 而 GbpPanel 取的是「第一条 active 的」——于是 CTS 连上公司邮箱之后，商家页
 * 那一块显示成「✓ 已连接 info@ctstours.co.nz」，下面一行却还写着「还没连上
 * Google 商家页」。PM 一眼看出不对（「上面的 gbp 怎么也更新了？」）。
 *
 * **显示错只是表象，真正危险的是删除**：面板上那颗红色「断开连接」传的是它当时
 * 显示的连接 id，而 DELETE 原先只校验 client_id。点一下商家页的「断开连接」，
 * 断掉的是刚连好的邮箱 —— PM 当时离这一下只差一个手滑。
 */
describe('只管 Google 商家页，不碰别的平台', () => {
  const MAIL_SUMMARY = {
    ...CONN_SUMMARY,
    id: 'conn-mail-1',
    provider: 'microsoft_mail',
    display_name: 'info@ctstours.co.nz',
    account_id: 'info@ctstours.co.nz',
  }

  it('GET 不返回邮箱连接 —— 否则面板会把邮箱显示成商家页', async () => {
    mocks.listConnections.mockResolvedValue([MAIL_SUMMARY, CONN_SUMMARY])
    const body = await (await GET(makeGetRequest(), routeContext())).json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].provider).toBe('google_gbp')
  })

  it('一条商家页都没有时返回空 —— 不拿别的平台顶上', async () => {
    mocks.listConnections.mockResolvedValue([MAIL_SUMMARY])
    const body = await (await GET(makeGetRequest(), routeContext())).json()
    expect(body.connections).toEqual([])
  })

  /** 这一条是整组里最要紧的：少了它，商家页的「断开连接」会断掉客户的邮箱。 */
  it('DELETE 拒绝删邮箱连接，且不真的调用 revoke', async () => {
    mocks.getConnectionById.mockResolvedValue({
      ...CONN_ROW,
      id: 'conn-mail-1',
      provider: 'microsoft_mail',
    })
    const res = await DELETE(makeDeleteRequest('conn-mail-1'), routeContext())
    expect(res.status).toBe(404)
    expect(mocks.revokeConnection).not.toHaveBeenCalled()
  })

  it('DELETE 同样拒绝 Google Ads 的连接', async () => {
    mocks.getConnectionById.mockResolvedValue({ ...CONN_ROW, provider: 'google_ads' })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
    expect(mocks.revokeConnection).not.toHaveBeenCalled()
  })
})
