/**
 * Tests for the Facebook Page binding endpoint.
 *
 * Setting this field is what turns customer-message ingestion on for a client,
 * so the tests are about the two ways that goes wrong quietly:
 *   - storing something that is not a Page id (a vanity URL, a name) and leaving
 *     the sync pulling nothing until someone reads the logs
 *   - reporting success when ME cannot actually reach the Page it was told to watch
 *
 * A Meta outage must never block reading or clearing the binding, so the
 * pick-list degrades to null instead of failing the request.
 *
 * AD-SEC-4: writing is internal-staff only and goes through page-binding-service
 * (its checks are tested in lib/meta/__tests__/page-binding-service.test.ts); the
 * pick-list and the reason a sync is paused are staff-only on GET.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/meta/page-binding-service', () => ({ bindPage: vi.fn(), clearPage: vi.fn() }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ assessPageBinding: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
  getStoredPageToken: vi.fn(),
}))
vi.mock('@/lib/meta/page-posts', () => ({ listManagedPages: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { GET, PATCH } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { bindPage, clearPage } from '@/lib/meta/page-binding-service'
import { assessPageBinding } from '@/lib/meta/page-sync-authorization'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { listManagedPages } from '@/lib/meta/page-posts'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockStaff = vi.mocked(requireGlobalAdmin)
const mockBind = vi.mocked(bindPage)
const mockClear = vi.mocked(clearPage)
const mockAssess = vi.mocked(assessPageBinding)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockToken = vi.mocked(getMetaTokenForClient)
const mockStoredToken = vi.mocked(getStoredPageToken)
const mockPages = vi.mocked(listManagedPages)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CTS_PAGE = '1616575215312482'

function params(id = CTS) {
  return { params: { id } }
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/facebook-page`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/facebook-page`)
}

/** Internal staff: global admin (no client restriction). */
function allow() {
  mockStaff.mockResolvedValue({ ok: true, user: { email: 'FDE@magiclab.example ' } } as never)
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'fde@magiclab.example' } as never,
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as never)
  mockBind.mockImplementation(async (_c, _a, pageId) => ({ status: 200, body: { success: true, page_id: pageId } }))
  mockClear.mockResolvedValue({ status: 200, body: { success: true, page_id: null } })
  mockAssess.mockResolvedValue({ verified: true, via: 'staff_verified' })
}

/** A member of the client (paid client staff) — not internal staff. */
function allowClientMember() {
  allow()
  mockStaff.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

/** Stubs the clients table for both the read and the write path. */
function stubClients(current: string | null, factoryConfig: unknown = null) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { facebook_page_id: current, factory_config: factoryConfig },
          error: null,
        }),
      }),
    }),
    update,
  } as never)
  return { update }
}

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * GET must answer "is this binding live", not just "what is stored".
 *
 * 30 Kiteroa had a Page bound, ads spending, and an hourly sync skipping with
 * `no_page_token` — the client had granted us permission to advertise with the
 * Page but never shared it, so Meta hands us no Page token. Every screen looked
 * healthy. PATCH already reported this at save time; GET stayed silent, so the
 * warning survived exactly one page load.
 */
describe('facebook-page — is the binding actually live', () => {
  it('reports reachable when Meta hands us the bound Page', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(res.status).toBe(200)
    expect(json.reachable).toBe(true)
  })

  it('reports NOT reachable when the Page is bound but Meta will not hand it over', async () => {
    allow()
    stubClients('227633594573276') // 30 Kiteroa: bound, advertised with, never shared
    mockToken.mockResolvedValue('user-token')
    // Meta lists the Pages we may act for — the bound one is absent.
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(json.reachable).toBe(false)
  })

  it('says unknown rather than broken when Meta cannot be asked', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue(null) // no token → no pick-list, no verdict

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(json.reachable).toBeNull()
  })

  it('says unknown when nothing is bound, so the UI shows no alarm', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(json.reachable).toBeNull()
  })

  /**
   * New Asian Logistics (2026-09-13): clicked "连接 Meta", finished the Facebook
   * OAuth flow, got "连接成功" — and this endpoint still showed "绑了主页，但线索
   * 进不来". Root cause: `pages` here comes from getMetaTokenForClient, the
   * legacy env-var token, which has never heard of a client that connected
   * through OAuth. The real hourly sync (src/lib/messenger/sync.ts) already
   * tries getStoredPageToken first and worked fine the whole time — only this
   * status check was reading the wrong source.
   */
  it('reports reachable via the stored per-client OAuth token even when the legacy pick-list does not have this Page (New Asian Logistics)', async () => {
    allow()
    const NAL_PAGE = '1177479655430100'
    stubClients(NAL_PAGE)
    mockToken.mockResolvedValue('user-token')
    // The old env-token pick-list has no idea this Page exists.
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)
    // But the OAuth button stored a real, working token for it.
    mockStoredToken.mockResolvedValue('stored-oauth-token')

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(json.reachable).toBe(true)
  })

  it('still reports NOT reachable when neither the pick-list nor a stored token has this Page — connecting once must not make every future state look healthy', async () => {
    allow()
    const NAL_PAGE = '1177479655430100'
    stubClients(NAL_PAGE)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)
    mockStoredToken.mockResolvedValue(null) // no stored connection for this Page either

    const res = await GET(getRequest(), params())
    const json = (await res.json()) as { reachable: boolean | null }

    expect(json.reachable).toBe(false)
  })
})

