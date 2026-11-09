import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(), loadContext: vi.fn(), loadAlignment: vi.fn(), saveAlignment: vi.fn(), safeFetchText: vi.fn(), loadGscEvidence: vi.fn(),
}))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.requireAccess }))
vi.mock('@/lib/net/safe-fetch', () => ({ safeFetchText: mocks.safeFetchText }))
vi.mock('@/lib/factory/topic-gsc-evidence', () => ({ loadStoredGscEvidence: mocks.loadGscEvidence }))
vi.mock('@/lib/factory/topic-alignment-store', () => ({
  loadAlignmentContext: mocks.loadContext,
  loadTopicAlignment: mocks.loadAlignment,
  saveTopicAlignment: mocks.saveAlignment,
}))

import { GET, PATCH } from './route'

const ctx = { params: { id: '11111111-1111-4111-8111-111111111111', postId: '22222222-2222-4222-8222-222222222222' } }
const now = new Date().toISOString()
const input = {
  videoFormat: 'short', primaryKeyword: 'china tours from nz', searchIntent: 'street life', audienceMarket: 'New Zealand',
  googleEvidence: { status: 'observed', source: 'GSC', observedAt: now, dateRange: 'last 28 days', market: 'NZ', finding: 'Impressions', metricName: 'impressions', value: 100 },
  youtubeEvidence: { status: 'observed', source: 'Studio', observedAt: now, dateRange: 'last 28 days', market: 'NZ', finding: 'Search terms checked' },
  websiteUrl: 'https://www.ctstours.co.nz/china-tours-from-new-zealand', websiteTheme: 'China journeys',
  promotionUrl: null, promotionAlignment: 'not_applicable', promotionNote: 'No relevant active promotion for this topic',
  campaignBriefId: null, adsAlignment: 'not_applicable', adsNote: 'No relevant active ad campaign for this topic',
  socialPlanId: null, socialAlignment: 'not_applicable', socialNote: 'No relevant social plan for this editorial topic',
  contentPromise: 'Show three different China street scenes',
}
const request = (body: unknown) => new NextRequest('http://localhost/alignment', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAccess.mockResolvedValue({ ok: true })
  mocks.loadContext.mockResolvedValue({
    post: { id: ctx.params.postId, title: 'China Streets', status: 'draft', platforms: ['youtube'] },
    websiteHosts: ['ctstours.co.nz'], primaryKeywords: ['china tours from nz'], campaigns: [], socialPlans: [],
  })
  mocks.safeFetchText.mockResolvedValue({ ok: true, status: 200, url: input.websiteUrl, text: '<html><title>CTS China Tours</title></html>' })
  mocks.loadGscEvidence.mockResolvedValue({
    status: 'observed', source: 'ME GSC query-page receipt verified-id', observedAt: now,
    dateRange: '2026-10-01 to 2026-10-14 (Google Pacific)', market: 'All countries; source has no country dimension',
    finding: 'Exact keyword and landing page; website impressions only; not YouTube demand.',
    metricName: 'GSC impressions', value: 21,
  })
  mocks.saveAlignment.mockResolvedValue(undefined)
})

describe('topic alignment route', () => {
  it('denies access before reading or saving a content post', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await PATCH(request(input), ctx)).status).toBe(403)
    expect(mocks.loadContext).not.toHaveBeenCalled()
  })

  it('rejects an off-site landing page before any network request', async () => {
    const res = await PATCH(request({ ...input, websiteUrl: 'https://ctstours.co.nz.evil.example/' }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.saveAlignment).not.toHaveBeenCalled()
  })

  it('saves source-backed alignment after reading the official page', async () => {
    const res = await PATCH(request(input), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ready: true, gaps: [] })
    expect(mocks.safeFetchText).toHaveBeenCalledWith(input.websiteUrl, expect.any(Object))
    expect(mocks.saveAlignment.mock.calls[0][2]).toMatchObject({
      primaryKeyword: 'china tours from nz', websiteCheck: { status: 'verified', pageTitle: 'CTS China Tours' },
      googleEvidence: { source: 'ME GSC query-page receipt verified-id', value: 21 },
    })
    expect(mocks.loadGscEvidence).toHaveBeenCalledWith(ctx.params.id, 'china tours from nz', input.websiteUrl)
  })

  it('rejects an unconfigured keyword before site or GSC access', async () => {
    const res = await PATCH(request({ ...input, primaryKeyword: 'free flights' }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.loadGscEvidence).not.toHaveBeenCalled()
  })

  it('does not accept caller-provided Google metrics when the stored evidence is missing', async () => {
    mocks.loadGscEvidence.mockResolvedValue({ status: 'not_collected', finding: 'No exact query-page rows' })
    const res = await PATCH(request(input), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ready: false, gaps: expect.arrayContaining(['Google 网站搜索证据未核']) })
    expect(mocks.saveAlignment.mock.calls[0][2].googleEvidence).toMatchObject({ status: 'not_collected' })
  })

  it('keeps the topic blocked when the official page cannot be read', async () => {
    mocks.safeFetchText.mockRejectedValue(new Error('offline'))
    const res = await PATCH(request(input), ctx)
    expect((await res.json()).gaps).toContain('官网页面未在近 7 天读回核对')
    expect(mocks.saveAlignment).toHaveBeenCalledOnce()
  })

  it('saves incomplete evidence but keeps the production gate closed', async () => {
    const incomplete = {
      ...input,
      youtubeEvidence: { status: 'not_collected' },
      promotionAlignment: 'unknown',
      promotionNote: '',
      adsAlignment: 'unknown',
      adsNote: '',
      socialAlignment: 'unknown',
      socialNote: '',
    }
    const res = await PATCH(request(incomplete), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ready: false,
      gaps: expect.arrayContaining([
        'YouTube 选题证据未核',
        '官网推广内容对应关系未核',
        '广告活动主题对应关系未核',
        '社媒计划主题对应关系未核',
      ]),
    })
    expect(mocks.saveAlignment).toHaveBeenCalledOnce()
  })

  it('invalidates a saved alignment when the content title changes', async () => {
    await PATCH(request(input), ctx)
    const saved = mocks.saveAlignment.mock.calls[0][2]
    mocks.loadAlignment.mockResolvedValue(saved)
    const context = await mocks.loadContext.mock.results[0].value
    mocks.loadContext.mockResolvedValue({ ...context, post: { ...context.post, title: 'A different title promise' } })
    const res = await GET(new NextRequest('http://localhost/alignment'), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ready: false,
      gaps: expect.arrayContaining(['标题变更后尚未重新核对主题']),
    })
  })
})
