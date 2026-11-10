/**
 * Regression (#1159 WP1 remediation, Build Control finding 1).
 *
 * #1159 WP1 also writes to `social_plans`, tagged
 * `plan_data.plan_kind === 'campaign_daily_v1'` — a different shape (no
 * `strategy`/`reels`/`posts`/`stories`) than the legacy `SocialPlanOutput`
 * this GET history endpoint was built to serve. `SocialPlanSection.tsx`
 * picks the newest row from this endpoint and reads `plan.strategy.theme` —
 * unfiltered, a campaign_daily_v1 row saved after a legacy plan would crash
 * that panel the next time it loads. This locks the exclusion filter in
 * place; it does not test plan generation (POST) or MTC billing, which are
 * out of scope for this remediation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CAMPAIGN_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

function getRequest(campaignId?: string): NextRequest {
  const url = new URL(`http://localhost:3001/api/clients/${CTS}/social-plan`)
  if (campaignId) url.searchParams.set('campaign_id', campaignId)
  return new NextRequest(url)
}

/** Thenable chainable query-builder stub matching how route.ts awaits `query` directly. */
function socialPlansStub(rows: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'or', 'order', 'limit']) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }
  ;(builder as { then: (resolve: (v: { data: unknown[]; error: null }) => void) => void }).then = resolve =>
    resolve({ data: rows, error: null })
  return builder
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('social-plan GET — authorisation (#1159 Build Control finding, P1)', () => {
  it('rejects an unauthenticated caller with 401 and never touches the database', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), { params: { id: CTS } })

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not a member of this client with the helper status and never touches the database', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), { params: { id: OZTOP } })

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('social-plan GET — isolates campaign_daily_v1 rows from the legacy plan-history query', () => {
  it('applies an is-null-or-not-campaign_daily_v1 filter, not a bare not.eq (which would silently drop every legacy row too)', async () => {
    allow()
    const legacyRow = { id: 'p1', campaign_id: CAMPAIGN_ID, plan_data: { strategy: { theme: 'x' }, reels: [], posts: [], stories: [] } }
    const stub = socialPlansStub([legacyRow])
    mockFrom.mockReturnValue(stub as never)

    const json = await (await GET(getRequest(CAMPAIGN_ID), { params: { id: CTS } })).json()

    expect(json.success).toBe(true)
    expect(json.plans).toEqual([legacyRow])

    const orCalls = (stub.or as ReturnType<typeof vi.fn>).mock.calls
    expect(orCalls).toHaveLength(1)
    const clause = orCalls[0][0] as string
    // Must exclude campaign_daily_v1 while explicitly keeping NULL plan_kind
    // rows (legacy plans never set plan_kind at all).
    expect(clause).toContain('plan_data->>plan_kind.is.null')
    expect(clause).toContain('plan_data->>plan_kind.neq.campaign_daily_v1')
    expect(clause).toContain('plan_data->>plan_kind.neq.weekly_slot_plan_v1')
    expect(clause).not.toMatch(/^plan_data->>plan_kind\.eq\./)
  })

  it('never calls the bare .not(...) form of the filter — a stub without it must not throw', async () => {
    allow()
    // stub deliberately has no `.not` method: if route.ts ever regresses to
    // `.not('plan_data->>plan_kind', 'eq', …)` this call becomes a
    // TypeError instead of a silent NULL-propagation bug — confirmed
    // empirically against production that the bare form returns 0 of 90 rows.
    const stub = socialPlansStub([])
    mockFrom.mockReturnValue(stub as never)

    const res = await GET(getRequest(CAMPAIGN_ID), { params: { id: CTS } })

    expect(res.status).toBe(200)
  })
})
