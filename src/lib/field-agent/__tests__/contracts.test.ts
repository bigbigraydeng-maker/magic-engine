import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_COMPETITOR_ADS_REQUEST,
  aiAnswerPayloadSchema,
  buildCompetitorAdsParams,
  dashboardCompetitorAdsRequestSchema,
  fieldAgentScreenshotPath,
  googleMapsRatingPayloadSchema,
  metaAdContentHash,
  metaAdLibraryCanonicalUrl,
  metaAdLibraryPayloadSchema,
  tripadvisorPayloadSchema,
} from '../contracts'

const ad = {
  competitor_name: 'Example Tours',
  ad_library_id: '12345',
  platforms: ['facebook', 'instagram'],
  primary_text: 'China tours from Auckland',
  headline: 'See China',
  landing_url: 'https://example.com/china',
}

describe('field agent contracts', () => {
  it('keeps the dashboard request to the exact two fields', () => {
    expect(dashboardCompetitorAdsRequestSchema.parse(DASHBOARD_COMPETITOR_ADS_REQUEST)).toEqual(DASHBOARD_COMPETITOR_ADS_REQUEST)
    expect(() => dashboardCompetitorAdsRequestSchema.parse({ ...DASHBOARD_COMPETITOR_ADS_REQUEST, note: 'extra' })).toThrow()
  })

  it('hashes and links a meta ad the way the agent must', () => {
    expect(metaAdLibraryCanonicalUrl('Ab_1')).toBe('https://www.facebook.com/ads/library/?id=Ab_1')
    expect(metaAdContentHash({ ad_library_id: 'Ab_1', primary_text: 'Hello', headline: 'Head', landing_url: 'https://example.com' })).toMatch(/^[a-f0-9]{64}$/)
    expect(metaAdLibraryPayloadSchema.parse(ad).competitor_name).toBe('Example Tours')
    expect(() => metaAdLibraryPayloadSchema.parse({ ...ad, primary_text: ' ', headline: '', offer_text: '' })).toThrow()
  })

  it('accepts the other field-agent payloads and rejects a non-https link', () => {
    expect(googleMapsRatingPayloadSchema.parse({ competitor_name: 'Example', rating: 4.5, review_count: 12, maps_url: 'https://maps.example/place' }).rating).toBe(4.5)
    expect(tripadvisorPayloadSchema.parse({ competitor_name: 'Example', rating: 4, review_count: 3, location_url: 'https://tripadvisor.example/place' }).review_count).toBe(3)
    expect(aiAnswerPayloadSchema.parse({ query: 'best china tour', engine: 'google_ai_overview', mentioned: true }).mentioned).toBe(true)
    expect(() => googleMapsRatingPayloadSchema.parse({ competitor_name: 'Example', rating: 4, review_count: 1, maps_url: 'http://maps.example/place' })).toThrow()
  })

  it('builds a client-scoped screenshot path and drops archived competitors', () => {
    const clientId = '11111111-1111-4111-8111-111111111111'
    const taskId = '22222222-2222-4222-8222-222222222222'
    expect(fieldAgentScreenshotPath(clientId, taskId, '12345.png')).toBe(`${clientId}/${taskId}/12345.png`)
    expect(buildCompetitorAdsParams([
      { domain: 'live.example', tier: 'core', status: 'active', urls: ['https://live.example/'] },
      { domain: 'old.example', tier: 'watch', status: 'archive', urls: [] },
    ]).competitors).toEqual([{ domain: 'live.example', tier: 'core', urls: ['https://live.example/'] }])
  })
})