describe('facebook-page — exposes the publish target so the UI can offer publishing reauth (#1152)', () => {
  it('returns the Facebook publish_target page id, independent of the inbox binding', async () => {
    allow()
    // inbox unset, but a Facebook publish target IS configured — the publishing
    // reauth button must still be offerable.
    stubClients(null, { publish_target: { platform: 'facebook', page_id: '778899' } })
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const json = (await (await GET(getRequest(), params())).json()) as {
      page_id: string | null
      publish_target_page_id: string | null
    }

    expect(json.page_id).toBeNull()
    expect(json.publish_target_page_id).toBe('778899')
  })

  it('returns null publish target when it is configured for a non-Facebook platform', async () => {
    allow()
    stubClients(CTS_PAGE, { publish_target: { platform: 'instagram', page_id: '778899' } })
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const json = (await (await GET(getRequest(), params())).json()) as { publish_target_page_id: string | null }

    expect(json.publish_target_page_id).toBeNull()
  })

  it('returns null publish target when none is configured', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }] as never)

    const json = (await (await GET(getRequest(), params())).json()) as { publish_target_page_id: string | null }

    expect(json.publish_target_page_id).toBeNull()
  })
})

describe('facebook-page — authorisation', () => {
  it('rejects a caller who is not a member of the client', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(getRequest(), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('will not write for an unauthenticated caller', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // 🔴 2026-09-14 PR #1658 复审阻断项：客户成员能把主页改成别家的，boost-post / draft /
  // winner-reel-sync 的主页归属核对就全部失效；AD-SEC-4 又查出它决定私信/线索同步读谁的主页。
  it('客户成员（非内部员工）改主页绑定 → 403，不进绑定流程、不写审计', async () => {
    allowClientMember()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockBind).not.toHaveBeenCalled()
    expect(mockClear).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('客户成员也不能清空绑定', async () => {
    allowClientMember()
    const res = await PATCH(patchRequest({ page_id: null }), params())
    expect(res.status).toBe(403)
    expect(mockClear).not.toHaveBeenCalled()
  })

  it('受限管理员（DEMO_ADMINS / scoped）过了客户访问检查，但不是内部员工 → 403', async () => {
    allow()
    mockAccess.mockResolvedValue({ ok: true, user: { email: 'demo@x' }, role: 'admin', tier: 'admin', allowedClientId: CTS } as never)
    mockStaff.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden — scoped admin' } as never)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(res.status).toBe(403)
    expect(mockBind).not.toHaveBeenCalled()
  })

  it('内部员工保存 → 走核实流程，审计人是规范化后的员工邮箱', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue(null)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(res.status).toBe(200)
    expect(mockBind).toHaveBeenCalledWith(CTS, 'fde@magiclab.example', CTS_PAGE)
  })

  it('核实流程拒绝（比如主页绑在别的客户名下）→ 原样返回拒绝，不当成保存成功', async () => {
    allow()
    stubClients(null)
    mockBind.mockResolvedValue({ status: 409, body: { error: '这个主页已经绑在别的客户名下', reason: 'page_bound_to_other_client' } })

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'page_bound_to_other_client' })
    expect(mockPages).not.toHaveBeenCalled()
  })

  it('客户成员仍然可以查看绑定（GET 不要求内部员工），但看不到主页列表和暂停原因', async () => {
    allowClientMember()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('shared-token')
    // Through the shared token this list holds OTHER clients' Pages.
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }, { id: '777777777777', name: 'Another client' }])
    mockAssess.mockResolvedValue({ verified: false, reason: 'bound_to_other_client', detail: OZTOP })

    const res = await GET(getRequest(), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockStaff).not.toHaveBeenCalled()
    expect(json).toMatchObject({ page_id: CTS_PAGE, pages: null, pages_error: null, can_edit: false, verification: { verified: false } })
    expect(json.verification).not.toHaveProperty('reason')
    expect(JSON.stringify(json)).not.toContain('Another client')
    expect(JSON.stringify(json)).not.toContain(OZTOP)
  })

  it('员工请求体里不带 page_id → 400，不当成「清空绑定」', async () => {
    allow()
    const res = await PATCH(patchRequest({}), params())
    expect(res.status).toBe(400)
    expect(mockClear).not.toHaveBeenCalled()
    expect(mockBind).not.toHaveBeenCalled()
  })

  it('没有任何 Meta 令牌不算「绑定没核实」—— verification 为 null，界面不标红', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue(null)
    mockAssess.mockResolvedValue({ verified: false, reason: 'no_meta_token' })
    const json = await (await GET(getRequest(), params())).json()
    expect(json.verification).toBeNull()
  })

  it('内部员工 GET 能看到主页列表和暂停原因', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('shared-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours' }])
    mockAssess.mockResolvedValue({ verified: false, reason: 'unverified_shared_token' })

    const json = await (await GET(getRequest(), params())).json()

    expect(json).toMatchObject({ can_edit: true, pages: [{ id: CTS_PAGE }], verification: { verified: false, reason: 'unverified_shared_token' } })
  })
})

