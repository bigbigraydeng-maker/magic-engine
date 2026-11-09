import { describe, expect, it, vi } from 'vitest'

const { runActorAndGetResults, estimateWebsiteTraffic } = vi.hoisted(() => ({ runActorAndGetResults: vi.fn(), estimateWebsiteTraffic: vi.fn() }))
vi.mock('@/lib/apify/client', () => ({ runActorAndGetResults }))
vi.mock('@/lib/apify/traffic-estimator', () => ({ estimateWebsiteTraffic }))
const { scrapeSeek } = vi.hoisted(() => ({ scrapeSeek: vi.fn() }))
vi.mock('@/lib/prospecting/job-boards/scrapers', () => ({ scrapeSeek }))

import { collectApifyExternalObservations, collectConfiguredIndustrySource, collectFacebookPublicGroupPosts, collectIndustryWebsite, collectRssFeed, collectSeekNzJobs, collectTrafficDirectionObservations, WI_APIFY_ACTORS } from '../apify-external'

const clientId = '00000000-0000-0000-0000-000000000001'

describe('Apify external observation adapter', () => {
  it('reuses the shared Apify runner and normalizes common article fields', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-1', data: [{
      url: 'https://travel.example/story?utm_source=x', title: 'New route', description: 'Operator announced a new route.',
      publishedAt: '2026-09-11T00:00:00Z', domain: 'travel.example',
    }] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: { startUrls: [] }, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(runActorAndGetResults).toHaveBeenCalledWith('actor/news', { startUrls: [] }, undefined)
    expect(result).toMatchObject({ runId: 'run-1', rejected: 0 })
    expect(result.observations[0]).toMatchObject({ source_type: 'industry_media', source_name: 'Travel Today', title: 'New route', published_at: '2026-09-11T00:00:00.000Z' })
  })

  it('rejects rows without a public URL or useful text', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-2', data: [
      { title: 'No URL', description: 'text' }, { url: 'https://example.com/no-text', title: 'No text' },
    ] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(result).toMatchObject({ runId: 'run-2', rejected: 2, observations: [] })
  })

  it('fails closed for unauthorized Facebook rows', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-3', data: [{
      url: 'https://facebook.com/groups/example/posts/1', text: 'Discussion',
    }] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/group', actorInput: {}, sourceId: 'facebook-group-authorized', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(result).toMatchObject({ runId: 'run-3', rejected: 1, observations: [] })
  })

  it('returns actor failures without manufacturing observations', async () => {
    runActorAndGetResults.mockResolvedValue({ success: false, runId: 'run-4', data: [], error: 'Actor timed out' })
    await expect(collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })).resolves.toMatchObject({ runId: 'run-4', observations: [], error: 'Actor timed out' })
  })

  it('uses the verified RSS actor input contract', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'rss-1', data: [] })
    await collectRssFeed({ sourceId: 'travel-today', clientId, feedUrl: 'https://example.com/feed.xml', observedAt: '2026-09-11T01:00:00Z', maxResults: 500 })
    expect(runActorAndGetResults).toHaveBeenCalledWith(WI_APIFY_ACTORS.rssFeed, { feed_url: 'https://example.com/feed.xml', max_results: 200 }, undefined)
  })

  it('uses bounded article and SEEK NZ actor inputs', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'generic-1', data: [] })
    await collectIndustryWebsite({ sourceId: 'travel-today', clientId, siteUrl: 'https://travel.example', observedAt: '2026-09-11T01:00:00Z', maxArticles: 100 })
    expect(runActorAndGetResults).toHaveBeenCalledWith(WI_APIFY_ACTORS.articleExtractor, expect.objectContaining({ startUrls: ['https://travel.example'], maxArticles: 50, extractFullContent: true }), undefined)
    scrapeSeek.mockResolvedValue([{ board: 'seek', company: 'Example Tours', title: 'Tour Manager', location_raw: 'Auckland', classification: null, url: 'https://www.seek.co.nz/job/1', posted_at: '2026-09-11T00:00:00Z', keyword_matched: 'tour manager' }])
    const seek = await collectSeekNzJobs({ clientId, queries: ['tour manager'], location: 'Auckland', observedAt: '2026-09-11T01:00:00Z', maxResults: 500 })
    expect(scrapeSeek).toHaveBeenCalledWith(['tour manager'], 100)
    expect(seek.observations[0]).toMatchObject({ source_type: 'jobs', source_name: 'SEEK', title: 'Tour Manager' })
  })

  it('uses the registered Travel Today URL when no override is supplied', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'configured-1', data: [] })
    await collectConfiguredIndustrySource({ sourceId: 'travel-today', clientId, observedAt: '2026-09-11T01:00:00Z' })
    expect(runActorAndGetResults).toHaveBeenCalledWith(WI_APIFY_ACTORS.articleExtractor, expect.objectContaining({ startUrls: ['https://traveltoday.co.nz/news/'] }), undefined)
  })

  it('collects only bounded public Facebook group URLs without login credentials', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'fb-1', data: [{
      postUrl: 'https://www.facebook.com/groups/123/posts/456', text: 'Discussion about China tours', postedAt: '2026-09-11T00:00:00Z',
    }] })
    const result = await collectFacebookPublicGroupPosts({
      clientId, groupUrls: ['https://www.facebook.com/groups/123/', 'https://facebook.com/groups/private-slug'],
      searchTerms: ['China'], observedAt: '2026-09-11T01:00:00Z', maxItems: 500, maxPagesPerGroup: 50,
    })
    expect(runActorAndGetResults).toHaveBeenCalledWith(WI_APIFY_ACTORS.facebookPublicGroupPosts, expect.objectContaining({
      startUrls: [{ url: 'https://www.facebook.com/groups/123/' }], maxItems: 100, searchTerms: ['China'], maxPagesPerGroup: 20,
    }), undefined)
    expect(result.observations[0]).toMatchObject({ source_type: 'facebook_group', source_name: 'Facebook Group（公开）', title: '', excerpt: 'Discussion about China tours' })
  })

  it('fails closed when no numeric public group URL is supplied', async () => {
    await expect(collectFacebookPublicGroupPosts({ clientId, groupUrls: ['https://www.facebook.com/groups/private-slug'], observedAt: '2026-09-11T01:00:00Z' }))
      .rejects.toThrow('public_facebook_group_url_required')
  })

  it('converts Apify traffic estimates into shared low-confidence observations with an audit receipt', async () => {
    estimateWebsiteTraffic.mockResolvedValue({
      run_id: 'traffic-run-1', dataset_id: 'traffic-dataset-1', cost_usd: 0.01,
      data: [{
        domain: 'wendywutours.co.nz', total_visits: '15.2K', visits_change_pct: 31,
        bounce_rate_pct: 27.9, pages_per_visit: 4.36, avg_visit_duration: '00:04:22',
        top_country: 'New Zealand', top_countries: [{ country: 'New Zealand', share_pct: 90.6 }],
        traffic_sources: { organic: 45 }, checked_at: '2026-09-12T17:25:32.902Z',
        source: 'similarweb_public_estimate_via_apify', confidence: 'low',
      }],
    })
    const result = await collectTrafficDirectionObservations({ clientId, domains: ['https://www.wendywutours.co.nz/'], observedAt: '2026-09-13T00:00:00Z' })
    expect(estimateWebsiteTraffic).toHaveBeenCalledWith(['https://www.wendywutours.co.nz/'], { maxChargeUsd: undefined })
    expect(result).toMatchObject({ runId: 'traffic-run-1', datasetId: 'traffic-dataset-1', costUsd: 0.01, rejected: 0 })
    expect(result.observations[0]).toMatchObject({
      source_type: 'website', source_tier: 'C', competitor_domain: 'wendywutours.co.nz',
      title: 'wendywutours.co.nz · 网站流量方向',
    })
    expect(result.observations[0].excerpt).toContain('数据性质：第三方公开估算')
  })
})
