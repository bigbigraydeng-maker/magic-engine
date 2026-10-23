/**
 * GET /api/clients/[id]/ad-health — who gets the raw patrol row.
 *
 * Leak being locked out (2026-09-27 子牙, found reviewing PR 2084): the route admits paid
 * clients but returned ads_growth_states as-is, so internal findings such as D11 (starved
 * re-marketing pool → "add spend") reached client browsers. Only unscoped admins may see the
 * raw row; paid clients and scoped/demo admins get the whitelisted client view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  growthRows: [] as unknown[],
  growthError: null as { message: string } | null,
  growthLimit: null as number | null,
  bookingAccess: vi.fn(),
  bookingOutcome: vi.fn(),
  unknownBookingOutcome: vi.fn(),
  latest: null as { insight_date: string } | null,
}))

vi.mock('@/lib/ads-strategy/agents/growth-live-goal', () => ({
  overlayLiveGoal: async (_id: string, row: Record<string, unknown>) => ({ ...row, goal_live: { live: true, readAtIso: 'x' } }),
}))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/crm/booking-access', () => ({ requireBookingAccess: m.bookingAccess }))
vi.mock('@/lib/ads-strategy/portfolio/company-confirmed-bookings', () => ({
  loadCompanyConfirmedBookingOutcome: m.bookingOutcome,
  unknownCompanyConfirmedBookingOutcome: m.unknownBookingOutcome,
}))

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: (n: number) => {
        if (table === 'ads_growth_states') m.growthLimit = n
        return q
      },
      maybeSingle: () => Promise.resolve({ data: table === 'ad_health_narratives' ? m.latest : null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          table === 'ads_growth_states'
            ? { data: m.growthError ? null : m.growthRows, error: m.growthError }
            : { data: [], error: null },
        ).then(resolve),
    }
    return q
  }
  return { supabaseAdmin: { from: chain } }
})

import { GET } from './route'

const CLIENT = 'c0000000-0000-0000-0000-00000000000a'
const D11_TITLE = '再营销受众池断供，建议给供血广告加预算'

const d10 = {
  code: 'D10',
  status: 'hit',
  title: '内部：点进去之后差了',
  clientVisible: true,
  units: [{ level: 'ad', id: 'ad1', name: 'Spring Lead Ad', adAccountId: 'act_1' }],
  evidence: { core_metric: 'lead', baseline_source: 'own_history', base_rate: 0.16, recent_rate: 0.04, recent_spend: 100 },
}
const d11 = {
  code: 'D11',
  status: 'hit',
  title: D11_TITLE,
  clientVisible: false,
  units: [{ level: 'adset', id: 'as9', name: 'Retargeting pool', adAccountId: 'act_1' }],
  evidence: { audience_id: 'aud_1' },
}

function row(date: string) {
  return {
    client_id: CLIENT,
    date,
    data_completeness: 'complete',
    problems_count: 2,
    opportunities_count: 0,
    goal_pace: null,
    payload: {
      dataCompleteness: 'complete',
      problems: [d10, d11],
      opportunities: [],
      adLevelCoverage: [{ adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 5 }],
    },
  }
}

async function getBody() {
  const res = await GET(new NextRequest(`http://localhost/api/clients/${CLIENT}/ad-health`), { params: { id: CLIENT } })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) as { growth?: Record<string, unknown> | null; company_confirmed_bookings?: Record<string, unknown> } }
}

describe('GET ad-health — growth visibility by viewer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T20:00:00Z'))
    m.growthRows = [row('2026-09-27'), row('2026-09-26')]
    m.growthError = null
    m.growthLimit = null
    m.latest = null
    m.bookingAccess.mockReset()
    m.bookingOutcome.mockReset()
    m.unknownBookingOutcome.mockImplementation((window_start: string, window_end: string, note: string) => ({
      step: 'deal', value: null, attribution: 'none', note, window_start, window_end, source_ad_count: null,
    }))
  })
  afterEach(() => vi.useRealTimers())

  it('unscoped admin gets the raw row, D11 included', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    const { status, text, body } = await getBody()
    expect(status).toBe(200)
    expect(m.growthLimit).toBe(1)
    expect(text).toContain(D11_TITLE)
    const problems = (body.growth?.payload as { problems: Array<{ code: string }> }).problems
    expect(problems.map(p => p.code)).toEqual(['D10', 'D11'])
    expect((body.growth as unknown as { goal_live: { live: boolean } }).goal_live.live).toBe(true)
  })

  it('adds the booking result only to the internal view and anchors it to the report week', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    m.latest = { insight_date: '2026-10-22' }
    m.bookingAccess.mockResolvedValue({ ok: true })
    m.bookingOutcome.mockResolvedValue({
      step: 'deal', value: 1, attribution: 'crm_first_touch',
      window_start: '2026-10-16', window_end: '2026-10-22', source_ad_count: 1,
    })
    const { status, body } = await getBody()
    expect(status).toBe(200)
    expect(m.bookingAccess).toHaveBeenCalledWith(CLIENT, 'view')
    expect(m.bookingOutcome).toHaveBeenCalledWith(CLIENT, '2026-10-16', '2026-10-22')
    expect(body.company_confirmed_bookings).toMatchObject({ value: 1, attribution: 'crm_first_touch' })
  })

  it('does not turn a missing booking permission into zero', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    m.latest = { insight_date: '2026-10-22' }
    m.bookingAccess.mockResolvedValue({ ok: false })
    const { body } = await getBody()
    expect(body.company_confirmed_bookings).toMatchObject({ value: null, note: 'CRM 预订读取权限或配置不可用' })
    expect(m.bookingOutcome).not.toHaveBeenCalled()
  })

  it('paid client never receives D11 or raw evidence; gets the client view with the D10 card', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT })
    m.latest = { insight_date: '2026-10-22' }
    const { status, text, body } = await getBody()
    expect(status).toBe(200)
    expect(m.growthLimit).toBe(14)
    for (const leaked of [D11_TITLE, 'D11', 'aud_1', 'Retargeting pool', 'evidence', '内部']) {
      expect(text, `leaked: ${leaked}`).not.toContain(leaked)
    }
    expect(body.growth?.viewer).toBe('client')
    expect(body.company_confirmed_bookings).toBeUndefined()
    expect(m.bookingOutcome).not.toHaveBeenCalled()
    expect(text).not.toContain('goal_live')
    const cards = (body.growth?.adCards as { cards: Array<{ adLabel: string }> }).cards
    expect(cards.map(c => c.adLabel)).toEqual(['Spring Lead Ad'])
  })

  it('scoped / demo admin (tier admin but pinned to one client) gets the client view too', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: CLIENT })
    m.latest = { insight_date: '2026-10-22' }
    const { text, body } = await getBody()
    expect(text).not.toContain(D11_TITLE)
    expect(body.growth?.viewer).toBe('client')
    expect(body.company_confirmed_bookings).toBeUndefined()
    expect(m.bookingOutcome).not.toHaveBeenCalled()
  })

  it('an unknown future tier falls back to the client view', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'something_new', role: 'client-viewer', allowedClientId: CLIENT })
    const { text } = await getBody()
    expect(text).not.toContain(D11_TITLE)
  })

  it('no patrol rows → growth null for a client (page: "not run yet")', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT })
    m.growthRows = []
    const { body } = await getBody()
    expect(body.growth).toBeNull()
  })

  it('read error → growth omitted (page: "cannot read") for both viewers', async () => {
    m.growthError = { message: 'boom' }
    for (const allowedClientId of [null, CLIENT]) {
      m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId })
      const { body } = await getBody()
      expect('growth' in body).toBe(false)
    }
  })

  it('denied access short-circuits before any read', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const { status } = await getBody()
    expect(status).toBe(403)
    expect(m.growthLimit).toBeNull()
  })
})
