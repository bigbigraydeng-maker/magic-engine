import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getValidAccessToken: vi.fn() }))
vi.mock('@/lib/platform-oauth/token-manager', () => ({ getValidTokenForConnection: vi.fn() }))
vi.mock('@/lib/google-oauth/client', () => ({ getValidAccessToken: mocks.getValidAccessToken }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }) },
}))

import { fetchGa4OrganicLandingLeadsRaw } from '../client'
import { getLandingClassConfig } from '../landing-class-config'

const CTS = 'c0000000-0000-0000-0000-000000000000'

afterEach(() => vi.restoreAllMocks())

describe('fetchGa4OrganicLandingLeadsRaw — what is actually asked of GA4', () => {
  it('restricts BOTH reads to Organic Search and uses the client-configured event / thank-you text', async () => {
    mocks.getValidAccessToken.mockResolvedValue('tok')
    const bodies: Array<Record<string, any>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)))
      return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
    })
    const cfg = getLandingClassConfig(CTS)!
    const raw = await fetchGa4OrganicLandingLeadsRaw('123', CTS, cfg, 28)
    expect(raw?.rows).toEqual([])
    expect(bodies).toHaveLength(2)
    for (const b of bodies) {
      const exprs = b.dimensionFilter.andGroup.expressions
      expect(exprs[0].filter).toMatchObject({ fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search', matchType: 'EXACT' } })
      expect(b.dimensions.map((d: { name: string }) => d.name)).toContain('landingPage')
    }
    expect(JSON.stringify(bodies[0])).toContain(cfg.enquiryEvent)
    expect(JSON.stringify(bodies[1])).toContain(`"value":"${cfg.thankYouPathContains}"`)
  })

  it('no token → null, no GA4 call', async () => {
    mocks.getValidAccessToken.mockResolvedValue(null)
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await fetchGa4OrganicLandingLeadsRaw('123', CTS, getLandingClassConfig(CTS)!, 28)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
