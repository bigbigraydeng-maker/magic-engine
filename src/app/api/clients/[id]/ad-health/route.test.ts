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
  latest: null as unknown,
  latestError: null as { message: string } | null,
}))

vi.mock('@/lib/ads-strategy/agents/growth-live-goal', () => ({
  overlayLiveGoal: async (_id: string, row: Record<string, unknown>) => ({ ...row, goal_live: { live: true, readAtIso: 'x' } }),
}))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))

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
      maybeSingle: () =>
        Promise.resolve(
          table === 'ad_health_narratives'
            ? { data: m.latestError ? null : m.latest, error: m.latestError }
            : { data: null, error: null },
        ),
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
  return { status: res.status, text, body: JSON.parse(text) as { growth?: Record<string, unknown> | null } }
}

describe('GET ad-health — growth visibility by viewer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T20:00:00Z'))
    m.growthRows = [row('2026-09-27'), row('2026-09-26')]
    m.growthError = null
    m.growthLimit = null
    m.latest = null
    m.latestError = null
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

  it('paid client never receives D11 or raw evidence; gets the client view with the D10 card', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT })
    const { status, text, body } = await getBody()
    expect(status).toBe(200)
    expect(m.growthLimit).toBe(14)
    for (const leaked of [D11_TITLE, 'D11', 'aud_1', 'Retargeting pool', 'evidence', '内部']) {
      expect(text, `leaked: ${leaked}`).not.toContain(leaked)
    }
    expect(body.growth?.viewer).toBe('client')
    expect(text).not.toContain('goal_live')
    const cards = (body.growth?.adCards as { cards: Array<{ adLabel: string }> }).cards
    expect(cards.map(c => c.adLabel)).toEqual(['Spring Lead Ad'])
  })

  it('scoped / demo admin (tier admin but pinned to one client) gets the client view too', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: CLIENT })
    const { text, body } = await getBody()
    expect(text).not.toContain(D11_TITLE)
    expect(body.growth?.viewer).toBe('client')
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

  describe('latest narrative payload', () => {
    const narrative = {
      insight_date: '2026-09-27',
      overall_verdict: 'watch',
      headline: '本周整体正常',
      payload: {
        overall_verdict: 'watch',
        headline: '本周整体正常',
        campaigns: [{
          campaign_id: 'cp1',
          campaign_name: 'Spring',
          verdict: 'alert',
          headline: '花得多、出得少',
          metrics: [{ metric: 'ctr', verdict: 'alert', baseline: 0.02, recent: 0.01, ratio: 0.5, reason: 'INTERNAL_METRIC_REASON' }],
          ctr_series: [{ date: '2026-09-26', ctr: 0.01, impressions_raw: 'INTERNAL_IMPRESSIONS' }],
          latest_spend_7d: 120,
          latest_results_7d: 3,
          frequency_7d: 1.4,
          prescription: { kind: 'refresh_creatives', title: '换素材', why: '看腻了', executable: true, execute_hint: '补 3 条', audience_id: 'INTERNAL_AUD' },
          internal_note: 'INTERNAL_CAMPAIGN_NOTE',
        }],
        evaluated: 1,
        generated_for: CLIENT,
        portfolio_diagnoses: { hit_count: 1, problems: [d11] },
      },
    }

    beforeEach(() => {
      m.latest = narrative
    })

    it('paid client and scoped admin never receive portfolio_diagnoses; page fields stay', async () => {
      for (const tier of ['paid_client', 'admin']) {
        m.access.mockResolvedValue({ ok: true, tier, role: 'viewer', allowedClientId: CLIENT })
        const { text, body } = await getBody()
        for (const leaked of ['portfolio_diagnoses', 'D11', D11_TITLE, 'aud_1']) {
          expect(text, `leaked: ${leaked}`).not.toContain(leaked)
        }
        const latest = (body as unknown as { latest: { payload: Record<string, unknown> } }).latest
        expect(Object.keys(latest.payload).sort()).toEqual(
          ['campaigns', 'evaluated', 'generated_for', 'headline', 'overall_verdict'],
        )
      }
    })

    it('campaigns[] items are field-whitelisted for non-staff (page fields stay, extras dropped)', async () => {
      m.access.mockResolvedValue({ ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT })
      const { text, body } = await getBody()
      for (const leaked of ['INTERNAL_', 'internal_note', 'impressions_raw', 'audience_id']) {
        expect(text, `leaked: ${leaked}`).not.toContain(leaked)
      }
      const c = (body as unknown as { latest: { payload: { campaigns: Array<Record<string, unknown>> } } }).latest.payload.campaigns[0]
      expect(Object.keys(c).sort()).toEqual([
        'campaign_id', 'campaign_name', 'ctr_series', 'frequency_7d', 'headline', 'latest_results_7d',
        'latest_spend_7d', 'metrics', 'prescription', 'verdict',
      ])
      expect(c.metrics).toEqual([{ metric: 'ctr', verdict: 'alert', baseline: 0.02, ratio: 0.5 }])
      expect(c.ctr_series).toEqual([{ date: '2026-09-26', ctr: 0.01 }])
      expect(c.prescription).toEqual({ kind: 'refresh_creatives', title: '换素材', why: '看腻了', executable: true, execute_hint: '补 3 条' })
    })

    it('unscoped admin still gets the full payload', async () => {
      m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
      const { text } = await getBody()
      expect(text).toContain('portfolio_diagnoses')
      expect(text).toContain('INTERNAL_CAMPAIGN_NOTE')
    })

    it('db error → fixed message, raw error text not returned', async () => {
      m.latestError = { message: 'relation "ad_health_narratives" secret detail' }
      m.access.mockResolvedValue({ ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT })
      const { status, text } = await getBody()
      expect(status).toBe(500)
      expect(text).not.toContain('secret detail')
    })
  })
})