describe('facebook-page — what may be stored', () => {
  it('refuses a vanity URL instead of storing a Page the sync can never read', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: 'facebook.com/CTSTOURS' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
    expect(mockBind).not.toHaveBeenCalled()
    expect((await res.json()).error).toContain('数字')
  })

  it('refuses a Page name', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: 'CTS Tours NZ' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a number too short to be a real Page id', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: '12345' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('stores a valid id, trimming stray whitespace from a paste', async () => {
    allow()
    const { update } = stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours NZ' }])

    const res = await PATCH(patchRequest({ page_id: `  ${CTS_PAGE} ` }), params())

    expect(res.status).toBe(200)
    expect(mockBind).toHaveBeenCalledWith(CTS, expect.any(String), CTS_PAGE)
    expect(update).not.toHaveBeenCalled() // the route never writes the column itself
  })

  it('treats an empty string as "stop syncing this client"', async () => {
    allow()
    const { update } = stubClients(CTS_PAGE)
    mockToken.mockResolvedValue(null)

    const res = await PATCH(patchRequest({ page_id: '' }), params())

    expect(res.status).toBe(200)
    expect(mockClear).toHaveBeenCalledWith(CTS, expect.any(String))
    expect(mockBind).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ page_id: null, reachable: null })
  })
})

describe('facebook-page — telling the truth about whether it is live', () => {
  it('reports reachable when the saved Page is one Meta lets us act for', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([
      { id: '999', name: 'Other Page' },
      { id: CTS_PAGE, name: 'CTS Tours NZ' },
    ])

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(await res.json()).toMatchObject({ success: true, reachable: true })
  })

  it('saves but reports NOT reachable when the id is not among the managed Pages', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: '999', name: 'Other Page' }])

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    // (With the AD-SEC-4 flow Meta must list the Page for a save to succeed; this
    // covers the reachable read-back when the save itself was accepted.)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, reachable: false })
  })

  it('reports unknown rather than reachable when Meta is not connected', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue(null)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(await res.json()).toMatchObject({ reachable: null, pages_error: 'no_token' })
  })
})

describe('facebook-page — reading', () => {
  it('returns the pick-list so nobody has to hunt for a numeric id', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours NZ' }])

    const json = await (await GET(getRequest(), params())).json()

    expect(json).toMatchObject({
      page_id: CTS_PAGE,
      pages: [{ id: CTS_PAGE, name: 'CTS Tours NZ' }],
      pages_error: null,
    })
  })

  it('still returns the binding when Meta rejects the token', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('stale-token')
    mockPages.mockResolvedValue(null)

    const res = await GET(getRequest(), params())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      page_id: CTS_PAGE,
      pages: null,
      pages_error: 'meta_rejected',
    })
  })
})
